pragma solidity ^0.6.0;

interface ITransferManager {

    event Sync(uint256 indexed timestamp, uint256 indexed blockNumber);

    function checkTransfer(address sender, address recipient) external;

    function syncAll() external;
}