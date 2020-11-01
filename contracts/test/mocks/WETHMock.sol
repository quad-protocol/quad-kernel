pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract WETHMock is ERC20 {

    using SafeMath for uint256;

    constructor(uint256 initialSupply) public ERC20("WETH", "WETH") {
        _mint(msg.sender, initialSupply);
    }

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _transfer(msg.sender, address(this), amount);
        address(uint160(msg.sender)).transfer(amount);
    }

}