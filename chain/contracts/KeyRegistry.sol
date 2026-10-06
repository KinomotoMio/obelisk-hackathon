// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.
pragma solidity ^0.8.28;

import {SignedActions} from "./utils/SignedActions.sol";

/// @title Obelisk key registry
/// @notice Wallet address -> encryption public key. A sender looks up the
/// recipient's key here and encrypts the share to it. Registering again
/// rotates the key; `version` counts registrations so clients can detect a
/// rotation.
/// @dev BOT Chain does not serve `eth_getLogs`, so every record is readable
/// through view functions, including enumeration of registered wallets.
contract KeyRegistry is SignedActions {
    bytes32 public constant REGISTER_KEY_TYPEHASH =
        keccak256("RegisterKey(address user,bytes pubKey,uint256 nonce,uint256 deadline)");

    /// @notice Upper bound on stored key bytes. Encryption keys are at most 65
    /// bytes; the headroom allows an algorithm prefix without inviting
    /// arbitrary data storage at the relayer's expense.
    uint256 public constant MAX_PUBKEY_LENGTH = 256;

    struct KeyRecord {
        bytes pubKey;
        uint64 updatedAt;
        uint32 version;
    }

    mapping(address user => KeyRecord) private _keys;
    address[] private _registered;

    event KeyRegistered(address indexed user, uint32 version, bytes pubKey);

    error InvalidPublicKeyLength(uint256 length);

    constructor() SignedActions("ObeliskKeyRegistry") {}

    /// @notice Register or rotate `user`'s encryption public key. Anyone may
    /// submit; only `user`'s signature authorizes it.
    function registerKeyBySig(
        address user,
        bytes calldata pubKey,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (pubKey.length == 0 || pubKey.length > MAX_PUBKEY_LENGTH) {
            revert InvalidPublicKeyLength(pubKey.length);
        }
        bytes32 structHash = keccak256(
            abi.encode(REGISTER_KEY_TYPEHASH, user, keccak256(pubKey), _useNonce(user), deadline)
        );
        _requireSignedBy(user, structHash, deadline, signature);

        KeyRecord storage record = _keys[user];
        if (record.version == 0) _registered.push(user);
        record.pubKey = pubKey;
        record.updatedAt = uint64(block.timestamp);
        record.version += 1;
        emit KeyRegistered(user, record.version, pubKey);
    }

    /// @notice Current key of `user`; empty `pubKey` and version 0 if never registered.
    function keyOf(address user) external view returns (bytes memory pubKey, uint64 updatedAt, uint32 version) {
        KeyRecord storage record = _keys[user];
        return (record.pubKey, record.updatedAt, record.version);
    }

    function isRegistered(address user) external view returns (bool) {
        return _keys[user].version != 0;
    }

    /// @notice Number of distinct wallets that have ever registered a key.
    function registeredCount() external view returns (uint256) {
        return _registered.length;
    }

    /// @notice The `index`-th wallet to register, in first-registration order.
    function registeredAt(uint256 index) external view returns (address) {
        return _registered[index];
    }
}
