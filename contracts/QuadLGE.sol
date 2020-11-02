pragma solidity ^0.6.0;

import "./interfaces/IERC20MintableBurnable.sol";
import "@quad/quad-linker/contracts/Governable.sol";
import "./LPTokenWrapper.sol";

import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "./interfaces/IWETH.sol";
import "./interfaces/ITransferManager.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "./libraries/UniswapV2Library.sol";

contract QuadLGE is Governable {

    using SafeMath for uint256;

    struct LGE {
        bool active;
        uint256 startTimestamp;
        uint256 endTimestamp;
        address pairingToken;
        address pair;
        address wrappedPair;
        uint256 tokensRaised;
        uint256 quadMinted;
        uint256 mintedLP;
        mapping(address => uint256) deposits;
        mapping(address => bool) claims;   
    }

    uint256 public lgeLength;

    IUniswapV2Factory public factory;
    IWETH public weth;

    mapping(uint256 => LGE) public lges;

    uint256 constant public MULTIPLIER = 2 ** 128;

    bytes32 internal constant WRAPPED_LP_ROLE = keccak256("WRAPPED_LP_ROLE");
    bytes32 internal constant LP_TOKEN_ROLE = keccak256("LP_TOKEN_ROLE");
    bytes32 internal constant TRANSFER_MANAGER_ROLE = keccak256("TRANSFER_MANAGER_ROLE");
    bytes32 internal constant LGE_ROLE = keccak256("LGE_ROLE");
    bytes32 internal constant SECONDARY_LGE_ROLE = keccak256("SECONDARY_LGE_ROLE");
    bytes32 internal constant KILLABLE_ROLE = keccak256("KILLABLE_ROLE");
    bytes32 internal constant QUAD_TOKEN_ROLE = keccak256("QUAD_TOKEN_ROLE");
    bytes32 internal constant NO_FEE_ROLE = keccak256("NO_FEE_ROLE");
    bytes32 internal constant NO_FEE_RECIPIENT_ROLE = keccak256("NO_FEE_RECIPIENT_ROLE");

    constructor(IAccessControl accessControl, IWETH _weth, IUniswapV2Factory _factory) 
                public Governable(LGE_ROLE, false, accessControl) {
        factory = _factory;
        weth = _weth;
        requestRole(NO_FEE_ROLE, address(this), false);
        requestRole(NO_FEE_RECIPIENT_ROLE, address(this), false);
        requestRole(SECONDARY_LGE_ROLE, address(this), true);
        subscribeSingleton(QUAD_TOKEN_ROLE, LGE_ROLE);
        subscribeSingleton(TRANSFER_MANAGER_ROLE, LGE_ROLE);
    }

    modifier LGEOngoing() {
        require(lgeLength > 0 && now < lges[lgeLength - 1].endTimestamp, "No LGE ongoing");
        _;
    }

    modifier LGEFinished() {
        require(lgeLength == 0 || now >= lges[lgeLength - 1].endTimestamp && !lges[lgeLength - 1].active, "LGE is ongoing");
        _;
    }

    function startLGE(address pairingToken, string calldata name, string calldata symbol, uint256 endTimestamp, bool wrappable) external onlyGovernor LGEFinished {
        require(now < endTimestamp, "Endtimestamp must be greater than the current timestamp");

        address pair = factory.createPair(resolveSingleton(QUAD_TOKEN_ROLE), pairingToken);
        address wrap = address(new LPTokenWrapper(name, symbol, pair, wrappable, remoteAccessControl));

        requestRole(WRAPPED_LP_ROLE, wrap, false);
        requestRole(KILLABLE_ROLE, wrap, false);
        requestRole(LP_TOKEN_ROLE, pair, false);

        LPTokenWrapper(wrap).initSubscriptions();

        lges[lgeLength] = LGE(
            true,
            now,
            endTimestamp,
            pairingToken,
            pair,
            wrap,
            0,
            0,
            0
        );

        lgeLength ++;
    }

    function contribute(uint256 tokenAmount) external LGEOngoing {
        LGE storage currentLGE = lges[lgeLength - 1];
        IERC20 token = IERC20(currentLGE.pairingToken);

        //account for potential burns on transfer
        uint256 previousTokenBalance = token.balanceOf(address(this));
        require(token.transferFrom(msg.sender, address(this), tokenAmount));

        uint256 depositedTokens = token.balanceOf(address(this)).sub(previousTokenBalance);
        currentLGE.deposits[msg.sender] = currentLGE.deposits[msg.sender].add(depositedTokens);
        currentLGE.tokensRaised = currentLGE.tokensRaised.add(depositedTokens);
    }

    function getUserDeposit(uint256 lgeId, address addr) external view returns(uint256 tokenAmount, address token) {
        LGE storage lge = lges[lgeId];

        return (lge.deposits[addr], lge.pairingToken);
    }

    function addLiquidity() external {
        require(lgeLength > 0, "No lge");

        LGE storage currentLGE = lges[lgeLength - 1];
        require(now >= currentLGE.endTimestamp && currentLGE.active, "Liquidity already added or LGE ongoing");

        address quadToken = resolveSingleton(QUAD_TOKEN_ROLE);

        (uint256 wethLiquidity, uint256 tokenLiquidity) = UniswapV2Library.getReserves(address(factory), address(weth), currentLGE.pairingToken);
        uint256 wethPerToken = UniswapV2Library.quote(1e18, tokenLiquidity, wethLiquidity);

        (uint256 wethQuadLiquidity, uint256 quadLiquidity) = UniswapV2Library.getReserves(address(factory), address(weth), quadToken);
        uint256 wethPerQuad = UniswapV2Library.quote(1e18, quadLiquidity, wethQuadLiquidity);

        uint256 tokenQuadRate = wethPerToken.mul(MULTIPLIER).div(wethPerQuad);
        currentLGE.quadMinted = currentLGE.tokensRaised.mul(tokenQuadRate).div(MULTIPLIER);

        IERC20MintableBurnable(quadToken).mint(currentLGE.pair, currentLGE.quadMinted);
        IERC20(currentLGE.pairingToken).transfer(currentLGE.pair, currentLGE.tokensRaised);

        currentLGE.mintedLP = IUniswapV2Pair(currentLGE.pair).mint(address(this));

        IERC20(currentLGE.pair).approve(currentLGE.wrappedPair, currentLGE.mintedLP);

        currentLGE.active = false;

        ITransferManager(resolveSingleton(TRANSFER_MANAGER_ROLE)).syncAll();
    }

    function claim(uint256 id) external {
        require(id < lgeLength, "Unknown LGE");

        LGE storage lge = lges[id];

        require(!lge.claims[msg.sender], "You have already claimed your lps");

        uint256 deposit = lge.deposits[msg.sender];
        require(deposit > 0, "You didn't take part in this lge");

        lge.claims[msg.sender] = true;

        uint256 contribution = deposit.mul(MULTIPLIER).div(lge.tokensRaised);
        uint256 lpDebt = contribution.mul(lge.mintedLP).div(MULTIPLIER);

        LPTokenWrapper(lge.wrappedPair).deposit(lpDebt);
        require(IERC20(lge.wrappedPair).transfer(msg.sender, lpDebt));
    }

}