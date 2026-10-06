// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.
pragma solidity ^0.8.28;

import {SignedActions} from "./utils/SignedActions.sol";

/// @dev The one SkillRegistry view UsageStats depends on.
interface ISkillFingerprints {
    function skillOfFingerprint(bytes32 fingerprint) external view returns (uint256 skillId, uint256 versionIndex);
}

/// @title Obelisk Skill usage statistics
/// @notice Per Skill version (fingerprint), the total real invocations, how
/// many distinct wallets reported them, and scene / outcome distributions.
///
/// Reports are CUMULATIVE per (wallet, fingerprint): a wallet always submits
/// its running totals, the contract adds only the increase since that
/// wallet's previous report, and rejects any decrease. A retried or
/// re-submitted report therefore changes nothing, and one wallet can never be
/// counted twice. `uniqueWallets` counts wallets, not people (vision 01/04).
///
/// Scene and outcome buckets use opaque `bytes32` keys agreed off-chain. Each
/// bucket is cumulative per wallet in the same way; a key omitted from a
/// report keeps its previous value. P0 clients send empty bucket arrays.
///
/// @dev BOT Chain does not serve `eth_getLogs`; every aggregate, reporter
/// list, and bucket key list is enumerable through views.
contract UsageStats is SignedActions {
    bytes32 public constant BUCKET_TYPEHASH = keccak256("Bucket(bytes32 key,uint64 cumulative)");
    bytes32 public constant REPORT_USAGE_TYPEHASH = keccak256(
        "ReportUsage(address reporter,bytes32 fingerprint,uint64 cumulativeInvocations,Bucket[] scenes,Bucket[] outcomes,uint256 nonce,uint256 deadline)Bucket(bytes32 key,uint64 cumulative)"
    );

    /// @notice Bound on buckets per array so a report's cost stays predictable.
    uint256 public constant MAX_BUCKETS = 32;

    struct Bucket {
        bytes32 key;
        uint64 cumulative;
    }

    struct VersionStats {
        uint64 totalInvocations;
        uint32 uniqueWallets;
        uint64 lastReportAt;
    }

    struct WalletReport {
        uint64 cumulative;
        uint64 reportedAt;
    }

    struct Distribution {
        bytes32[] keys;
        mapping(bytes32 key => uint64) totals;
        mapping(bytes32 key => bool) known;
        mapping(address wallet => mapping(bytes32 key => uint64)) byWallet;
    }

    ISkillFingerprints public immutable skillRegistry;

    mapping(bytes32 fingerprint => VersionStats) private _stats;
    mapping(bytes32 fingerprint => mapping(address wallet => WalletReport)) private _walletReports;
    mapping(bytes32 fingerprint => address[]) private _reporters;
    mapping(bytes32 fingerprint => Distribution) private _scenes;
    mapping(bytes32 fingerprint => Distribution) private _outcomes;
    bytes32[] private _reportedFingerprints;

    event UsageReported(
        bytes32 indexed fingerprint, address indexed reporter, uint64 cumulativeInvocations, uint64 addedInvocations
    );

    error UnknownFingerprint(bytes32 fingerprint);
    error ZeroInvocations();
    error InvocationsDecreased(uint64 previous, uint64 reported);
    error BucketDecreased(bytes32 key, uint64 previous, uint64 reported);
    error BucketExceedsInvocations(bytes32 key, uint64 cumulative);
    error BucketKeysNotAscending(uint256 index);
    error TooManyBuckets(uint256 count);

    constructor(ISkillFingerprints skillRegistry_) SignedActions("ObeliskUsageStats") {
        skillRegistry = skillRegistry_;
    }

    /// @notice Submit `reporter`'s running totals for one Skill version.
    /// Bucket keys must be strictly ascending (canonical, no duplicates) and
    /// no bucket may exceed `cumulativeInvocations`.
    function reportBySig(
        address reporter,
        bytes32 fingerprint,
        uint64 cumulativeInvocations,
        Bucket[] calldata scenes,
        Bucket[] calldata outcomes,
        uint256 deadline,
        bytes calldata signature
    ) external {
        (uint256 skillId,) = skillRegistry.skillOfFingerprint(fingerprint);
        if (skillId == 0) revert UnknownFingerprint(fingerprint);
        if (cumulativeInvocations == 0) revert ZeroInvocations();

        bytes32 structHash = keccak256(
            abi.encode(
                REPORT_USAGE_TYPEHASH,
                reporter,
                fingerprint,
                cumulativeInvocations,
                _hashBuckets(scenes, cumulativeInvocations),
                _hashBuckets(outcomes, cumulativeInvocations),
                _useNonce(reporter),
                deadline
            )
        );
        _requireSignedBy(reporter, structHash, deadline, signature);

        WalletReport storage report = _walletReports[fingerprint][reporter];
        uint64 previous = report.cumulative;
        if (cumulativeInvocations < previous) revert InvocationsDecreased(previous, cumulativeInvocations);

        VersionStats storage stats = _stats[fingerprint];
        if (stats.lastReportAt == 0) _reportedFingerprints.push(fingerprint);
        if (previous == 0) {
            stats.uniqueWallets += 1;
            _reporters[fingerprint].push(reporter);
        }
        uint64 added = cumulativeInvocations - previous;
        stats.totalInvocations += added;
        stats.lastReportAt = uint64(block.timestamp);
        report.cumulative = cumulativeInvocations;
        report.reportedAt = uint64(block.timestamp);

        _applyBuckets(_scenes[fingerprint], reporter, scenes);
        _applyBuckets(_outcomes[fingerprint], reporter, outcomes);
        emit UsageReported(fingerprint, reporter, cumulativeInvocations, added);
    }

    function versionStats(bytes32 fingerprint)
        external
        view
        returns (uint64 totalInvocations, uint32 uniqueWallets, uint64 lastReportAt)
    {
        VersionStats storage stats = _stats[fingerprint];
        return (stats.totalInvocations, stats.uniqueWallets, stats.lastReportAt);
    }

    function walletReport(bytes32 fingerprint, address wallet) external view returns (uint64 cumulative, uint64 reportedAt) {
        WalletReport storage report = _walletReports[fingerprint][wallet];
        return (report.cumulative, report.reportedAt);
    }

    function reporterCount(bytes32 fingerprint) external view returns (uint256) {
        return _reporters[fingerprint].length;
    }

    function reporterAt(bytes32 fingerprint, uint256 index) external view returns (address) {
        return _reporters[fingerprint][index];
    }

    function sceneKeyCount(bytes32 fingerprint) external view returns (uint256) {
        return _scenes[fingerprint].keys.length;
    }

    function sceneKeyAt(bytes32 fingerprint, uint256 index) external view returns (bytes32) {
        return _scenes[fingerprint].keys[index];
    }

    function sceneCount(bytes32 fingerprint, bytes32 key) external view returns (uint64) {
        return _scenes[fingerprint].totals[key];
    }

    function outcomeKeyCount(bytes32 fingerprint) external view returns (uint256) {
        return _outcomes[fingerprint].keys.length;
    }

    function outcomeKeyAt(bytes32 fingerprint, uint256 index) external view returns (bytes32) {
        return _outcomes[fingerprint].keys[index];
    }

    function outcomeCount(bytes32 fingerprint, bytes32 key) external view returns (uint64) {
        return _outcomes[fingerprint].totals[key];
    }

    /// @notice Number of Skill versions that have received at least one report.
    function reportedFingerprintCount() external view returns (uint256) {
        return _reportedFingerprints.length;
    }

    function reportedFingerprintAt(uint256 index) external view returns (bytes32) {
        return _reportedFingerprints[index];
    }

    /// @dev EIP-712 encoding of `Bucket[]`: keccak256 of the concatenated
    /// struct hashes. Also enforces the canonical-form and bound rules.
    function _hashBuckets(Bucket[] calldata buckets, uint64 cumulativeInvocations) private pure returns (bytes32) {
        if (buckets.length > MAX_BUCKETS) revert TooManyBuckets(buckets.length);
        bytes32[] memory hashes = new bytes32[](buckets.length);
        for (uint256 i = 0; i < buckets.length; ++i) {
            Bucket calldata bucket = buckets[i];
            if (i > 0 && bucket.key <= buckets[i - 1].key) revert BucketKeysNotAscending(i);
            if (bucket.cumulative > cumulativeInvocations) revert BucketExceedsInvocations(bucket.key, bucket.cumulative);
            hashes[i] = keccak256(abi.encode(BUCKET_TYPEHASH, bucket.key, bucket.cumulative));
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _applyBuckets(Distribution storage distribution, address reporter, Bucket[] calldata buckets) private {
        for (uint256 i = 0; i < buckets.length; ++i) {
            bytes32 key = buckets[i].key;
            uint64 reported = buckets[i].cumulative;
            uint64 previous = distribution.byWallet[reporter][key];
            if (reported < previous) revert BucketDecreased(key, previous, reported);
            if (reported == previous) continue;
            if (!distribution.known[key]) {
                distribution.known[key] = true;
                distribution.keys.push(key);
            }
            distribution.totals[key] += reported - previous;
            distribution.byWallet[reporter][key] = reported;
        }
    }
}
