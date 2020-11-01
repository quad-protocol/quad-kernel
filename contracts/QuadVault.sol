pragma solidity ^0.6.0;

import "@quad/quad-linker/contracts/upgradeable/RemoteAccessControlUpgradeable.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IFeeCollector.sol";
import "./interfaces/IQuadVault.sol";
import "./interfaces/ILPTokenWrapper.sol";
import "@quad/quad-linker/contracts/interfaces/IAccessControl.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";

contract QuadVault is RemoteAccessControlUpgradeable, IQuadVault {
    using SafeMath for uint256;

    struct Pool {
        bool active;
        uint256 stakedTokens;
        uint256 rewardsPerShare;
        mapping(address => User) stakers;
    }

    struct User {
        uint256 stakedAmount; 
        uint256 rewardDebt; 
        uint256 paidAmount;
        uint256 lockedTokens;
    }

    struct FeeAnalytic {
        uint256 startBlock;
        uint256 endBlock;
        uint256 totalFees;
    }

    bytes32 internal FEE_COLLECTOR_ROLE;
    bytes32 internal GOVERNANCE_ROLE;
    bytes32 internal QUAD_TOKEN_ROLE;
    bytes32 internal QUAD_VAULT_ROLE;
    bytes32 internal WRAPPED_LP_ROLE;

    uint256 private POINTS_MULTIPLIER;

    uint256 public override activePoolsLength;
    mapping(address => Pool) public _pools;
    mapping(uint256 => address) public _poolTokens;

    uint256 public ANALYTIC_PERIOD;
    uint256 public currentAnalyticIndex;
    mapping(uint256 => FeeAnalytic) public analytics;

    event Deposit(address indexed user, address indexed poolToken, uint256 amount);
    event Withdrawal(address indexed user, address indexed poolToken, uint256 amount);
    event EmergencyWithdrawal(address indexed user, address indexed poolToken);
    event PoolAdded(address indexed poolToken);

    modifier onlyGovernance() {
        require(hasRole(GOVERNANCE_ROLE, msg.sender), "Address isn't governance");
        _;
    }

    modifier isPoolToken(address token) {
        require(hasRole(WRAPPED_LP_ROLE, token), "Address isn't a pool token");
        _;
    }

    function _init(IAccessControl accessControl) public {
        QUAD_TOKEN_ROLE = keccak256("QUAD_TOKEN_ROLE");
        FEE_COLLECTOR_ROLE = keccak256("FEE_COLLECTOR_ROLE");
        GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
        QUAD_VAULT_ROLE = keccak256("QUAD_VAULT_ROLE");
        WRAPPED_LP_ROLE = keccak256("WRAPPED_LP_ROLE");
        POINTS_MULTIPLIER = 2 ** 128;
        ANALYTIC_PERIOD = 6000; //approx a day
        super._init(QUAD_VAULT_ROLE, true, accessControl);
        subscribeSingleton(QUAD_TOKEN_ROLE, QUAD_VAULT_ROLE);
        subscribeSingleton(FEE_COLLECTOR_ROLE, QUAD_VAULT_ROLE);
        subscribe(WRAPPED_LP_ROLE, QUAD_VAULT_ROLE);
        subscribe(GOVERNANCE_ROLE, QUAD_VAULT_ROLE);
    }

    function getMultipleAnalytics(uint256 startIndex, uint256 endIndex) external view returns (uint256 startBlock, uint256 endBlock, uint256 feeAmount) {
        if (startIndex > endIndex || startIndex > currentAnalyticIndex)
            return (0, 0, 0);
        
        startBlock = analytics[startIndex].startBlock;
        endBlock = analytics[endIndex].endBlock;

        if (endBlock == 0) {
            endBlock = block.number;
            feeAmount = IFeeCollector(resolveSingleton(FEE_COLLECTOR_ROLE)).getWithdrawableFees(address(this));
        }

        for (uint256 i = startIndex; i <= endIndex; i++)
            feeAmount = feeAmount.add(analytics[i].totalFees);
    }

    function getUserData(address tokenAddress, address userAddress) external view override returns (uint256 stakedAmount, uint256 pendingRewards, uint256 paidAmount, uint256 lockedTokens) {
        User storage user = _pools[tokenAddress].stakers[userAddress];

        uint256 rewardsPerShare = _updatePoolView(tokenAddress, IFeeCollector(resolveSingleton(FEE_COLLECTOR_ROLE)).getWithdrawableFees(address(this)));
        if (rewardsPerShare == 0 || user.stakedAmount == 0)
            pendingRewards = 0;
        else
            pendingRewards = user.stakedAmount.mul(rewardsPerShare)
                .div(POINTS_MULTIPLIER)
                .sub(user.rewardDebt);

        return (user.stakedAmount, pendingRewards, user.paidAmount, user.lockedTokens);
    }

    function massUpdatePools() public override {
        IFeeCollector feeCollector = IFeeCollector(resolveSingleton(FEE_COLLECTOR_ROLE));
        feeCollector.distributeFees();
        uint256 totalPending = feeCollector.withdraw();

        if (totalPending == 0)
            return;
        
        updateAnalytics(totalPending);
        
        for (uint256 i = 0; i < activePoolsLength; i++) {
            updatePool(_poolTokens[i], totalPending);
        }
    }

    function updateAnalytics(uint256 newFees) internal {
        FeeAnalytic storage currentAnalytic = analytics[currentAnalyticIndex];

        //if this is the first deposit ever
        if (currentAnalytic.startBlock == 0)
            currentAnalytic.startBlock = block.number;

        if (block.number.sub(currentAnalytic.startBlock) >= ANALYTIC_PERIOD) {
            currentAnalytic.endBlock = block.number;
            currentAnalyticIndex++;
            analytics[currentAnalyticIndex] = FeeAnalytic(
                block.number,
                0,
                0
            );
        }

        currentAnalytic.totalFees = currentAnalytic.totalFees.add(newFees);
    }

    function updatePool(address poolToken, uint256 totalPending) internal {
        _pools[poolToken].rewardsPerShare = _updatePoolView(poolToken, totalPending);
    }

    function _updatePoolView(address poolToken, uint256 totalPending) internal view returns (uint256) {
        Pool storage pool = _pools[poolToken];
        
        if (pool.stakedTokens == 0 || totalPending == 0 || activePoolsLength == 0)
            return pool.rewardsPerShare;

        uint256 poolRewards = totalPending.div(activePoolsLength);

        return pool.rewardsPerShare.add(
            poolRewards.mul(POINTS_MULTIPLIER).div(pool.stakedTokens)
        );
    }

    function wrapAndDeposit(address poolToken, uint256 amount) external isPoolToken(poolToken) {
        require(amount > 0, "Insufficient wrap amount");

        IERC20 backingLPToken = IERC20(ILPTokenWrapper(poolToken)._lpToken());
        require(backingLPToken.transferFrom(msg.sender, address(this), amount));
        require(backingLPToken.approve(poolToken, amount));

        ILPTokenWrapper(poolToken).deposit(amount);

        _deposit(poolToken, msg.sender, amount);
    }

    function deposit(address poolToken, uint256 amount) external override isPoolToken(poolToken) {
        if(amount > 0) 
            require(IERC20(poolToken).transferFrom(msg.sender, address(this), amount));

        _deposit(poolToken, msg.sender, amount);
    }

    function _deposit(address poolToken, address from, uint256 amount) internal {
        Pool storage pool = _pools[poolToken];
        User storage user = pool.stakers[from];

        if (!pool.active) {
            require(amount > 0, "Pool is inactive");

            if (activePoolsLength == 0)
                IFeeCollector(resolveSingleton(FEE_COLLECTOR_ROLE)).activateVaultFees();

            _poolTokens[activePoolsLength] = poolToken;
            pool.active = true;
            activePoolsLength++;
        }

        massUpdatePools();

        if(user.stakedAmount > 0) {
            uint256 accruedRewards = user.stakedAmount.mul(pool.rewardsPerShare)
                .div(POINTS_MULTIPLIER)
                .sub(user.rewardDebt);

            if (accruedRewards > 0) {
                IERC20(resolveSingleton(QUAD_TOKEN_ROLE)).transfer(from, user.stakedAmount);
                user.paidAmount = user.paidAmount.add(accruedRewards);
            }
        }

        if(amount > 0) {
            pool.stakedTokens = pool.stakedTokens.add(amount);
            user.stakedAmount = user.stakedAmount.add(amount);
        }

        user.rewardDebt = user.stakedAmount.mul(pool.rewardsPerShare)
            .div(POINTS_MULTIPLIER);
        emit Deposit(from, poolToken, amount);
    }

    function withdraw(address poolToken, uint256 amount) external override isPoolToken(poolToken) {
        Pool storage pool = _pools[poolToken];
        require(pool.active, "Pool isn't active");

        User storage user = pool.stakers[msg.sender];
        require(user.stakedAmount >= amount.add(user.lockedTokens), "Insufficient unlocked balance");

        massUpdatePools();

        if (user.stakedAmount > 0) {
            uint256 accruedRewards = user.stakedAmount.mul(pool.rewardsPerShare)
                .div(POINTS_MULTIPLIER)
                .sub(user.rewardDebt);

            if (accruedRewards > 0) {
                require(IERC20(resolveSingleton(QUAD_TOKEN_ROLE)).transfer(msg.sender, accruedRewards));
                user.paidAmount = user.paidAmount.add(accruedRewards);
            }
        }

        if(amount > 0) {
            require(IERC20(poolToken).transfer(msg.sender, amount));
            user.stakedAmount = user.stakedAmount.sub(amount);
            pool.stakedTokens = pool.stakedTokens.sub(amount);
        }

        user.rewardDebt = user.stakedAmount.mul(pool.rewardsPerShare)
            .div(POINTS_MULTIPLIER);

        emit Withdrawal(msg.sender, poolToken, amount);
    }

    function emergencyWithdraw(address poolToken) external override isPoolToken(poolToken) {
        Pool storage pool = _pools[poolToken];
        User storage user = pool.stakers[msg.sender];

        require(user.lockedTokens < user.stakedAmount, "Unlocked balance is 0");

        uint256 amountToWithdraw = user.stakedAmount.sub(user.lockedTokens);
        IERC20(poolToken).transfer(msg.sender, amountToWithdraw);
        user.stakedAmount = user.lockedTokens;
        pool.stakedTokens = pool.stakedTokens.sub(amountToWithdraw);

        emit EmergencyWithdrawal(msg.sender, poolToken);
    }

    function lockTokens(address target, address token, uint256 amount) external override onlyGovernance isPoolToken(token) {
        Pool storage pool = _pools[token];
        require(pool.active, "Pool isn't active");

        User storage user = pool.stakers[target];
        uint256 newLockedAmount = amount.add(user.lockedTokens);
        require(user.stakedAmount >= newLockedAmount, "Insufficient unlocked balance");
        user.lockedTokens = newLockedAmount;
    }

    function unlockTokens(address target, address token, uint256 amount) external override onlyGovernance isPoolToken(token) {
        Pool storage pool = _pools[token];
        require(pool.active, "Pool isn't active");

        User storage user = pool.stakers[target];
        require(user.lockedTokens >= amount, "Insufficient locked balance");
        user.lockedTokens = user.lockedTokens.sub(amount);
    }

}