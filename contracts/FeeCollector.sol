pragma solidity ^0.6.0;

import "./interfaces/IERC20MintableBurnable.sol";
import "@quad/quad-linker/contracts/upgradeable/GovernableUpgradeable.sol";

import "./interfaces/IFeeCollector.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

contract FeeCollector is IFeeCollector, GovernableUpgradeable {

    using SafeMath for uint256;

    struct FeeRecipient {
        uint256 shares;
        uint256 debt;
    }

    bytes32 internal FEE_COLLECTOR_ROLE;
    bytes32 internal QUAD_TOKEN_ROLE;
    bytes32 internal QUAD_VAULT_ROLE;

    uint256 private POINTS_MULTIPLIER;
    
    uint256 private _previousBalance;
    uint256 private _pointsPerShare;

    uint256 public _totalShares;
    uint256 public _burnShares;
    uint256 public _totalBurntAmount;

    uint256 public _vaultPoints;

    mapping(address => FeeRecipient) public _recipients;

    function init(uint256 burnShares, IAccessControl accessControl) public {
        POINTS_MULTIPLIER = 2 ** 128;
        FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
        QUAD_TOKEN_ROLE = keccak256("QUAD_TOKEN_ROLE");
        QUAD_VAULT_ROLE = keccak256("QUAD_VAULT_ROLE");
        super._init(FEE_COLLECTOR_ROLE, true, accessControl);
        requestRole(keccak256("NO_FEE_ROLE"), address(this), false);
        subscribeSingleton(QUAD_TOKEN_ROLE, FEE_COLLECTOR_ROLE);
        subscribeSingleton(QUAD_VAULT_ROLE, FEE_COLLECTOR_ROLE);
        _burnShares = burnShares;
        _totalShares = burnShares;
        _vaultPoints = 9000;
    }

    function addRecipient(address addr, uint256 shares) external override onlyRoot {
        require(_recipients[addr].shares == 0, "Recipient already exists");
        _addRecipient(addr, shares);
    }

    function _addRecipient(address addr, uint256 shares) internal {
        distributeFees();
        _totalShares = _totalShares.add(shares);

        FeeRecipient memory recipient;
        recipient.shares = shares;
        recipient.debt = _pointsPerShare.mul(shares).div(POINTS_MULTIPLIER);

        _recipients[addr] = recipient;
    }

    function removeRecipient(address addr) external override onlyRoot {
        FeeRecipient storage recipient = _recipients[addr];

        require(recipient.shares > 0, "Recipient doesn't exist");
        distributeFees();

        _withdraw(addr);

        _totalShares = _totalShares.sub(recipient.shares);
        recipient.shares = 0;
        recipient.debt = 0;
    }

    function activateVaultFees() external override {
        require(hasRole(QUAD_VAULT_ROLE, msg.sender), "Not the vault");

        FeeRecipient storage vault = _recipients[msg.sender];
        
        if (vault.shares == 0)
            _addRecipient(msg.sender, _vaultPoints);
    }

    function distributeFees() public override {
        if (_totalShares == 0)
            return;

        uint256 newBalance;
        uint256 toBeBurnt;
        (newBalance, _pointsPerShare, toBeBurnt) = distributeFeesView();
        
        IERC20MintableBurnable(resolveSingleton(QUAD_TOKEN_ROLE)).burn(toBeBurnt);
        _totalBurntAmount = _totalBurntAmount.add(toBeBurnt);
        _previousBalance = newBalance.sub(toBeBurnt);
    }

    function distributeFeesView() internal view returns (uint256 newBalance, uint256 newPointsPerShare, uint256 burnAmount) {
        if (_totalShares == 0)
            return (0, 0, 0);

        address token = resolveSingleton(QUAD_TOKEN_ROLE);
        newBalance = IERC20MintableBurnable(token).balanceOf(address(this));
        uint256 multipliedFees = newBalance.sub(_previousBalance).mul(POINTS_MULTIPLIER);

        newPointsPerShare = _pointsPerShare.add(multipliedFees.div(_totalShares));

        burnAmount = _burnShares.mul(newPointsPerShare)
            .div(POINTS_MULTIPLIER)
            .sub(_totalBurntAmount);
    }

    function getWithdrawableFees(address addr) public view override returns (uint256) {
        FeeRecipient storage recipient = _recipients[addr];

        (, uint256 pointsPerShare,) = distributeFeesView();

        return recipient.shares.mul(pointsPerShare)
            .div(POINTS_MULTIPLIER)
            .sub(recipient.debt);
    }

    function getPendingBurnAmount() external view override returns (uint256 toBeBurnt) {
        (,, toBeBurnt) = distributeFeesView();
    }

    function changeBurnShares(uint256 burnShares) external override onlyGovernor {
        distributeFees();
        
        _totalShares = _totalShares.sub(_burnShares).add(burnShares);
        _burnShares = burnShares;
    }

    function withdraw() external override returns (uint256) {
        return _withdraw(msg.sender);
    }

    function _withdraw(address addr) internal returns (uint256 withdrawAmount) {
        FeeRecipient storage recipient = _recipients[addr];
        require(recipient.shares > 0, "Recipient doesn't exist");

        distributeFees();

        withdrawAmount = getWithdrawableFees(addr);

        if (withdrawAmount > 0) {
            IERC20MintableBurnable(resolveSingleton(QUAD_TOKEN_ROLE)).transfer(msg.sender, withdrawAmount);
            _previousBalance = _previousBalance.sub(withdrawAmount);
            recipient.debt = recipient.debt.add(withdrawAmount);
        }
    }

}