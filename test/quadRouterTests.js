const QuadRouter = artifacts.require("QuadRouter");

const QuadAdminMock = artifacts.require("QuadAdminMock");

const UniV2Factory = artifacts.require("UniswapV2Factory");
const UniV2Pair = artifacts.require("UniswapV2Pair");

const WETHMock = artifacts.require("WETHMock");
const ERC20Mock = artifacts.require("ERC20Mock");

const LPTokenWrapper = artifacts.require("LPTokenWrapper");
const TransferManagerMock = artifacts.require("TransferManagerMock");

const truffleAssert = require("truffle-assertions");

const chai = require("chai");
chai.use(require("chai-bn")(require("bn.js")));

const { expect } = chai;

contract("QuadRouter", addresses => {

    const owner = addresses[0];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });

        this.uniV2Factory = await UniV2Factory.new(owner);
        this.weth = await WETHMock.new(100e18.toLocaleString("fullwide", { useGrouping: false }), { from: owner });
        this.pairingToken = await ERC20Mock.new(20e18.toString(), { from: owner });

        this.quadToken = await ERC20Mock.new(20e18.toString(), { from: owner });

        await this.uniV2Factory.createPair(this.quadToken.address, this.weth.address);
        await this.uniV2Factory.createPair(this.quadToken.address, this.pairingToken.address);
        this.quadWethPair = await UniV2Pair.at(await this.uniV2Factory.getPair(this.quadToken.address, this.weth.address));
        this.quadTokenPair = await UniV2Pair.at(await this.uniV2Factory.getPair(this.quadToken.address, this.pairingToken.address));

        await this.quadToken.transfer(this.quadWethPair.address, 10e18.toString(), { from: owner });
        await this.weth.transfer(this.quadWethPair.address, 40e18.toString(), { from: owner });
        await this.quadWethPair.mint(addresses[9]);
        await this.quadToken.transfer(this.quadTokenPair.address, 10e18.toString(), { from: owner });
        await this.pairingToken.transfer(this.quadTokenPair.address, 15e18.toString(), { from: owner });
        await this.quadTokenPair.mint(addresses[9]);
        
        this.wrappedWethPair = await LPTokenWrapper.new("QUADWETH", "QUADWETH", this.quadWethPair.address, true, this.quadAdmin.address, { from: owner });
        this.wrappedTokenPair = await LPTokenWrapper.new("QUADTOKEN", "QUADTOKEN", this.quadTokenPair.address, true, this.quadAdmin.address, { from: owner });

        this.transferManager = await TransferManagerMock.new();

        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("QUAD_TOKEN_ROLE"), this.quadToken.address);
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("TRANSFER_MANAGER_ROLE"), this.transferManager.address);
        let lpRole = web3.utils.soliditySha3("LP_TOKEN_ROLE");
        await this.quadAdmin.register(lpRole, this.quadWethPair.address);
        await this.quadAdmin.register(lpRole, this.quadTokenPair.address);
        let wLpRole = web3.utils.soliditySha3("WRAPPED_LP_ROLE");
        await this.quadAdmin.register(wLpRole, this.wrappedTokenPair.address);
        await this.quadAdmin.register(wLpRole, this.wrappedWethPair.address);

        this.quadRouter = await QuadRouter.new(this.uniV2Factory.address, this.weth.address, this.quadAdmin.address);

        const infinity = web3.utils.toBN(2).pow(web3.utils.toBN(256)).subn(1);
        await this.pairingToken.approve(this.quadRouter.address, infinity, { from: owner });
    });

    it("should allow liquidity adds using eth", async () => {
        const ethAmount = web3.utils.toBN(5e18);

        const expectedLPAmount = await this.quadRouter.estimateOutputLiquidityETH(ethAmount);

        await truffleAssert.passes(
            this.quadRouter.addLiquidityETH({ from: owner, value: ethAmount })
        );

        expect(await this.wrappedWethPair.balanceOf(owner)).bignumber.equal(expectedLPAmount);
    });

    it("should allow liquidity adds using any pairing token", async () => {
        const tokenAmount = web3.utils.toBN(5e18);

        const expectedLPAmount = await this.quadRouter.estimateOutputLiquidity(this.pairingToken.address, tokenAmount);

        await truffleAssert.passes(
            this.quadRouter.addLiquidity(this.pairingToken.address, tokenAmount, { from: owner })
        );

        expect(await this.wrappedTokenPair.balanceOf(owner)).bignumber.equal(expectedLPAmount);
    });

});