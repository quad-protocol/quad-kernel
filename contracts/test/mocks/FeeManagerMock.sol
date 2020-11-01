pragma solidity ^0.6.0;

import "@openzeppelin/contracts/math/SafeMath.sol";

contract FeeManagerMock {

    using SafeMath for uint256;

    uint256 feeBips;

    function changeTransferFeeBips(uint256 _feeBips) external {
        feeBips = _feeBips;
    }

    function calculateFee(address sender, address recipient, uint256 amount) external view returns (uint256 feeAmount, address feeRecipient){
        return (amount.mul(feeBips).div(10000), address(this));
    }

}