pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@quad/quad-linker/contracts/RemoteAccessControl.sol";

import "./interfaces/IFeeManager.sol";
import "./interfaces/ITransferManager.sol";

contract QuadToken is ERC20Burnable, RemoteAccessControl {

    bytes32 internal constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");
    bytes32 internal constant TRANSFER_MANAGER_ROLE = keccak256("TRANSFER_MANAGER_ROLE");
    bytes32 internal constant LGE_ROLE = keccak256("LGE_ROLE");
    bytes32 internal constant QUAD_TOKEN_ROLE = keccak256("QUAD_TOKEN_ROLE");

    constructor(string memory name, string memory symbol, uint8 decimals, uint256 totalSupply, 
                IAccessControl accessControl) public ERC20(name, symbol) RemoteAccessControl(QUAD_TOKEN_ROLE, true,  accessControl) {
        _mint(_msgSender(), totalSupply);
        subscribeSingleton(FEE_MANAGER_ROLE, QUAD_TOKEN_ROLE);
        subscribeSingleton(TRANSFER_MANAGER_ROLE, QUAD_TOKEN_ROLE);
        subscribe(LGE_ROLE, QUAD_TOKEN_ROLE);
    }

    modifier onlyMinter() {
        require(hasRole(LGE_ROLE, msg.sender), "Sender isn't the minter");
        _;
    }

    function _transfer(address sender, address recipient, uint256 amount) internal override {
        ITransferManager(resolveSingleton(TRANSFER_MANAGER_ROLE)).checkTransfer(sender, recipient);
        (uint256 feeAmount, address feeRecipient) = IFeeManager(resolveSingleton(FEE_MANAGER_ROLE)).calculateFee(sender, recipient, amount);

        if (feeAmount > 0)
            super._transfer(sender, feeRecipient, feeAmount);

        super._transfer(sender, recipient, amount.sub(feeAmount));
    }

    function mint(address to, uint256 amount) external onlyMinter returns (bool) {
        _mint(to, amount);
        return true;
    }
}