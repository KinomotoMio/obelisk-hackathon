// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.28;

import {SignedActions} from "./utils/SignedActions.sol";
import {SkillRegistry} from "./SkillRegistry.sol";

/// @notice Version-specific offers, creator-selected licenses and genealogy royalties.
/// All receipts and allocations are enumerable without eth_getLogs (BOT Chain).
contract SkillMarket is SignedActions {
    uint256 private constant BPS = 10000;
    uint256 public constant MAX_DEPTH = 16;
    bytes32 public constant LIST_TYPEHASH = keccak256("ListSkill(address author,uint256 skillId,uint256 versionIndex,uint8 mode,uint8 license,uint256 price,uint16 royaltyBps,uint256 nonce,uint256 deadline)");
    bytes32 public constant BUY_TYPEHASH = keccak256("BuySkill(address buyer,uint256 offerId,uint256 nonce,uint256 deadline)");
    bytes32 public constant USE_TYPEHASH = keccak256("UseSkill(address buyer,uint256 offerId,uint256 nonce,uint256 deadline)");
    SkillRegistry public immutable registry;
    address public immutable platform;
    uint16 public immutable platformBps;
    // mode: 0 free, 1 per retrieval, 2 perpetual access to this version.
    // license: 0 personal, 1 commercial. No transfer of copyright.
    struct Offer {
        uint256 skillId;
        uint256 versionIndex;
        bytes32 fingerprint;
        address author;
        uint256 price;
        uint8 mode;
        uint8 license;
    }
    struct Receipt { uint256 offerId; address buyer; uint256 amount; uint64 timestamp; }
    struct Allocation { address recipient; uint256 amount; uint256 skillId; }
    Offer[] private _offers;
    Receipt[] private _receipts;
    mapping(uint256 => Allocation[]) private _allocations;
    mapping(address => uint256[]) private _incomeReceipts;
    mapping(address => uint256) public totalIncome;
    mapping(address => uint256[]) private _purchases;
    mapping(bytes32 => uint256) public latestOffer;
    mapping(uint256 => bool) public royaltySet;
    mapping(uint256 => uint16) public royaltyBps;
    mapping(uint256 => uint256) public depth;
    mapping(address => mapping(uint256 => uint256)) public credits;
    mapping(address => mapping(uint256 => bool)) public licensed;
    mapping(address => mapping(bytes32 => mapping(uint8 => bool))) public perpetual;
    bool private _entered;

    error InvalidOffer();
    error NotAuthor();
    error ParentNotListed();
    error RoyaltyLocked();
    error WrongPayment();
    error AlreadyLicensed();
    error NoAccess();
    error TransferFailed();
    error Reentrant();
    event Listed(uint256 indexed offerId, uint256 indexed skillId, bytes32 fingerprint);
    event Purchased(uint256 indexed receiptId, uint256 indexed offerId, address indexed buyer);
    event Allocated(uint256 indexed receiptId, address indexed recipient, uint256 amount, uint256 skillId);
    event Used(address indexed buyer, uint256 indexed offerId);

    modifier guarded() {
        if (_entered) revert Reentrant();
        _entered = true;
        _;
        _entered = false;
    }

    constructor(address skills, address platformWallet, uint16 feeBps) SignedActions("ObeliskSkillMarket") {
        if (skills == address(0) || platformWallet == address(0) || feeBps > 2000) revert InvalidOffer();
        registry = SkillRegistry(skills);
        platform = platformWallet;
        platformBps = feeBps;
        _offers.push();
        _receipts.push();
    }

    function listBySig(address author, uint256 skillId, uint256 versionIndex, uint8 mode, uint8 license,
        uint256 price, uint16 upstreamRoyaltyBps, uint256 deadline, bytes calldata signature)
        external guarded returns (uint256 offerId)
    {
        _requireSignedBy(author, keccak256(abi.encode(LIST_TYPEHASH, author, skillId, versionIndex, mode, license,
            price, upstreamRoyaltyBps, _useNonce(author), deadline)), deadline, signature);
        (address owner, uint256 parent,,,) = registry.getSkill(skillId);
        if (owner != author) revert NotAuthor();
        if (mode > 2 || license > 1 || upstreamRoyaltyBps > BPS || (mode == 0 ? price != 0 : price == 0)) revert InvalidOffer();
        if (!royaltySet[skillId]) {
            if (parent != 0 && !royaltySet[parent]) revert ParentNotListed();
            uint256 d = parent == 0 ? 1 : depth[parent] + 1;
            if (d > MAX_DEPTH) revert InvalidOffer();
            depth[skillId] = d;
            royaltySet[skillId] = true;
            royaltyBps[skillId] = upstreamRoyaltyBps;
        } else if (royaltyBps[skillId] != upstreamRoyaltyBps) revert RoyaltyLocked();
        (bytes32 fingerprint,) = registry.versionAt(skillId, versionIndex);
        offerId = _offers.length;
        _offers.push(Offer(skillId, versionIndex, fingerprint, author, price, mode, license));
        latestOffer[fingerprint] = offerId;
        emit Listed(offerId, skillId, fingerprint);
    }

    /// @notice Signed offer id pins price and license. The transaction sender supplies
    /// the principal; production callers must obtain it from the buyer, not gas sponsorship.
    function buyBySig(address buyer, uint256 offerId, uint256 deadline, bytes calldata signature)
        external payable guarded returns (uint256 receiptId)
    {
        Offer memory offer = getOffer(offerId);
        if (latestOffer[offer.fingerprint] != offerId) revert InvalidOffer();
        if (msg.value != offer.price) revert WrongPayment();
        _requireSignedBy(buyer, keccak256(abi.encode(BUY_TYPEHASH, buyer, offerId, _useNonce(buyer), deadline)), deadline, signature);
        if (perpetual[buyer][offer.fingerprint][offer.license]) revert AlreadyLicensed();
        if (offer.mode == 1) credits[buyer][offerId]++;
        else {
            licensed[buyer][offerId] = true;
            perpetual[buyer][offer.fingerprint][offer.license] = true;
        }
        receiptId = _receipts.length;
        _receipts.push(Receipt(offerId, buyer, msg.value, uint64(block.timestamp)));
        _purchases[buyer].push(receiptId);
        uint256 fee = msg.value * platformBps / BPS;
        _pay(receiptId, platform, fee, 0);
        uint256 remaining = msg.value - fee;
        uint256 current = offer.skillId;
        while (current != 0) {
            (address author, uint256 parent,,,) = registry.getSkill(current);
            uint256 inherited = parent == 0 ? 0 : remaining * royaltyBps[parent] / BPS;
            _pay(receiptId, author, remaining - inherited, current);
            remaining = inherited;
            current = parent;
        }
        emit Purchased(receiptId, offerId, buyer);
    }

    /// @notice A paid use means one authorized content retrieval, not one unobservable
    /// local AI execution. Previously delivered plaintext cannot be revoked.
    function useBySig(address buyer, uint256 offerId, uint256 deadline, bytes calldata signature) external guarded {
        Offer memory offer = getOffer(offerId);
        _requireSignedBy(buyer, keccak256(abi.encode(USE_TYPEHASH, buyer, offerId, _useNonce(buyer), deadline)), deadline, signature);
        if (offer.mode == 1) {
            if (credits[buyer][offerId] == 0) revert NoAccess();
            credits[buyer][offerId]--;
        } else if (!licensed[buyer][offerId]) revert NoAccess();
        emit Used(buyer, offerId);
    }

    function _pay(uint256 receiptId, address recipient, uint256 amount, uint256 skillId) private {
        _allocations[receiptId].push(Allocation(recipient, amount, skillId));
        uint256[] storage receipts = _incomeReceipts[recipient];
        if (receipts.length == 0 || receipts[receipts.length - 1] != receiptId) receipts.push(receiptId);
        totalIncome[recipient] += amount;
        if (amount != 0) {
            (bool ok,) = payable(recipient).call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
        emit Allocated(receiptId, recipient, amount, skillId);
    }

    function getOffer(uint256 id) public view returns (Offer memory) {
        if (id == 0 || id >= _offers.length) revert InvalidOffer();
        return _offers[id];
    }
    function offerCount() external view returns (uint256) { return _offers.length - 1; }
    function receiptCount() external view returns (uint256) { return _receipts.length - 1; }
    function getReceipt(uint256 id) external view returns (Receipt memory) { return _receipts[id]; }
    function allocations(uint256 id) external view returns (Allocation[] memory) { return _allocations[id]; }
    function incomeCount(address wallet) external view returns (uint256) { return _incomeReceipts[wallet].length; }
    function incomeAt(address wallet, uint256 index) external view returns (uint256) { return _incomeReceipts[wallet][index]; }
    function purchaseCount(address wallet) external view returns (uint256) { return _purchases[wallet].length; }
    function purchaseAt(address wallet, uint256 index) external view returns (uint256) { return _purchases[wallet][index]; }
}
