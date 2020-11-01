pragma solidity ^0.6.0;

import "@quad/quad-linker/contracts/Killable.sol";

contract KillableMock is Killable {

    constructor(bytes32 role, bool isSingleton, IAccessControl accessControl) public Killable(role, isSingleton, accessControl) {
    }

}