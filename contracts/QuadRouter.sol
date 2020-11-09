pragma solidity ^0.6.0;

import "@quad/quad-linker/contracts/RemoteAccessControl.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/ILPTokenWrapper.sol";
import "./interfaces/ITransferManager.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./libraries/UniswapV2Library.sol";

library SafeBurnableTransfers {

    using SafeMath for uint256;

    function safeTransfer(IERC20 token, address recipient, uint256 amount) internal returns (uint256) {
        uint256 initialTokenBalance = token.balanceOf(recipient);
        require(token.transfer(recipient, amount));
        return token.balanceOf(recipient).sub(initialTokenBalance);
    }

    function safeTransferFrom(IERC20 token, address sender, address recipient, uint256 amount) internal returns (uint256) {
        uint256 initialTokenBalance = token.balanceOf(recipient);
        require(token.transferFrom(sender, recipient, amount));
        return token.balanceOf(recipient).sub(initialTokenBalance);
    }
}

contract QuadRouter is RemoteAccessControl {

    using SafeMath for uint256;
    using SafeBurnableTransfers for IERC20;

    bytes32 internal constant QUAD_ROUTER_ROLE = keccak256("QUAD_ROUTER_ROLE");
    bytes32 internal constant QUAD_TOKEN_ROLE = keccak256("QUAD_TOKEN_ROLE");
    bytes32 internal constant WRAPPED_LP_ROLE = keccak256("WRAPPED_LP_ROLE");
    bytes32 internal constant LP_TOKEN_ROLE = keccak256("LP_TOKEN_ROLE");
    bytes32 internal constant TRANSFER_MANAGER_ROLE = keccak256("TRANSFER_MANAGER_ROLE");

    IUniswapV2Factory public _factory;
    IWETH public _weth;

    mapping(address => address) public _lpToWrap;

    constructor(IUniswapV2Factory factory, IWETH weth, IAccessControl accessControl) public RemoteAccessControl(QUAD_ROUTER_ROLE, true, accessControl) {
        _factory = factory;
        _weth = weth;
        subscribeSingleton(QUAD_TOKEN_ROLE, QUAD_ROUTER_ROLE);
        subscribeSingleton(TRANSFER_MANAGER_ROLE, QUAD_ROUTER_ROLE);
        subscribe(WRAPPED_LP_ROLE, QUAD_ROUTER_ROLE);
        subscribe(LP_TOKEN_ROLE, QUAD_ROUTER_ROLE);
        initLPMapping();
    }

    receive() external payable {
        if (msg.sender != address(_weth))
            addLiquidityETH();
    }

    function initLPMapping() internal {
        EnumerableSet.AddressSet storage tokens = resolve(WRAPPED_LP_ROLE);

        for (uint256 i = 0; i < tokens.length(); i++) {
            address token = tokens.at(i);
            _lpToWrap[ILPTokenWrapper(token)._lpToken()] = token; 
        }
    }

    function roleGranted(bytes32 role, address target, bool isSingleton) public override onlyAccessControl {
        if (role == WRAPPED_LP_ROLE) {
            _lpToWrap[ILPTokenWrapper(target)._lpToken()] = target; 
        }
        super.roleGranted(role, target, isSingleton);
    }

    function estimateOutputLiquidityETH(uint256 ethAmount) external view returns (uint256) {
        return estimateOutputLiquidity(address(_weth), ethAmount);
    }

    function estimateOutputLiquidity(address pairingToken, uint256 tokenAmount) public view returns (uint256) {
        address quadToken = resolveSingleton(QUAD_TOKEN_ROLE);
        address pair = _factory.getPair(quadToken, address(pairingToken));
        if (!hasRole(LP_TOKEN_ROLE, pair))
            return 0;

        (uint256 reserveOther, uint256 reserveQuad) = UniswapV2Library.getReserves(address(_factory), pairingToken, quadToken);
        uint256 quadOutput = UniswapV2Library.getAmountOut(tokenAmount.div(2), reserveOther, reserveQuad);

        (reserveOther, reserveQuad) = (reserveOther.add(tokenAmount.div(2)), reserveQuad.sub(quadOutput));

        uint256 pairTotalSupply = IERC20(pair).totalSupply();

        return Math.min(tokenAmount.div(2).mul(pairTotalSupply) / reserveOther, quadOutput.mul(pairTotalSupply) / reserveQuad);
    }

    function addLiquidityETH() public payable {
        address quadToken = resolveSingleton(QUAD_TOKEN_ROLE);
        address pair = _factory.getPair(quadToken, address(_weth));
        require(hasRole(LP_TOKEN_ROLE, pair), "ETH pair doesn't exist");

        _weth.deposit{value: msg.value}();

        (uint256 dustQuad, uint256 dustToken) = _addLiquidityInternal(pair, address(_weth), quadToken, msg.value);

        if (dustQuad > 0)
            IERC20(quadToken).transfer(msg.sender, dustQuad);
        if (dustToken > 0) {
            _weth.withdraw(dustToken);
            msg.sender.transfer(dustToken);
        }
    }

    function addLiquidity(address pairingToken, uint256 tokenAmount) external {
        address quadToken = resolveSingleton(QUAD_TOKEN_ROLE);
        address pair = _factory.getPair(quadToken, pairingToken);
        require(hasRole(LP_TOKEN_ROLE, pair), "Pair doesn't exist");

        uint256 recievedAmount = IERC20(pairingToken).safeTransferFrom(msg.sender, address(this), tokenAmount);

        (uint256 dustQuad, uint256 dustToken) = _addLiquidityInternal(pair, pairingToken, quadToken, recievedAmount);

        if (dustQuad > 0)
            require(IERC20(quadToken).transfer(msg.sender, dustQuad));
        if (dustToken > 0) 
            require(IERC20(pairingToken).transfer(msg.sender, dustToken));
    }

    function _addLiquidityInternal(address pair, address paymentToken, address quadToken, uint256 tokenAmount) internal returns (uint256 dustQuad, uint256 dustToken) {
        uint256 receivedQuad = swap(pair, paymentToken, tokenAmount.div(2));

        (uint256 reserveOther, uint256 reserveQuad) = UniswapV2Library.getReserves(address(_factory), paymentToken, quadToken);

        uint256 optimalQuadAmount = receivedQuad;
        uint256 optimalTokenAmount = UniswapV2Library.quote(receivedQuad, reserveQuad, reserveOther);
        
        //calculate potential dust
        if (optimalTokenAmount > tokenAmount.div(2)) {
            optimalTokenAmount = tokenAmount.div(2);
            optimalQuadAmount = UniswapV2Library.quote(optimalTokenAmount, reserveOther, reserveQuad);
            dustQuad = receivedQuad.sub(optimalQuadAmount);
        } else
            dustToken = tokenAmount.div(2).sub(optimalTokenAmount);

        IERC20(quadToken).transfer(pair, optimalQuadAmount);
        IERC20(paymentToken).transfer(pair, optimalTokenAmount);

        uint256 receivedLiquidity = IUniswapV2Pair(pair).mint(address(this));
        address wrappedLiquidity = _lpToWrap[pair];

        IERC20(pair).approve(wrappedLiquidity, receivedLiquidity);
        ILPTokenWrapper(wrappedLiquidity).deposit(receivedLiquidity);

        require(IERC20(wrappedLiquidity).transfer(msg.sender, receivedLiquidity));

        ITransferManager(resolveSingleton(TRANSFER_MANAGER_ROLE)).syncAll();
    }

    function swap(address pair, address inputToken, uint256 inputAmount) internal returns (uint256) {
        uint256 buyAmount = IERC20(inputToken).safeTransfer(pair, inputAmount);

        address token0 = IUniswapV2Pair(pair).token0();
        bool isToken0 = token0 == inputToken;

        (uint256 reserve0, uint256 reserve1,) = IUniswapV2Pair(pair).getReserves();
        (uint256 reserveIn, uint256 reserveOut) = isToken0 ? (reserve0, reserve1) : (reserve1, reserve0);

        uint256 amountOut = UniswapV2Library.getAmountOut(buyAmount, reserveIn, reserveOut);
        (uint256 amount0Out, uint256 amount1Out) = isToken0 ? (uint256(0), amountOut) : (amountOut, 0);

        IERC20 otherToken = isToken0 ? IERC20(IUniswapV2Pair(pair).token1()) : IERC20(token0);
        uint256 initialBalance = otherToken.balanceOf(address(this));
        IUniswapV2Pair(pair).swap(amount0Out, amount1Out, address(this), "");
        return otherToken.balanceOf(address(this)).sub(initialBalance);
    }

}