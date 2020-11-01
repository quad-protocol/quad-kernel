pragma solidity ^0.6.0;

interface IQuadVault {
    event Deposit(address indexed user, address indexed poolToken, uint256 amount);
    event Withdrawal(address indexed user, address indexed poolToken, uint256 amount);
    event EmergencyWithdrawal(address indexed user, address indexed poolToken);
    event PoolAdded(address indexed poolToken);

    function activePoolsLength() external view returns (uint256);

    function getUserData(address tokenAddress, address userAddress) external view returns (uint256 stakedAmount, uint256 pendingRewards, uint256 paidAmount, uint256 lockedTokens);

    function massUpdatePools() external;

    function deposit(address poolToken, uint256 amount) external;

    function withdraw(address poolToken, uint256 amount) external;

    function emergencyWithdraw(address poolToken) external;

    function lockTokens(address target, address token, uint256 amount) external;
    function unlockTokens(address target, address token, uint256 amount) external;
}