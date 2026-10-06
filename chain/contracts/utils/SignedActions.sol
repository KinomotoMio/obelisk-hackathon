// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 tommy0103 and contributors.
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @notice Base for contracts whose every write is a user-signed EIP-712
/// action submitted by a relayer. The relayer (`msg.sender`) only pays gas; the
/// actor is always the address that signed the typed data.
///
/// Each action's struct hash must include `_useNonce(user)` so a signature is
/// valid exactly once. A replayed signature therefore hashes against a newer
/// nonce and fails as {InvalidSignature}.
///
/// Signatures are checked with OpenZeppelin `SignatureChecker`: plain ECDSA for
/// externally owned accounts, ERC-1271 for smart-contract wallets, so the later
/// "connect an external wallet" path does not need a contract change.
abstract contract SignedActions is EIP712, Nonces {
    /// @dev The signed `deadline` has passed.
    error SignatureExpired(uint256 deadline);
    /// @dev The signature was not produced by `user` for this exact action and nonce.
    error InvalidSignature(address user);

    constructor(string memory name) EIP712(name, "1") {}

    /// @notice EIP-712 domain separator for this deployment (chain id and address bound).
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _requireSignedBy(
        address user,
        bytes32 structHash,
        uint256 deadline,
        bytes calldata signature
    ) internal view {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        if (!SignatureChecker.isValidSignatureNowCalldata(user, _hashTypedDataV4(structHash), signature)) {
            revert InvalidSignature(user);
        }
    }
}
