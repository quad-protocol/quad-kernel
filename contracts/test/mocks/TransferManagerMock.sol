pragma solidity ^0.6.0;

contract TransferManagerMock {

    struct MockCall {
        address sender;
        address recipient;
    }

    MockCall public mockCall;

    bool public syncCalled;
    bool public initialLockCalled;

    function checkTransfer(address sender, address recipient) external {
        mockCall.sender = sender;
        mockCall.recipient = recipient;
    }

    function syncAll() external {
        syncCalled = true;
    }

    function initialLock(uint256 duration) external {
        initialLockCalled = true;
    }
}