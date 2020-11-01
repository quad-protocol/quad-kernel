pragma solidity ^0.6.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@quad/quad-linker/contracts/Killable.sol";

contract LPTokenWrapper is ERC20, Killable {

    bytes32 public constant LGE_ROLE = keccak256("LGE_ROLE");
    bytes32 internal constant WRAPPED_LP_ROLE = keccak256("WRAPPED_LP_ROLE");

    ERC20 public _lpToken;
    bool public wrappable;

    constructor(string memory name, string memory symbol, address lpToken, bool _wrappable, 
            IAccessControl accessControl) public ERC20(name, symbol) Killable(ROOT, false, accessControl) {
        _lpToken = ERC20(lpToken);
        wrappable = _wrappable;
    }

    modifier whenWrappable() {
        //LGE bypasses wrappable.
        require(wrappable || hasRole(LGE_ROLE, msg.sender), "Cannot wrap");
        _;
    }

    modifier onlyLGE() {
        require(hasRole(LGE_ROLE, msg.sender), "Address doesn't have the LGE role");
        _;
    }

    //needed because wrapped lps cannot subscribe in the constructor since their roles are assigned
    //after contract creation
    function initSubscriptions() external onlyLGE {
        subscribe(GOVERNOR_ROLE, WRAPPED_LP_ROLE);
        subscribe(LGE_ROLE, WRAPPED_LP_ROLE);
    }

    function deposit(uint256 amount) external whenWrappable {
        require(_lpToken.transferFrom(msg.sender, address(this), amount));
        _mint(msg.sender, amount);
    }

    function withdraw(uint256 amount) external whenKilled {
        _burn(msg.sender, amount);
        require(_lpToken.transfer(msg.sender, amount));
    }

    function toggleWrappable(bool canWrap) external onlyGovernor {
        wrappable = canWrap;
    }
}