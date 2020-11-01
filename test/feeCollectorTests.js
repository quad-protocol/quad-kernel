const { deployProxy } = require('@openzeppelin/truffle-upgrades');

const FeeCollector = artifacts.require("FeeCollector");
const QuadAdminMock = artifacts.require("QuadAdminMock");
const ERC20Mock = artifacts.require("ERC20Mock");

const chai = require("chai");
const { expect } = require("chai");
const truffleAssert = require('truffle-assertions');

chai.use(require("chai-bn")(require("bn.js")));

contract("FeeCollector", addresses => {

    let owner = addresses[0];
    let vault = addresses[1];
    let feeRecipient = addresses[2];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });
        this.token = await ERC20Mock.new(20e18.toLocaleString("fullwide", { useGrouping: false }));
        this.feeCollector = await deployProxy(FeeCollector, ["300", this.quadAdmin.address], { initializer: "init", unsafeAllowCustomTypes: true });
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("QUAD_TOKEN_ROLE"), this.token.address);
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("QUAD_VAULT_ROLE"), vault);
    });

    it("should allow recipient adds", async () => {
        await truffleAssert.passes(
            this.feeCollector.addRecipient(owner, 500, { from: owner })
        );
        await truffleAssert.passes(
            this.feeCollector.addRecipient(feeRecipient, 200, { from: owner })
        );
        
        expect(await this.feeCollector._totalShares()).bignumber.equal("1000");
    });

    it("should activate vault fees", async () => {
        await truffleAssert.passes(
            this.feeCollector.addRecipient(owner, 500, { from: owner })
        );
        expect(await this.feeCollector._totalShares()).bignumber.equal("800");

        await truffleAssert.passes(
            this.feeCollector.activateVaultFees({ from: vault })
        );
        expect(await this.feeCollector._totalShares()).bignumber.equal("9800");
    });

    it("should burn the correct amount of tokens", async () => {
        await truffleAssert.passes(
            this.feeCollector.addRecipient(owner, 200, { from: owner })
        );
        const transferAmount = web3.utils.toBN(1e18);
        await this.token.transfer(this.feeCollector.address, transferAmount, { from: owner });
        const totalSupply = await this.token.totalSupply();

        await truffleAssert.passes(
            this.feeCollector.distributeFees()
        );

        expect(await this.token.totalSupply()).bignumber.equal(totalSupply.sub(transferAmount.muln(300).divn(500)));
    });

    it("should distribute the tokens correctly", async () => {
        await truffleAssert.passes(
            this.feeCollector.addRecipient(owner, 500, { from: owner })
        );
        await truffleAssert.passes(
            this.feeCollector.addRecipient(feeRecipient, 200, { from: owner })
        );
        await truffleAssert.passes(
            this.feeCollector.activateVaultFees({ from: vault })
        );

        const transferAmount = web3.utils.toBN(10e18);
        await this.token.transfer(this.feeCollector.address, transferAmount, { from: owner });

        const expectedBurnAmount = transferAmount.muln(300).divn(10000);
        const expectedOwnerFee = transferAmount.muln(500).divn(10000);
        const expectedRecipientFee = transferAmount.muln(200).divn(10000);
        const expectedVaultFee = transferAmount.muln(9000).divn(10000);

        expect(await this.feeCollector.getWithdrawableFees(owner)).bignumber.equal(expectedOwnerFee);
        expect(await this.feeCollector.getWithdrawableFees(feeRecipient)).bignumber.equal(expectedRecipientFee);
        expect(await this.feeCollector.getWithdrawableFees(vault)).bignumber.equal(expectedVaultFee);
        expect(await this.feeCollector.getPendingBurnAmount()).bignumber.equal(expectedBurnAmount);
    });

    it("should withdraw the expected amount of tokens", async () => {
        await truffleAssert.passes(
            this.feeCollector.addRecipient(owner, 450, { from: owner })
        );
        await truffleAssert.passes(
            this.feeCollector.addRecipient(feeRecipient, 250, { from: owner })
        );
        await truffleAssert.passes(
            this.feeCollector.activateVaultFees({ from: vault })
        );

        const transferAmount = web3.utils.toBN(10e18);
        await this.token.transfer(this.feeCollector.address, transferAmount, { from: owner });

        const expectedOwnerFee = await this.feeCollector.getWithdrawableFees(owner);
        const expectedRecipientFee = await this.feeCollector.getWithdrawableFees(feeRecipient);
        const expectedVaultFee = await this.feeCollector.getWithdrawableFees(vault);
        
        await truffleAssert.passes(
            this.feeCollector.withdraw({ from: feeRecipient })
        );
        
        expect(await this.token.balanceOf(feeRecipient)).bignumber.equal(expectedRecipientFee);
        
        await this.token.transfer(this.feeCollector.address, transferAmount, { from: owner });

        expect(await this.feeCollector.getWithdrawableFees(owner)).bignumber.equal(expectedOwnerFee.muln(2));
        expect(await this.feeCollector.getWithdrawableFees(feeRecipient)).bignumber.equal(expectedRecipientFee);
        expect(await this.feeCollector.getWithdrawableFees(vault)).bignumber.equal(expectedVaultFee.muln(2));
        
        const currentOwnerBalance = await this.token.balanceOf(owner);
        
        await truffleAssert.passes(
            this.feeCollector.withdraw({ from: owner })
        );
        await truffleAssert.passes(
            this.feeCollector.withdraw({ from: feeRecipient })
        );
        await truffleAssert.passes(
            this.feeCollector.withdraw({ from: vault })
        );

        expect(await this.token.balanceOf(owner)).bignumber.equal(currentOwnerBalance.add(expectedOwnerFee.muln(2)));
        expect(await this.token.balanceOf(feeRecipient)).bignumber.equal(expectedRecipientFee.muln(2));
        expect(await this.token.balanceOf(vault)).bignumber.equal(expectedVaultFee.muln(2));
    });
});