const { deployProxy } = require('@openzeppelin/truffle-upgrades');

const QuadVault = artifacts.require("QuadVault");

const QuadAdminMock = artifacts.require("QuadAdminMock");
const FeeCollector = artifacts.require("FeeCollector");
const ERC20Mock = artifacts.require("ERC20Mock");

const truffleAssert = require("truffle-assertions");

const { promisify } = require("util");

const chai = require("chai");
const { expect } = require("chai");

chai.use(require("chai-bn")(require("bn.js")));

contract("QuadVault", addresses => {

    let owner = addresses[0];
    let staker1 = addresses[1];
    let staker2 = addresses[2];
    let staker3 = addresses[3];
    let governance = addresses[4];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });

        this.quadToken = await ERC20Mock.new(20e18.toString(), { from: owner });
        this.lpToken1 = await ERC20Mock.new(20e18.toString(), { from: staker1 });
        await this.lpToken1.mint(staker2, 10e18.toString());
        this.lpToken2 = await ERC20Mock.new(20e18.toString(), { from: staker3 });

        this.feeCollector = await deployProxy(FeeCollector, ["0", this.quadAdmin.address], { initializer: "init", unsafeAllowCustomTypes: true });
        this.quadVault = await deployProxy(QuadVault, [this.quadAdmin.address], { initializer: "_init", unsafeAllowCustomTypes: true });

        await this.feeCollector.addRecipient(this.quadVault.address, "1");

        await this.lpToken1.approve(this.quadVault.address, 20e18.toString(), { from: staker1 });
        await this.lpToken1.approve(this.quadVault.address, 10e18.toString(), { from: staker2 });
        await this.lpToken2.approve(this.quadVault.address, 20e18.toString(), { from: staker3 });

        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("QUAD_TOKEN_ROLE"), this.quadToken.address);

        const WRAPPED_LP_ROLE = web3.utils.soliditySha3("WRAPPED_LP_ROLE");
        await this.quadAdmin.grantRole(WRAPPED_LP_ROLE, this.lpToken1.address, { from: owner });
        await this.quadAdmin.grantRole(WRAPPED_LP_ROLE, this.lpToken2.address, { from: owner });

        await this.quadAdmin.grantRole(web3.utils.soliditySha3("GOVERNANCE_ROLE"), governance);
    });

    it("should allow deposits in every pool", async () => {
        const staker1Balance1 = web3.utils.toBN(20e18);
        const staker2Balance1 = web3.utils.toBN(10e18);
        const staker3Balance2 = staker1Balance1;

        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker1Balance1, { from: staker1 })
        );

        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker2Balance1, { from: staker2 })
        );

        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken2.address, staker3Balance2, { from: staker3 })
        );

        expect((await this.quadVault.getUserData(this.lpToken1.address, staker1)).stakedAmount).bignumber.equal(staker1Balance1);
        expect((await this.quadVault.getUserData(this.lpToken1.address, staker2)).stakedAmount).bignumber.equal(staker2Balance1);
        expect((await this.quadVault.getUserData(this.lpToken1.address, staker3)).stakedAmount).bignumber.zero;

        expect((await this.quadVault.getUserData(this.lpToken2.address, staker1)).stakedAmount).bignumber.zero;
        expect((await this.quadVault.getUserData(this.lpToken2.address, staker2)).stakedAmount).bignumber.zero;
        expect((await this.quadVault.getUserData(this.lpToken2.address, staker3)).stakedAmount).bignumber.equal(staker3Balance2);
    });

    it("should allow governance to lock tokens", async () => {
        const staker1Balance1 = web3.utils.toBN(20e18);
        const staker3Balance2 = staker1Balance1;

        const staker1LockedBalance1 = staker1Balance1.divn(2);
        const staker3LockedBalance2 = staker3Balance2.divn(2);

        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker1Balance1, { from: staker1 })
        );
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken2.address, staker3Balance2, { from: staker3 })
        );
        
        await truffleAssert.passes(
            this.quadVault.lockTokens(staker1, this.lpToken1.address, staker1LockedBalance1, { from: governance })
        );
        await truffleAssert.passes(
            this.quadVault.lockTokens(staker3, this.lpToken2.address, staker3LockedBalance2, { from: governance })
        );
        expect((await this.quadVault.getUserData(this.lpToken1.address, staker1)).lockedTokens).bignumber.equal(staker1LockedBalance1);
        expect((await this.quadVault.getUserData(this.lpToken2.address, staker3)).lockedTokens).bignumber.equal(staker3LockedBalance2);

        await truffleAssert.reverts(
            this.quadVault.withdraw(this.lpToken1.address, staker1Balance1.sub(staker1LockedBalance1).addn(1), { from: staker1 }), "Insufficient unlocked balance"
        );
        await truffleAssert.reverts(
            this.quadVault.withdraw(this.lpToken2.address, staker3Balance2.sub(staker3LockedBalance2).addn(1), { from: staker3 }), "Insufficient unlocked balance"
        );

        await truffleAssert.passes(
            this.quadVault.withdraw(this.lpToken1.address, staker1Balance1.sub(staker1LockedBalance1), { from: staker1 })
        );
        await truffleAssert.passes(
            this.quadVault.withdraw(this.lpToken2.address, staker3Balance2.sub(staker3LockedBalance2), { from: staker3 })
        );
    });

    it("should allow governance to unlock tokens", async () => {
        const staker1Balance1 = web3.utils.toBN(20e18);
        const staker3Balance2 = staker1Balance1;

        const staker1LockedBalance1 = staker1Balance1.divn(2);
        const staker3LockedBalance2 = staker3Balance2.divn(2);

        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker1Balance1, { from: staker1 })
        );
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken2.address, staker3Balance2, { from: staker3 })
        );
        
        await truffleAssert.passes(
            this.quadVault.lockTokens(staker1, this.lpToken1.address, staker1LockedBalance1, { from: governance })
        );
        await truffleAssert.passes(
            this.quadVault.lockTokens(staker3, this.lpToken2.address, staker3LockedBalance2, { from: governance })
        );

        await truffleAssert.reverts(
            this.quadVault.unlockTokens(staker1, this.lpToken1.address, staker1LockedBalance1.addn(1), { from: governance }), "Insufficient locked balance"
        );
        await truffleAssert.reverts(
            this.quadVault.unlockTokens(staker3, this.lpToken2.address, staker3LockedBalance2.addn(1), { from: governance }), "Insufficient locked balance"
        );

        await truffleAssert.passes(
            this.quadVault.unlockTokens(staker1, this.lpToken1.address, staker1LockedBalance1, { from: governance })
        );
        await truffleAssert.passes(
            this.quadVault.unlockTokens(staker3, this.lpToken2.address, staker3LockedBalance2, { from: governance })
        );

        await truffleAssert.passes(
            this.quadVault.withdraw(this.lpToken1.address, staker1Balance1, { from: staker1 })
        );
        await truffleAssert.passes(
            this.quadVault.withdraw(this.lpToken2.address, staker3Balance2, { from: staker3 })
        );
    });
    
    it("should calculate pending rewards correctly", async () => {
        const staker1Balance1 = web3.utils.toBN(20e18);
        const staker2Balance1 = web3.utils.toBN(10e18);
        const staker3Balance2 = staker1Balance1;

        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker1Balance1, { from: staker1 })
        );
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker2Balance1, { from: staker2 })
        );
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken2.address, staker3Balance2, { from: staker3 })
        );

        const sentTokens = web3.utils.toBN(10e18);
        await this.quadToken.transfer(this.feeCollector.address, sentTokens, { from: owner });

        const expectedRewardPerPool = sentTokens.divn(2);

        const staker1Rewards = (await this.quadVault.getUserData(this.lpToken1.address, staker1)).pendingRewards;
        const staker2Rewards = (await this.quadVault.getUserData(this.lpToken1.address, staker2)).pendingRewards;
        const staker3Rewards = (await this.quadVault.getUserData(this.lpToken2.address, staker3)).pendingRewards;

        expect(staker1Rewards).bignumber.equal(expectedRewardPerPool.mul(staker1Balance1).div(staker1Balance1.add(staker2Balance1)));
        expect(staker2Rewards).bignumber.equal(expectedRewardPerPool.mul(staker2Balance1).div(staker1Balance1.add(staker2Balance1)));
        expect(staker3Rewards).bignumber.equal(expectedRewardPerPool);
    });

    it("should withdraw the correct token amount", async () => {
        const staker1Balance1 = web3.utils.toBN(20e18);
        const staker2Balance1 = web3.utils.toBN(10e18);
        const staker3Balance2 = staker1Balance1;

        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker1Balance1, { from: staker1 })
        );
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, staker2Balance1, { from: staker2 })
        );
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken2.address, staker3Balance2, { from: staker3 })
        );

        const sentTokens = web3.utils.toBN(10e18);
        await this.quadToken.transfer(this.feeCollector.address, sentTokens, { from: owner });

        const staker1Rewards = (await this.quadVault.getUserData(this.lpToken1.address, staker1)).pendingRewards;
        const staker2Rewards = (await this.quadVault.getUserData(this.lpToken1.address, staker2)).pendingRewards;
        const staker3Rewards = (await this.quadVault.getUserData(this.lpToken2.address, staker3)).pendingRewards;

        await truffleAssert.passes(
            this.quadVault.withdraw(this.lpToken1.address, staker1Balance1, { from: staker1 })
        );
        await truffleAssert.passes(
            this.quadVault.withdraw(this.lpToken1.address, staker2Balance1, { from: staker2 })
        );
        await truffleAssert.passes(
            this.quadVault.withdraw(this.lpToken2.address, staker3Balance2, { from: staker3 })
        );

        expect(await this.lpToken1.balanceOf(staker1)).bignumber.equal(staker1Balance1);
        expect(await this.lpToken1.balanceOf(staker2)).bignumber.equal(staker2Balance1);
        expect(await this.lpToken1.balanceOf(staker3)).bignumber.zero;

        expect(await this.lpToken2.balanceOf(staker1)).bignumber.zero;
        expect(await this.lpToken2.balanceOf(staker2)).bignumber.zero;
        expect(await this.lpToken2.balanceOf(staker3)).bignumber.equal(staker3Balance2);

        expect(await this.quadToken.balanceOf(staker1)).bignumber.equal(staker1Rewards);
        expect(await this.quadToken.balanceOf(staker2)).bignumber.equal(staker2Rewards);
        expect(await this.quadToken.balanceOf(staker3)).bignumber.equal(staker3Rewards);
    });

    //this test takes around 30 seconds to execute because we are skipping 6k blocks
    it("should store received fees as analytics", async () => {
        //activate the pool
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, 1e18.toString(), { from: staker1 })
        );
        
        const tokensSentAnalytic0 = web3.utils.toBN(15e18);
        await this.quadToken.transfer(this.feeCollector.address, tokensSentAnalytic0.divn(2), { from: owner });

        //update analytics - the first analytic will be registered here
        const expectedAnalytic0StartBlock = await web3.eth.getBlockNumber();
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, 1e18.toString(), { from: staker1 })
        );

        await waitNBlocks(6000);
        
        await this.quadToken.transfer(this.feeCollector.address, tokensSentAnalytic0.divn(2), { from: owner });
        const expectedAnalytic0EndBlock = await web3.eth.getBlockNumber();
        ///update analytics to period 1
        await truffleAssert.passes(
            this.quadVault.deposit(this.lpToken1.address, 1e18.toString(), { from: staker1 })
        );

        const tokensSentAnalytic1 = web3.utils.toBN(5e18);
        await this.quadToken.transfer(this.feeCollector.address, tokensSentAnalytic1, { from: owner });

        const {startBlock: startBlock0, endBlock: endBlock0, feeAmount: feeAmount0} = await this.quadVault.getMultipleAnalytics(0, 0);

        //10 blocks margin since truffle could mine blocks in between transactions
        expect(startBlock0).bignumber.closeTo(expectedAnalytic0StartBlock.toString(), "10");
        expect(endBlock0).bignumber.closeTo(expectedAnalytic0EndBlock.toString(), "10");
        expect(feeAmount0).bignumber.equal(tokensSentAnalytic0);

        const expectedAnalytic1EndBlock = await web3.eth.getBlockNumber();
        const {startBlock: startBlock1, endBlock: endBlock1, feeAmount: feeAmount1} = await this.quadVault.getMultipleAnalytics(1, 1);


        expect(startBlock1).bignumber.closeTo(expectedAnalytic0EndBlock.toString(), "10");
        expect(endBlock1).bignumber.closeTo(expectedAnalytic1EndBlock.toString(), "10");
        expect(feeAmount1).bignumber.equal(tokensSentAnalytic1);

        const {startBlock, endBlock, feeAmount} = await this.quadVault.getMultipleAnalytics(0, 1);

        expect(startBlock).bignumber.equal(startBlock0);
        expect(endBlock).bignumber.closeTo(endBlock1, "10");
        expect(feeAmount).bignumber.equal(tokensSentAnalytic1.add(tokensSentAnalytic0));

    });

    const waitNBlocks = async n => {
        const send = promisify(web3.currentProvider.send);
        await Promise.all(
          [...Array(n).keys()].map(i =>
            send({
              jsonrpc: '2.0',
              method: 'evm_mine',
              id: i
            })
          )
        );
      };

    /*
    it("should distribute rewards correctly", async () => {
        let sentTokens = web3.utils.toBN(10e18);
        await this.quadToken.transfer(this.feeCollector.address, sentTokens, { from: owner });

        let staker1Rewards = await this.quadVault.pendingRewards("0", staker1);
        let staker2Rewards = await this.quadVault.pendingRewards("0", staker2);
        let staker3Rewards = await this.quadVault.pendingRewards("1", staker3);

        let expectedStaker1Reward = sentTokens.muln(60).divn(100).muln(20).divn(30);
        let expectedStaker2Reward = sentTokens.muln(60).divn(100).muln(10).divn(30);
        let expectedStaker3Reward = sentTokens.muln(40).divn(100);

        expect(staker1Rewards).bignumber.closeTo(expectedStaker1Reward, 1e8.toString());
        expect(staker2Rewards).bignumber.closeTo(expectedStaker2Reward, 1e8.toString());
        expect(staker3Rewards).bignumber.closeTo(expectedStaker3Reward, 1e8.toString());

        expect(staker1Rewards.add(staker2Rewards).add(staker3Rewards)).bignumber.lte(sentTokens);
        expect(staker1Rewards.add(staker2Rewards).add(staker3Rewards)).bignumber.closeTo(sentTokens, 1e8.toString());

        await this.lpToken2.mint(staker1, 10e18.toString());
        await this.lpToken2.approve(this.quadVault.address, 10e18.toString(), { from: staker1 });
        await this.quadVault.deposit("1", 10e18.toString(), { from: staker1 });

        expect(await this.quadVault.pendingRewards("1", staker1)).bignumber.equal("0");

        await this.quadToken.transfer(this.feeCollector.address, sentTokens, { from: owner });

        staker1Rewards = await this.quadVault.pendingRewards("0", staker1);
        staker2Rewards = await this.quadVault.pendingRewards("0", staker2);
        staker3Rewards = await this.quadVault.pendingRewards("1", staker3);
        let staker1RewardsPool1 = await this.quadVault.pendingRewards("1", staker1);

        expectedStaker1Reward = expectedStaker1Reward.muln(2);
        expectedStaker2Reward = expectedStaker2Reward.muln(2);
        expectedStaker3Reward = expectedStaker3Reward.muln(20).divn(30).add(expectedStaker3Reward);
        let expectedStaker1RewardPool1 = sentTokens.muln(40).divn(100).muln(10).divn(30);

        expect(staker1Rewards).bignumber.closeTo(expectedStaker1Reward, 1e8.toString());
        expect(staker2Rewards).bignumber.closeTo(expectedStaker2Reward, 1e8.toString());
        expect(staker3Rewards).bignumber.closeTo(expectedStaker3Reward, 1e8.toString());
        expect(staker1RewardsPool1).bignumber.closeTo(expectedStaker1RewardPool1, 1e8.toString());

        expect(staker1Rewards.add(staker2Rewards).add(staker3Rewards).add(staker1RewardsPool1)).bignumber.lte(sentTokens.muln(2));
        expect(staker1Rewards.add(staker2Rewards).add(staker3Rewards).add(staker1RewardsPool1)).bignumber.closeTo(sentTokens.muln(2), 1e8.toString());

        await this.quadVault.withdraw("0", "0", { from: staker1 });
        await this.quadVault.withdraw("0", "0", { from: staker2 });
        await this.quadVault.withdraw("1", "0", { from: staker3 });
        await this.quadVault.withdraw("1", "0", { from: staker1 });

        expect(staker1Rewards.add(staker1RewardsPool1)).bignumber.equal(await this.quadToken.balanceOf(staker1));
        expect(staker2Rewards).bignumber.equal(await this.quadToken.balanceOf(staker2));
        expect(staker3Rewards).bignumber.equal(await this.quadToken.balanceOf(staker3));
    });*/

});