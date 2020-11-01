pragma solidity ^0.6.0;

interface IFeeManager {
    
    event FeeBipsChanged(uint256 indexed newFee, uint256 indexed oldFee);

    function calculateFee(address sender, address recipient, uint256 amount) external view returns (uint256, address);

    function changeFeeBips(uint256 newFee) external;
}