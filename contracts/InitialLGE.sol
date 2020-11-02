pragma solidity ^0.6.0;

import "@quad/quad-linker/contracts/RemoteAccessControl.sol";
import "./LPTokenWrapper.sol";

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/ITransferManager.sol";

import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract InitialQuadLGE is RemoteAccessControl {

    using SafeMath for uint256;
    using EnumerableSet for EnumerableSet.AddressSet;

    IUniswapV2Factory public _factory;
    IWETH public _weth;

    bytes32 internal constant WRAPPED_LP_ROLE = keccak256("WRAPPED_LP_ROLE");
    bytes32 internal constant LP_TOKEN_ROLE = keccak256("LP_TOKEN_ROLE");
    bytes32 internal constant TRANSFER_MANAGER_ROLE = keccak256("TRANSFER_MANAGER_ROLE");
    bytes32 internal constant LGE_ROLE = keccak256("LGE_ROLE");
    bytes32 internal constant KILLABLE_ROLE = keccak256("KILLABLE_ROLE");
    bytes32 internal constant QUAD_TOKEN_ROLE = keccak256("QUAD_TOKEN_ROLE");
    bytes32 internal constant NO_FEE_ROLE = keccak256("NO_FEE_ROLE");
    bytes32 internal constant NO_FEE_RECIPIENT_ROLE = keccak256("NO_FEE_RECIPIENT_ROLE");

    EnumerableSet.AddressSet private _pairingTokens;
    EnumerableSet.AddressSet private _wrappedLPTokens;
    mapping(address => address) _tokenToLP;
    mapping(address => uint256) _lpTokensMinted;

    mapping(address => uint256) public _contributions;
    uint256 public _totalContributions;

    uint256 constant private MAGNITUDE = 2 ** 128;

    uint256 public _endTimestamp;

    bool public _liquidityAdded;

    constructor(IAccessControl accessControl, IUniswapV2Factory factory, IWETH weth) public RemoteAccessControl(LGE_ROLE, false, accessControl) {
        _factory = factory;
        _weth = weth;
        requestRole(NO_FEE_ROLE, address(this), false);
        requestRole(NO_FEE_RECIPIENT_ROLE, address(this), false);
        subscribeSingleton(QUAD_TOKEN_ROLE, LGE_ROLE);
        subscribeSingleton(TRANSFER_MANAGER_ROLE, LGE_ROLE);
    }

    modifier LGENotStarted() {
        require(_endTimestamp == 0 , "LGE started");
        _;
    }

    modifier LGEOngoing() {
        require(_endTimestamp != 0 && now < _endTimestamp, "LGE isn't ongoing");
        _;
    }

    modifier LGEFinished() {
        require(_endTimestamp != 0 && now >= _endTimestamp, "LGE isn't finished");
        _;
    }

    receive() external payable {
        if (msg.sender != address(_weth))
            contribute();
    }

    function getPairingTokens() external view returns (address[] memory tokens) {
        tokens = new address[](_pairingTokens.length());

        for (uint256 i = 0; i < _pairingTokens.length(); i++) {
            tokens[i] = _pairingTokens.at(i);
        }
    }

    function addPairingToken(address token, string calldata name, string calldata symbol) external onlyRoot LGENotStarted {
        require(!_pairingTokens.contains(token), "Token already added");
        
        address pair = _factory.createPair(token, resolveSingleton(QUAD_TOKEN_ROLE));
        
        address wrap = address(new LPTokenWrapper(name, symbol, pair, true, remoteAccessControl));
    
        requestRole(WRAPPED_LP_ROLE, wrap, false);
        requestRole(KILLABLE_ROLE, wrap, false);
        requestRole(LP_TOKEN_ROLE, pair, false);
        
        LPTokenWrapper(wrap).initSubscriptions();

        _wrappedLPTokens.add(wrap);
        _tokenToLP[token] = wrap;

        _pairingTokens.add(token);
    }

    function startLGE(uint256 endTimestamp) external onlyRoot LGENotStarted {
        _endTimestamp = endTimestamp;
    }

    function contribute() public payable LGEOngoing {
        _totalContributions = _totalContributions.add(msg.value);
        _contributions[msg.sender] = _contributions[msg.sender].add(msg.value);
    }

    function claimTokens() external LGEFinished {
        require(_liquidityAdded, "Liquidity hasn't been added yet");
        require(_contributions[msg.sender] > 0, "You haven't contributed in LGE or you already claimed your tokens");

        for (uint i = 0; i < _wrappedLPTokens.length(); i ++) {
            address lpToken = _wrappedLPTokens.at(i);
            uint256 tokenAmount = getClaimableTokens(lpToken, msg.sender);

            IERC20(lpToken).transfer(msg.sender, tokenAmount);
        }

        _contributions[msg.sender] = 0;
    }

    function getClaimableTokens(address tokenAddress, address userAddress) public view returns (uint256 tokenAmount) {
        if (!_liquidityAdded)
            return 0;

        uint256 contributionRate = _contributions[userAddress].mul(MAGNITUDE).div(_totalContributions);
        uint256 mintedAmount = _lpTokensMinted[tokenAddress];

        return contributionRate.mul(mintedAmount).div(MAGNITUDE);
    }

    function addLiquidity() external LGEFinished {
        require(!_liquidityAdded, "Liquidity already added");

        address quadToken = resolveSingleton(QUAD_TOKEN_ROLE);

        uint256 quadPerPool = IERC20(quadToken).balanceOf(address(this)).div(_pairingTokens.length());
        uint256 ethBalance = address(this).balance;
        uint256 ethPerPool = ethBalance.div(_pairingTokens.length());

        _weth.deposit{value: ethBalance}();

        for (uint i = 0; i < _pairingTokens.length(); i ++) {
            address token = _pairingTokens.at(i);
            address pair = _factory.getPair(token, quadToken);

            uint256 amount;
            if (token != address(_weth))
                amount = buyToken(token, ethPerPool);
            else
                amount = ethPerPool;

            assert(IERC20(token).transfer(pair, amount));
            IERC20(quadToken).transfer(pair, quadPerPool);

            uint256 mintAmount = IUniswapV2Pair(pair).mint(address(this));
            address wrappedLP = _tokenToLP[token];

            IERC20(pair).approve(wrappedLP, mintAmount);
            LPTokenWrapper(wrappedLP).deposit(mintAmount);

            _lpTokensMinted[wrappedLP] = mintAmount;
        }

        ITransferManager(resolveSingleton(TRANSFER_MANAGER_ROLE)).initialLock(5 minutes);
        _liquidityAdded = true;
    }

    function buyToken(address token, uint256 wethAmount) internal returns (uint256 amountOut) {
        IUniswapV2Pair pair = IUniswapV2Pair(_factory.getPair(address(_weth), token));
        (uint256 reserve0, uint256 reserve1,) = pair.getReserves();

        address token0 = pair.token0();
        (uint256 reserveIn, uint256 reserveOut) = token0 == token ? (reserve1, reserve0) : (reserve0, reserve1);
        amountOut = getAmountOut(wethAmount, reserveIn, reserveOut);

        assert(_weth.transfer(address(pair), wethAmount));
        (uint256 amount0Out, uint256 amount1Out) = token0 == token ? (amountOut, uint256(0)) : (0, amountOut);
        pair.swap(amount0Out, amount1Out, address(this), "");
    }

    //from UniswapV2Library
    // given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut) internal pure returns (uint amountOut) {
        require(amountIn > 0, 'UniswapV2Library: INSUFFICIENT_INPUT_AMOUNT');
        require(reserveIn > 0 && reserveOut > 0, 'UniswapV2Library: INSUFFICIENT_LIQUIDITY');
        uint amountInWithFee = amountIn.mul(997);
        uint numerator = amountInWithFee.mul(reserveOut);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        amountOut = numerator / denominator;
    }

}