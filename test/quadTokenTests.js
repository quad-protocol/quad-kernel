const QuadToken = artifacts.require("QuadToken");

const QuadAdminMock = artifacts.require("QuadAdminMock");
const FeeManager = artifacts.require("FeeManagerMock");
const TransferManager = artifacts.require("TransferManagerMock");

const truffleAssert = require("truffle-assertions");
const chai = require("chai");

chai.use(require("chai-bn")(require("bn.js")));

const { expect } = chai;

contract("QuadToken", addresses => {

    let owner = addresses[0];
    let minter = addresses[1];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });
        
        this.transferManager = await TransferManager.new();
        this.feeManager = await FeeManager.new();
        
        await this.quadAdmin.grantRole(web3.utils.soliditySha3("LGE_ROLE"), minter, { from: owner });
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("FEE_MANAGER_ROLE"), this.feeManager.address, { from: owner });
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("TRANSFER_MANAGER_ROLE"), this.transferManager.address, { from: owner });

        this.quadToken = await QuadToken.new("QUAD", "QUAD", 10000e18.toLocaleString("fullwide", { useGrouping: false }), this.quadAdmin.address, { from: owner });
    });

    it("should call TransferManager on every transfer", async () => {
        await truffleAssert.passes(
            this.quadToken.transfer(minter, 1e18.toString(), { from: owner })
        );

        let callData = await this.transferManager.mockCall();

        expect(callData.sender).equal(owner);
        expect(callData.recipient).equal(minter);
    });

    it("should send the correct amount of fees to the correct recipient", async () => {
        await this.feeManager.changeTransferFeeBips("100");

        let amountToSend = web3.utils.toBN(10e18);
        let expectedFees = amountToSend.divn(100);

        await truffleAssert.passes(
            this.quadToken.transfer(minter, amountToSend, { from: owner })
        );


        expect(await this.quadToken.balanceOf(this.feeManager.address)).bignumber.equal(expectedFees);
    });

    it("should only allow LGE_ROLE to mint", async () => {
        let previousTotalSupply = await this.quadToken.totalSupply();
        let mintAmount = web3.utils.toBN(1e18);

        await truffleAssert.reverts(
            this.quadToken.mint(owner, mintAmount, { from: owner }), "Sender isn't the minter"
        );

        await truffleAssert.passes(
            this.quadToken.mint(minter, mintAmount, { from: minter })
        );

        expect(await this.quadToken.balanceOf(minter)).bignumber.equal(mintAmount);
        expect(await this.quadToken.totalSupply()).bignumber.equal(previousTotalSupply.add(mintAmount));
    });

});