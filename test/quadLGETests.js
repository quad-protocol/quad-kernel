const QuadLGE = artifacts.require("QuadLGE");

const UniFactory = artifacts.require("UniswapV2Factory");
const UniPair = artifacts.require("UniswapV2Pair");

const QuadAdminMock = artifacts.require("QuadAdminMock");
const ERC20 = artifacts.require("ERC20Mock");
const WETH = artifacts.require("WETHMock");
const TransferManager = artifacts.require("TransferManagerMock");

const truffleAssert = require("truffle-assertions");

const chai = require("chai");
chai.use(require("chai-bn")(require("bn.js")));

const { assert, expect } = chai;
 
contract("QuadLGE", addresses => {

    let owner = addresses[0];
    let governor = addresses[1];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });

        this.transferManager = await TransferManager.new();
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("TRANSFER_MANAGER_ROLE"), this.transferManager.address, { from: owner });

        this.uniFactory = await UniFactory.new(addresses[9]);

        this.quadToken = await ERC20.new(10e18.toString(), { from: owner });
        this.weth = await WETH.new(10e18.toString(), { from: owner });
        this.token = await ERC20.new(10e18.toString(), { from: owner });

        await this.uniFactory.createPair(this.quadToken.address, this.weth.address);
        await this.uniFactory.createPair(this.token.address, this.weth.address);

        this.quadPair = await UniPair.at(await this.uniFactory.getPair(this.quadToken.address, this.weth.address));
        this.tokenPair = await UniPair.at(await this.uniFactory.getPair(this.token.address, this.weth.address));

        await this.quadToken.transfer(this.quadPair.address, 10e18.toString(), { from: owner });
        await this.weth.transfer(this.quadPair.address, 5e18.toString(), { from: owner });
        await this.quadPair.mint(addresses[9]);

        await this.token.transfer(this.tokenPair.address, 5e18.toString(), { from: owner });
        await this.weth.transfer(this.tokenPair.address, 5e18.toString(), { from: owner });
        await this.tokenPair.mint(addresses[9]);

        this.lge = await QuadLGE.new(this.quadToken.address, this.quadAdmin.address, this.weth.address, this.uniFactory.address);

        let lgeRole = web3.utils.soliditySha3("LGE_ROLE");
        //await this.quadAdmin.grantRole(lgeRole, this.lge.address);
        await this.quadAdmin.setRoleAdmin(web3.utils.soliditySha3("WRAPPED_LP_ROLE"), lgeRole);
        await this.quadAdmin.setRoleAdmin(web3.utils.soliditySha3("LP_TOKEN_ROLE"), lgeRole);
        await this.quadAdmin.setRoleAdmin(web3.utils.soliditySha3("KILLABLE_ROLE"), lgeRole);

        await this.quadAdmin.register(web3.utils.soliditySha3("GOVERNOR_ROLE"), governor);
    });

    it("shouldn't allow non-governors to start the lge", async () => {
        await truffleAssert.reverts(
            this.lge.startLGE(this.token.address, "test", "test", 1e18.toString(), true, { from: owner }), "Address doesn't have the governor role"
        );
    });

    it("should allow governors to start the lge", async () => {
        let endTime = await currentTime() + 60 * 60 * 48;
        await truffleAssert.passes(
            this.lge.startLGE(this.token.address, "test", "test", endTime, true, { from: governor })
        );

        let lgeData = await this.lge.lges(0);
        assert.isTrue(lgeData.active);
        expect(lgeData.endTimestamp).bignumber.equal(endTime.toString());
        expect(lgeData.pairingToken).equal(this.token.address);
    });

    it("shouldn't allow multiple lges at the same time", async () => {
        let endTime = await currentTime() + 60 * 60 * 48;
        await truffleAssert.passes(
            this.lge.startLGE(this.token.address, "test", "test", endTime, true, { from: governor })
        );
        await truffleAssert.reverts(
            this.lge.startLGE((await ERC20.new("1")).address, "test", "test", endTime, true, { from: governor }), "LGE is ongoing"
        );
    });

    it("shouldn't allow calls to addLiquidity while an lge is ongoing", async () => {
        await truffleAssert.passes(
            this.lge.startLGE(this.token.address, "test", "test", (await currentTime()) + 60 * 60 * 48, true, { from: governor })
        );
        await truffleAssert.reverts(
            this.lge.addLiquidity(), "Liquidity already added or LGE ongoing"
        );
    });

    it("should allow contributions", async () => {
        await truffleAssert.passes(
            this.lge.startLGE(this.token.address, "test", "test", (await currentTime()) + 60 * 60 * 48, true, { from: governor })
        );
        let depositAmount = 5e18.toString();
        await this.token.approve(this.lge.address, depositAmount);
        await truffleAssert.passes(
            this.lge.contribute(depositAmount, { from: owner })
        );

        let lgeData = await this.lge.lges(0);
        let userDeposit = await this.lge.getUserDeposit(0, owner);
        expect(userDeposit.tokenAmount).bignumber.equal(depositAmount);
        expect(userDeposit.token).equal(this.token.address);
        expect(lgeData.tokensRaised).bignumber.equal(depositAmount);
    });

    it("should add liquidity correctly", async () => {
        await truffleAssert.passes(
            this.lge.startLGE(this.token.address, "test", "test", (await currentTime()) + 60 * 60 * 48, true, { from: governor })
        );

        let depositAmount = 5e18.toString();
        await this.token.approve(this.lge.address, depositAmount);
        await truffleAssert.passes(
            this.lge.contribute(depositAmount, { from: owner })
        );

        await increaseEVMTime(60 * 60 * 48);

        await truffleAssert.passes(
            this.lge.addLiquidity()
        );

        let pair = await UniPair.at(await this.uniFactory.getPair(this.quadToken.address, this.token.address));

        let tokenPerQuad = await quote(1e18, this.quadToken, pair);
        let ethPerTokenAmount = await quote(tokenPerQuad, this.token, this.tokenPair);
        let ethPerQuad = await quote(1e18, this.quadToken, this.quadPair);

        expect(ethPerQuad).bignumber.equal(ethPerTokenAmount);
    });

    it("should allow users to claim wrapped lp tokens correctly", async () => {
        await truffleAssert.passes(
            this.lge.startLGE(this.token.address, "test", "test", (await currentTime()) + 60 * 60 * 48, true, { from: governor })
        );

        let depositAmount = 5e18.toString();
        await this.token.approve(this.lge.address, depositAmount);
        await truffleAssert.passes(
            this.lge.contribute(depositAmount, { from: owner })
        );

        await increaseEVMTime(60 * 60 * 48);

        await truffleAssert.passes(
            this.lge.addLiquidity()
        );

        await truffleAssert.passes(
            this.lge.claim(0, { from: owner })
        );

        let lgeData = await this.lge.lges(0);
        let wlp = await ERC20.at(lgeData.wrappedPair);
        let lp = await ERC20.at(await this.uniFactory.getPair(this.token.address, this.quadToken.address));
        expect(await wlp.balanceOf(this.lge.address)).bignumber.zero;
        expect(await wlp.balanceOf(owner)).bignumber.closeTo(await lp.totalSupply(), "1000");
        expect(await lp.balanceOf(this.lge.address)).bignumber.zero;
        expect(await wlp.balanceOf(owner)).bignumber.equal(await wlp.totalSupply());
    });

    async function quote(inputAmount, inputToken, pair)  {
        let token0 = await pair.token0();
        let reserves = await pair.getReserves();

        reserves = token0 == inputToken.address 
            ? {inputReserve: reserves._reserve0, outputReserve: reserves._reserve1}
            : {inputReserve: reserves._reserve1, outputReserve: reserves._reserve0};

        inputAmount = web3.utils.isBN(inputAmount) ? inputAmount : web3.utils.toBN(inputAmount);

        return reserves.outputReserve.mul(inputAmount).div(reserves.inputReserve);
    }

    async function increaseEVMTime(timeToAdd) {
        return new Promise(resolve => {
            web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [timeToAdd], id: 0}, () => {
                web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0}, resolve);
            });
        });
    }

    async function currentTime() {
        return (await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp;
    }

})