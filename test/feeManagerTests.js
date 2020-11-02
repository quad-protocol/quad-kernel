const FeeManager = artifacts.require("FeeManager");

const QuadAdminMock = artifacts.require("QuadAdminMock");

const truffleAssert =  require("truffle-assertions");

const chai = require("chai");
chai.use(require("chai-bn")(require("bn.js")));

const { expect } = chai;

contract("FeeManager", addresses => {

    let owner = addresses[0];
    let noFee = addresses[1];
    let noFeeRecipient = addresses[2];
    let feeCollector = addresses[3];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });
        
        await this.quadAdmin.grantRole(web3.utils.soliditySha3("NO_FEE_ROLE"), noFee);
        await this.quadAdmin.grantRole(web3.utils.soliditySha3("NO_FEE_RECIPIENT_ROLE"), noFeeRecipient);
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("FEE_COLLECTOR_ROLE"), feeCollector);
        await this.quadAdmin.grantRole(web3.utils.soliditySha3("GOVERNOR_ROLE"), owner);

        this.feeManager = await FeeManager.new("100", this.quadAdmin.address, { from: owner });
    });

    it("should return 0 fees when the sender is in the NO_FEE role", async () => {
        let result = await this.feeManager.calculateFee(noFee, owner, 10e18.toString());

        expect(result.feeAmount).bignumber.zero;
        expect(result.feeRecipient).equal("0x0000000000000000000000000000000000000000")
    });

    it("should return 0 fees when the recipient is in the NO_FEE_RECIPIENT role", async () => {
        let result = await this.feeManager.calculateFee(owner, noFeeRecipient, 10e18.toString());

        expect(result.feeAmount).bignumber.zero;
        expect(result.feeRecipient).equal("0x0000000000000000000000000000000000000000")
    });

    it("should return the correct fee amount", async () => {
        let amountToSend = web3.utils.toBN(10e18);
        let expectedFeeAmount = amountToSend.divn(100);

        let result = await this.feeManager.calculateFee(owner, owner, amountToSend);
        
        expect(result.feeAmount).bignumber.equal(expectedFeeAmount);
        expect(result.feeRecipient).equal(feeCollector);
    });

    it("should only allow governors to change the fees", async () => {
        await truffleAssert.reverts(
            this.feeManager.changeFeeBips("200", { from: noFee }), "Address doesn't have the governor role"
        );

        await truffleAssert.passes(
            this.feeManager.changeFeeBips("200", { from: owner })
        );

        expect(await this.feeManager._feeBips()).bignumber.equal("200");
    });
});