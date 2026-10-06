// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.
pragma solidity ^0.8.28;

import {SignedActions} from "./utils/SignedActions.sol";

/// @title Obelisk Skill assets
/// @notice A Skill is minted by its author with the fingerprint of its first
/// version (sha256 of the normalized Skill body, computed off-chain), the
/// scene tags it was distilled from, and optionally the parent Skill it was
/// derived from. The author can publish further versions. Each fingerprint
/// can be claimed once across all Skills, so the chain shows who minted a
/// given body first.
///
/// Skill ids start at 1; `parentSkillId == 0` means "no parent". Parents must
/// already exist, so the genealogy is always a forest of trees.
///
/// @dev BOT Chain does not serve `eth_getLogs`; Skills, versions, the
/// per-author list, and each Skill's children are readable through views.
contract SkillRegistry is SignedActions {
    bytes32 public constant MINT_SKILL_TYPEHASH = keccak256(
        "MintSkill(address author,bytes32 fingerprint,string[] birthScenes,uint256 parentSkillId,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant PUBLISH_VERSION_TYPEHASH = keccak256(
        "PublishVersion(address author,uint256 skillId,bytes32 fingerprint,uint256 nonce,uint256 deadline)"
    );

    /// @notice Birth scenes are tags from a fixed off-chain list; these bounds
    /// keep a mint's storage cost predictable for the relayer that pays it.
    uint256 public constant MAX_BIRTH_SCENES = 16;
    uint256 public constant MAX_SCENE_LENGTH = 64;

    struct Version {
        bytes32 fingerprint;
        uint64 publishedAt;
    }

    struct Skill {
        address author;
        uint64 createdAt;
        uint256 parentSkillId;
        string[] birthScenes;
        Version[] versions;
    }

    struct FingerprintRef {
        uint256 skillId;
        uint256 versionIndex;
    }

    /// @dev Index 0 is unused so that id 0 can mean "none".
    Skill[] private _skills;
    mapping(bytes32 fingerprint => FingerprintRef) private _byFingerprint;
    mapping(address author => uint256[]) private _byAuthor;
    mapping(uint256 parentSkillId => uint256[]) private _children;

    event SkillMinted(uint256 indexed skillId, address indexed author, uint256 indexed parentSkillId, bytes32 fingerprint);
    event SkillVersionPublished(uint256 indexed skillId, uint256 versionIndex, bytes32 fingerprint);

    error InvalidFingerprint();
    error FingerprintTaken(bytes32 fingerprint, uint256 skillId);
    error UnknownSkill(uint256 skillId);
    error NotAuthor(uint256 skillId, address caller);
    error TooManyBirthScenes(uint256 count);
    error InvalidBirthScene(uint256 index);

    constructor() SignedActions("ObeliskSkillRegistry") {
        _skills.push();
    }

    /// @notice Mint a new Skill whose first version is `fingerprint`.
    function mintBySig(
        address author,
        bytes32 fingerprint,
        string[] calldata birthScenes,
        uint256 parentSkillId,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 skillId) {
        _requireUnusedFingerprint(fingerprint);
        if (parentSkillId != 0 && parentSkillId >= _skills.length) revert UnknownSkill(parentSkillId);
        bytes32 scenesHash = _hashBirthScenes(birthScenes);

        bytes32 structHash = keccak256(
            abi.encode(MINT_SKILL_TYPEHASH, author, fingerprint, scenesHash, parentSkillId, _useNonce(author), deadline)
        );
        _requireSignedBy(author, structHash, deadline, signature);

        skillId = _skills.length;
        Skill storage skill = _skills.push();
        skill.author = author;
        skill.createdAt = uint64(block.timestamp);
        skill.parentSkillId = parentSkillId;
        for (uint256 i = 0; i < birthScenes.length; ++i) {
            skill.birthScenes.push(birthScenes[i]);
        }
        skill.versions.push(Version({fingerprint: fingerprint, publishedAt: uint64(block.timestamp)}));
        _byFingerprint[fingerprint] = FingerprintRef({skillId: skillId, versionIndex: 0});
        _byAuthor[author].push(skillId);
        if (parentSkillId != 0) _children[parentSkillId].push(skillId);

        emit SkillMinted(skillId, author, parentSkillId, fingerprint);
        emit SkillVersionPublished(skillId, 0, fingerprint);
    }

    /// @notice Publish a new version of `skillId`. Only its author can.
    function publishVersionBySig(
        address author,
        uint256 skillId,
        bytes32 fingerprint,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 versionIndex) {
        _requireUnusedFingerprint(fingerprint);
        Skill storage skill = _skillOrRevert(skillId);

        bytes32 structHash =
            keccak256(abi.encode(PUBLISH_VERSION_TYPEHASH, author, skillId, fingerprint, _useNonce(author), deadline));
        _requireSignedBy(author, structHash, deadline, signature);
        if (skill.author != author) revert NotAuthor(skillId, author);

        versionIndex = skill.versions.length;
        skill.versions.push(Version({fingerprint: fingerprint, publishedAt: uint64(block.timestamp)}));
        _byFingerprint[fingerprint] = FingerprintRef({skillId: skillId, versionIndex: versionIndex});
        emit SkillVersionPublished(skillId, versionIndex, fingerprint);
    }

    /// @notice Number of minted Skills; valid ids are 1..skillCount().
    function skillCount() external view returns (uint256) {
        return _skills.length - 1;
    }

    function getSkill(uint256 skillId)
        external
        view
        returns (address author, uint256 parentSkillId, uint64 createdAt, uint256 versionCount, string[] memory birthScenes)
    {
        Skill storage skill = _skillOrRevert(skillId);
        return (skill.author, skill.parentSkillId, skill.createdAt, skill.versions.length, skill.birthScenes);
    }

    /// @notice Version `index` of `skillId`; index 0 is the minted version.
    function versionAt(uint256 skillId, uint256 index) external view returns (bytes32 fingerprint, uint64 publishedAt) {
        Version storage version = _skillOrRevert(skillId).versions[index];
        return (version.fingerprint, version.publishedAt);
    }

    /// @notice Which Skill version a fingerprint belongs to; `skillId == 0` if none.
    function skillOfFingerprint(bytes32 fingerprint) external view returns (uint256 skillId, uint256 versionIndex) {
        FingerprintRef storage ref = _byFingerprint[fingerprint];
        return (ref.skillId, ref.versionIndex);
    }

    function skillsByAuthorCount(address author) external view returns (uint256) {
        return _byAuthor[author].length;
    }

    function skillsByAuthorAt(address author, uint256 index) external view returns (uint256) {
        return _byAuthor[author][index];
    }

    /// @notice Number of Skills that declared `parentSkillId` as their parent.
    function childrenCount(uint256 parentSkillId) external view returns (uint256) {
        return _children[parentSkillId].length;
    }

    function childAt(uint256 parentSkillId, uint256 index) external view returns (uint256) {
        return _children[parentSkillId][index];
    }

    function _skillOrRevert(uint256 skillId) private view returns (Skill storage) {
        if (skillId == 0 || skillId >= _skills.length) revert UnknownSkill(skillId);
        return _skills[skillId];
    }

    function _requireUnusedFingerprint(bytes32 fingerprint) private view {
        if (fingerprint == bytes32(0)) revert InvalidFingerprint();
        uint256 owner = _byFingerprint[fingerprint].skillId;
        if (owner != 0) revert FingerprintTaken(fingerprint, owner);
    }

    /// @dev EIP-712 encoding of `string[]`: keccak256 of the concatenated
    /// keccak256 of each string. Also enforces the tag bounds.
    function _hashBirthScenes(string[] calldata scenes) private pure returns (bytes32) {
        if (scenes.length > MAX_BIRTH_SCENES) revert TooManyBirthScenes(scenes.length);
        bytes32[] memory hashes = new bytes32[](scenes.length);
        for (uint256 i = 0; i < scenes.length; ++i) {
            uint256 length = bytes(scenes[i]).length;
            if (length == 0 || length > MAX_SCENE_LENGTH) revert InvalidBirthScene(i);
            hashes[i] = keccak256(bytes(scenes[i]));
        }
        return keccak256(abi.encodePacked(hashes));
    }
}
