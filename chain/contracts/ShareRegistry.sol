// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.
pragma solidity ^0.8.28;

import {SignedActions} from "./utils/SignedActions.sol";

/// @title Obelisk share authorization
/// @notice The public rules for one private share: who sent it, the one
/// wallet allowed to open it, a fingerprint of the encrypted content, how many
/// times it may be opened, when it expires, and whether the sender revoked
/// it. Every successful open appends a receipt.
///
/// The online service calls {checkOpen} before releasing the key package and
/// then submits the recipient-signed {recordOpenBySig}, which re-checks the
/// same rules on-chain.
///
/// @dev BOT Chain does not serve `eth_getLogs`, so shares, receipts, and the
/// per-sender / per-recipient lists are all readable through view functions.
contract ShareRegistry is SignedActions {
    bytes32 public constant CREATE_SHARE_TYPEHASH = keccak256(
        "CreateShare(address sender,bytes32 shareId,address recipient,bytes32 contentHash,uint32 maxOpens,uint64 expiresAt,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant RECORD_OPEN_TYPEHASH =
        keccak256("RecordOpen(address recipient,bytes32 shareId,uint256 nonce,uint256 deadline)");
    bytes32 public constant REVOKE_SHARE_TYPEHASH =
        keccak256("RevokeShare(address sender,bytes32 shareId,uint256 nonce,uint256 deadline)");

    /// @notice {checkOpen} results. Precedence when several apply:
    /// Unknown > NotRecipient > Revoked > Expired > Exhausted, so a forwarded
    /// link always reads "not yours" rather than leaking the share's state.
    uint8 public constant OPEN_OK = 0;
    uint8 public constant OPEN_UNKNOWN = 1;
    uint8 public constant OPEN_NOT_RECIPIENT = 2;
    uint8 public constant OPEN_EXHAUSTED = 3;
    uint8 public constant OPEN_EXPIRED = 4;
    uint8 public constant OPEN_REVOKED = 5;

    struct Share {
        address sender;
        uint64 createdAt;
        address recipient;
        uint64 expiresAt;
        bytes32 contentHash;
        uint32 maxOpens;
        uint32 openCount;
        bool revoked;
        uint64 revokedAt;
    }

    struct OpenReceipt {
        uint64 openedAt;
        uint64 blockNumber;
    }

    mapping(bytes32 shareId => Share) private _shares;
    mapping(bytes32 shareId => OpenReceipt[]) private _receipts;
    mapping(address sender => bytes32[]) private _bySender;
    mapping(address recipient => bytes32[]) private _byRecipient;

    event ShareCreated(
        bytes32 indexed shareId,
        address indexed sender,
        address indexed recipient,
        bytes32 contentHash,
        uint32 maxOpens,
        uint64 expiresAt
    );
    event ShareOpened(bytes32 indexed shareId, address indexed recipient, uint32 openCount);
    event ShareRevocation(bytes32 indexed shareId, address indexed sender);

    error InvalidShareId();
    error ShareExists(bytes32 shareId);
    error InvalidRecipient();
    error InvalidMaxOpens();
    error InvalidExpiry(uint64 expiresAt);
    error UnknownShare(bytes32 shareId);
    error NotRecipient(bytes32 shareId, address opener);
    error OpensExhausted(bytes32 shareId);
    error ShareExpired(bytes32 shareId);
    error ShareRevoked(bytes32 shareId);
    error NotSender(bytes32 shareId, address caller);

    constructor() SignedActions("ObeliskShareRegistry") {}

    /// @notice Record the rules for a share. `shareId` is chosen off-chain by
    /// the sender so the link can exist before this transaction lands.
    function createShareBySig(
        address sender,
        bytes32 shareId,
        address recipient,
        bytes32 contentHash,
        uint32 maxOpens,
        uint64 expiresAt,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (shareId == bytes32(0)) revert InvalidShareId();
        if (_shares[shareId].sender != address(0)) revert ShareExists(shareId);
        if (recipient == address(0)) revert InvalidRecipient();
        if (maxOpens == 0) revert InvalidMaxOpens();
        if (expiresAt <= block.timestamp) revert InvalidExpiry(expiresAt);

        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_SHARE_TYPEHASH,
                sender,
                shareId,
                recipient,
                contentHash,
                maxOpens,
                expiresAt,
                _useNonce(sender),
                deadline
            )
        );
        _requireSignedBy(sender, structHash, deadline, signature);

        Share storage share = _shares[shareId];
        share.sender = sender;
        share.createdAt = uint64(block.timestamp);
        share.recipient = recipient;
        share.expiresAt = expiresAt;
        share.contentHash = contentHash;
        share.maxOpens = maxOpens;
        _bySender[sender].push(shareId);
        _byRecipient[recipient].push(shareId);
        emit ShareCreated(shareId, sender, recipient, contentHash, maxOpens, expiresAt);
    }

    /// @notice Append an open receipt. Signed by the recipient; the same
    /// signature is what proves the opener's identity to the online service.
    function recordOpenBySig(address recipient, bytes32 shareId, uint256 deadline, bytes calldata signature) external {
        bytes32 structHash = keccak256(abi.encode(RECORD_OPEN_TYPEHASH, recipient, shareId, _useNonce(recipient), deadline));
        _requireSignedBy(recipient, structHash, deadline, signature);

        uint8 status = checkOpen(shareId, recipient);
        if (status == OPEN_UNKNOWN) revert UnknownShare(shareId);
        if (status == OPEN_NOT_RECIPIENT) revert NotRecipient(shareId, recipient);
        if (status == OPEN_REVOKED) revert ShareRevoked(shareId);
        if (status == OPEN_EXPIRED) revert ShareExpired(shareId);
        if (status == OPEN_EXHAUSTED) revert OpensExhausted(shareId);

        Share storage share = _shares[shareId];
        share.openCount += 1;
        _receipts[shareId].push(OpenReceipt({openedAt: uint64(block.timestamp), blockNumber: uint64(block.number)}));
        emit ShareOpened(shareId, recipient, share.openCount);
    }

    /// @notice Revoke a share. Only its sender can; revoking twice fails.
    function revokeBySig(address sender, bytes32 shareId, uint256 deadline, bytes calldata signature) external {
        bytes32 structHash = keccak256(abi.encode(REVOKE_SHARE_TYPEHASH, sender, shareId, _useNonce(sender), deadline));
        _requireSignedBy(sender, structHash, deadline, signature);

        Share storage share = _shares[shareId];
        if (share.sender == address(0)) revert UnknownShare(shareId);
        if (share.sender != sender) revert NotSender(shareId, sender);
        if (share.revoked) revert ShareRevoked(shareId);
        share.revoked = true;
        share.revokedAt = uint64(block.timestamp);
        emit ShareRevocation(shareId, sender);
    }

    /// @notice Whether `opener` may open `shareId` right now; see the OPEN_* constants.
    function checkOpen(bytes32 shareId, address opener) public view returns (uint8 status) {
        Share storage share = _shares[shareId];
        if (share.sender == address(0)) return OPEN_UNKNOWN;
        if (share.recipient != opener) return OPEN_NOT_RECIPIENT;
        if (share.revoked) return OPEN_REVOKED;
        if (block.timestamp >= share.expiresAt) return OPEN_EXPIRED;
        if (share.openCount >= share.maxOpens) return OPEN_EXHAUSTED;
        return OPEN_OK;
    }

    /// @notice All recorded fields of a share. `sender == address(0)` means unknown.
    function getShare(bytes32 shareId)
        external
        view
        returns (
            address sender,
            address recipient,
            bytes32 contentHash,
            uint32 maxOpens,
            uint32 openCount,
            uint64 createdAt,
            uint64 expiresAt,
            bool revoked,
            uint64 revokedAt
        )
    {
        Share storage s = _shares[shareId];
        return (s.sender, s.recipient, s.contentHash, s.maxOpens, s.openCount, s.createdAt, s.expiresAt, s.revoked, s.revokedAt);
    }

    function receiptCount(bytes32 shareId) external view returns (uint256) {
        return _receipts[shareId].length;
    }

    function receiptAt(bytes32 shareId, uint256 index) external view returns (uint64 openedAt, uint64 blockNumber) {
        OpenReceipt storage receipt = _receipts[shareId][index];
        return (receipt.openedAt, receipt.blockNumber);
    }

    function sharesBySenderCount(address sender) external view returns (uint256) {
        return _bySender[sender].length;
    }

    function sharesBySenderAt(address sender, uint256 index) external view returns (bytes32) {
        return _bySender[sender][index];
    }

    function sharesByRecipientCount(address recipient) external view returns (uint256) {
        return _byRecipient[recipient].length;
    }

    function sharesByRecipientAt(address recipient, uint256 index) external view returns (bytes32) {
        return _byRecipient[recipient][index];
    }
}
