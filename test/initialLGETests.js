const InitialLGE = artifacts.require("InitialQuadLGE");
const LPTokenWrapper = artifacts.require("LPTokenWrapper");

const WETH = artifacts.require("WETHMock");
const UniFactory = artifacts.require("UniswapV2Factory");
const IUniPair = artifacts.require("IUniswapV2Pair");

const QuadAdminMock = artifacts.require("QuadAdminMock");
const ERC20Mock = artifacts.require("ERC20Mock");
const TransferManagerMock = artifacts.require("TransferManagerMock");

const truffleAssert = require("truffle-assertions");
const chai = require("chai");
const { assert } = require("chai");
const { expect } = chai;

chai.use(require("chai-bn")(require("bn.js")));

contract("InitialQuadLGE", addresses => {

    let owner = addresses[0];
    let lpProvider1 = addresses[1];
    let lpProvider2 = addresses[2];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });

        this.transferManagerMock = await TransferManagerMock.new();
        await this.quadAdmin.registerSingleton(web3.utils.soliditySha3("TRANSFER_MANAGER_ROLE"), this.transferManagerMock.address, { from: owner })

        this.weth = await WETH.new(15e18.toString(), { from: owner });

        this.quadToken = await ERC20Mock.new(10e18.toString(), { from: owner });

        this.uniFactory = await UniFactory.new(owner);

        let lgeRole = web3.utils.soliditySha3("LGE_ROLE");
        this.lge = await InitialLGE.new(this.quadToken.address, this.quadAdmin.address, this.uniFactory.address, this.weth.address);
        //await this.quadAdmin.grantRole(lgeRole, this.lge.address, { from: owner });
        await this.quadAdmin.setRoleAdmin(web3.utils.soliditySha3("LP_TOKEN_ROLE"), lgeRole);
        await this.quadAdmin.setRoleAdmin(web3.utils.soliditySha3("WRAPPED_LP_ROLE"), lgeRole);
        await this.quadToken.transfer(this.lge.address, 10e18.toString());

        this.pairingTokens = [];

        for (let i = 0; i < 3; i ++) {
            let token = await ERC20Mock.new(10e18.toString());
            
            await this.uniFactory.createPair(this.weth.address, token.address);
            let pair = await IUniPair.at(await this.uniFactory.getPair(this.weth.address, token.address));

            await token.mint(pair.address, 23e18.toString());
            await this.weth.transfer(pair.address, 5e18.toString(), { from: owner });

            await pair.mint(addresses[3]);

            this.pairingTokens.push(token);
        }

        this.pairingTokens.push(this.weth);

        this.wrappedLPTokens = [];

        for (let i = 0; i < this.pairingTokens.length; i++) {
            let t = this.pairingTokens[i];
            await this.lge.addPairingToken(t.address, "lp" + i, "lp" + i, { from: owner });
            this.wrappedLPTokens.push(await LPTokenWrapper.at(await this.quadAdmin.getRoleMember(web3.utils.soliditySha3("WRAPPED_LP_ROLE"), i)));
        }
    });

    it("shouldn't be able to contribute before lge is started", async () => {
        await truffleAssert.reverts(
            this.lge.contribute({ from: owner, value: 10e18.toString() }), "LGE isn't ongoing"
        );
    });

    it("shouldn't allow calls to addLiquidity before lge starts", async () => {
        await truffleAssert.reverts(
            this.lge.addLiquidity(), "LGE isn't finished"
        );
    });

    it("should be able to contribute after lge starts", async () => {
        await truffleAssert.passes(
            this.lge.startLGE((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp + 60 * 60 * 24 * 7)
        );
        
        truffleAssert.passes(
            await this.lge.contribute({ from: owner, value: 10e18.toString() })
        );
    });

    it("shouldn't allow calls to addLiquidity before lge finishes", async () => {
        await truffleAssert.passes(
            this.lge.startLGE((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp + 60 * 60 * 24 * 7)
        );
        await truffleAssert.reverts(
            this.lge.addLiquidity(), "LGE isn't finished"
        );
    });

    it("should allow calls to addLiquidity after lge finishes", async () => {
        await truffleAssert.passes(
            this.lge.startLGE((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp + 60 * 60 * 24 * 7)
        );

        truffleAssert.passes(
            await this.lge.contribute({ from: owner, value: 10e18.toString() })
        );

        await increaseEVMTime(60 * 60 * 24 * 7 + 60);

        await truffleAssert.passes(
            this.lge.addLiquidity()
        );

        assert.isTrue(await this.transferManagerMock.syncCalled());
    });

    it("should have the correct amount of tokens in the pairs", async () => {
        await this.lge.startLGE((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp + 60 * 60 * 24 * 7);

        let ownerContribution = web3.utils.toBN(10e18);
        let lpProvider1Contribution = web3.utils.toBN(10e18);
        let lpProvider2Contribution = web3.utils.toBN(10e18);

        let totalContributions = ownerContribution.add(lpProvider1Contribution).add(lpProvider2Contribution);

        let amountOut = getAmountOut(totalContributions.divn(4), 5e18.toString(), 23e18.toString());

        await this.lge.contribute({ from: owner, value: ownerContribution });
        await this.lge.contribute({ from: lpProvider1, value: lpProvider1Contribution });
        await this.lge.contribute({ from: lpProvider2, value: lpProvider2Contribution });

        await increaseEVMTime(60 * 60 * 24 * 7 + 60);

        await truffleAssert.passes(this.lge.addLiquidity());

        expect(await this.weth.balanceOf(this.lge.address)).bignumber.zero;
        expect(await this.quadToken.balanceOf(this.lge.address)).bignumber.zero;

        for (let i = 0; i < this.wrappedLPTokens.length; i++) {
            let pair = await IUniPair.at(await this.wrappedLPTokens[i]._lpToken());
            let reserves = await pair.getReserves();
            let token0 = await pair.token0();
            let token1 = await pair.token1();
            reserves = token0 == this.quadToken.address ? {quadReserve: reserves.reserve0, tokenReserve: reserves.reserve1} : {quadReserve: reserves.reserve1, tokenReserve: reserves.reserve0};
            
            expect(reserves.quadReserve).bignumber.equal(2.5e18.toString());
            
            if (token0 == this.weth.address || token1 == this.weth.address)
                expect(reserves.tokenReserve).bignumber.equal(totalContributions.divn(4));
            else
                expect(reserves.tokenReserve).bignumber.equal(amountOut);
        }
    });

    it("should distribute tokens correctly", async () => {
        await this.lge.startLGE((await web3.eth.getBlock(await web3.eth.getBlockNumber())).timestamp + 60 * 60 * 24 * 7);

        let ownerContribution = web3.utils.toBN(10e18);
        let lpProvider1Contribution = web3.utils.toBN(37e18);
        let lpProvider2Contribution = web3.utils.toBN(59e18);

        let totalContributions = ownerContribution.add(lpProvider1Contribution).add(lpProvider2Contribution);

        await this.lge.contribute({ from: owner, value: ownerContribution });
        await this.lge.contribute({ from: lpProvider1, value: lpProvider1Contribution });
        await this.lge.contribute({ from: lpProvider2, value: lpProvider2Contribution });

        await increaseEVMTime(60 * 60 * 24 * 7 + 60);

        await truffleAssert.passes(this.lge.addLiquidity());
        assert.isTrue(await this.transferManagerMock.syncCalled.call());

        await truffleAssert.passes(this.lge.claimTokens({ from: owner }));
        await truffleAssert.passes(this.lge.claimTokens({ from: lpProvider1 }));
        await truffleAssert.passes(this.lge.claimTokens({ from: lpProvider2 }));

        let magnitude = web3.utils.toBN(2).pow(web3.utils.toBN(128));
        for (let i = 0; i < this.wrappedLPTokens.length; i++) {
            let t = this.wrappedLPTokens[i];
            let totalSupply = await t.totalSupply();
            let lpToken = await ERC20Mock.at(await t._lpToken());

            //Uniswap keeps 10 ** 3 lp tokens on the first mint
            expect(await lpToken.totalSupply()).bignumber.equal(totalSupply.addn(1000));

            expect(await t.balanceOf(owner)).bignumber.above("0");
            expect(await t.balanceOf(lpProvider1)).bignumber.above("0");
            expect(await t.balanceOf(lpProvider1)).bignumber.above("0");

            expect(await t.balanceOf(owner)).bignumber.equal(ownerContribution.mul(magnitude).div(totalContributions).mul(totalSupply).div(magnitude));
            expect(await t.balanceOf(lpProvider1)).bignumber.equal(lpProvider1Contribution.mul(magnitude).div(totalContributions).mul(totalSupply).div(magnitude));
            expect(await t.balanceOf(lpProvider2)).bignumber.equal(lpProvider2Contribution.mul(magnitude).div(totalContributions).mul(totalSupply).div(magnitude));
        }
    });

    async function increaseEVMTime(timeToAdd) {
        return new Promise(resolve => {
            web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [timeToAdd], id: 0}, () => {
                web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0}, resolve);
            });
        });
    }

    function getAmountOut(amountIn, reserveIn, reserveOut) {
        amountIn = web3.utils.isBN(amountIn) ? amountIn : web3.utils.toBN(amountIn);
        reserveIn = web3.utils.isBN(reserveIn) ? reserveIn : web3.utils.toBN(reserveIn);
        reserveOut = web3.utils.isBN(reserveOut) ? reserveOut : web3.utils.toBN(reserveOut);
    
        let amountInWithFee = amountIn.muln(997);
    
        return amountInWithFee.mul(reserveOut).div(reserveIn.muln(1000).add(amountInWithFee));
    }

});