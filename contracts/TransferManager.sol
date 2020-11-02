pragma solidity ^0.6.0;

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@quad/quad-linker/contracts/Killable.sol";

import "./interfaces/ITransferManager.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

contract TransferManager is ITransferManager, Killable {

    using SafeMath for uint256;

    uint256 internal unlockTimestamp;
    bool public alreadyUnlocked;

    mapping(address => uint256) private pairSupply;

    bytes32 internal constant LP_TOKEN_ROLE = keccak256("LP_TOKEN_ROLE");
    bytes32 internal constant TRANSFER_MANAGER_ROLE = keccak256("TRANSFER_MANAGER_ROLE");
    bytes32 internal constant LGE_ROLE = keccak256("LGE_ROLE");

    constructor(IAccessControl accessControl) public Killable(TRANSFER_MANAGER_ROLE, true, accessControl) {
        subscribe(LP_TOKEN_ROLE, TRANSFER_MANAGER_ROLE);
    }

    function checkTransfer(address sender, address recipient) external override {
        require(block.timestamp >= unlockTimestamp, "Trading is temporarely locked");

        bool isPool = hasRole(LP_TOKEN_ROLE, sender);

        if (isKilled() && now >= _killedTimestamp.add(2 days))
            require(isPool && IUniswapV2Pair(sender).totalSupply() < pairSupply[sender], "Only liquidity burns are allowed after the killswitch is triggered");
        else if (isPool)
            require(IUniswapV2Pair(sender).totalSupply() >= pairSupply[sender], "Liquidity burns are forbidden");

        syncAll();
    }

    function syncAll() public override {
        EnumerableSet.AddressSet storage pairs = resolve(LP_TOKEN_ROLE);
        for (uint256 i = 0; i < pairs.length(); i++) {
            address pair = pairs.at(i);
            pairSupply[pair] = IUniswapV2Pair(pair).totalSupply();
        }

        emit Sync(now, block.number);
    }

    function initialLock(uint256 duration) external override {
        require(!alreadyUnlocked, "Function has already been called");
        require(hasRole(LGE_ROLE, msg.sender), "Sender is not the lge");

        alreadyUnlocked = true;
        unlockTimestamp = block.timestamp.add(duration);

        syncAll();
    }



}