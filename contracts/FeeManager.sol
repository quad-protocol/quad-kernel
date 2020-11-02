pragma solidity ^0.6.0;

import "@quad/quad-linker/contracts/Governable.sol";

import "./interfaces/IFeeManager.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

contract FeeManager is IFeeManager, Governable {

    using SafeMath for uint256;

    uint256 public _feeBips;

    bytes32 internal constant NO_FEE_ROLE = keccak256("NO_FEE_ROLE");
    bytes32 internal constant NO_FEE_RECIPIENT_ROLE = keccak256("NO_FEE_RECIPIENT_ROLE");
    bytes32 internal constant FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
    bytes32 internal constant FEE_MANAGER_ROLE = keccak256("FEE_MANAGER_ROLE");

    constructor(uint256 feeBips, IAccessControl accessControl) public Governable(FEE_MANAGER_ROLE, true, accessControl) {
        _feeBips = feeBips;
        subscribe(NO_FEE_ROLE, FEE_MANAGER_ROLE);
        subscribe(NO_FEE_RECIPIENT_ROLE, FEE_MANAGER_ROLE);
        subscribeSingleton(FEE_COLLECTOR_ROLE, FEE_MANAGER_ROLE);
    }

    function calculateFee(address sender, address recipient, uint256 amount) external view override returns (uint256 feeAmount, address feeRecipient) {
        if (hasRole(NO_FEE_ROLE, sender) || hasRole(NO_FEE_RECIPIENT_ROLE, recipient))
            return (0, address(0));

        return (amount.mul(_feeBips).div(10000), resolveSingleton(FEE_COLLECTOR_ROLE));
    }

    function changeFeeBips(uint256 newFee) public override onlyGovernor {
        require(newFee <= 10000, "Cannot set a fee superior to 10000 basis points");

        uint256 oldFee = _feeBips;
        _feeBips = newFee;

        emit FeeBipsChanged(newFee, oldFee);
    }

}