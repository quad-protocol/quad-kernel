const TransferManager = artifacts.require("TransferManager");

const QuadAdminMock = artifacts.require("QuadAdminMock");
const ERC20Mock = artifacts.require("ERC20Mock");

const truffleAssert = require("truffle-assertions");

contract("TransferManager", addresses => {

    let owner = addresses[0];
    let killer = addresses[1];

    beforeEach(async () => {
        this.quadAdmin = await QuadAdminMock.new({ from: owner });
        this.transferManager = await TransferManager.new(this.quadAdmin.address);
        
        this.lpToken = await ERC20Mock.new(10e18.toString());
        await this.quadAdmin.grantRole(web3.utils.soliditySha3("GOVERNOR_ROLE"), killer);
        await this.quadAdmin.grantRole(web3.utils.soliditySha3("LP_TOKEN_ROLE"), this.lpToken.address);

        await this.transferManager.syncAll();
    });

    it("should be able to buy the token", async () => {
        //before a liquidity mint
        await truffleAssert.passes(
            this.transferManager.checkTransfer(this.lpToken.address, owner)
        );

        await this.lpToken.mint(owner, 1e18.toString());

        //after a liquidity mint
        await truffleAssert.passes(
            this.transferManager.checkTransfer(this.lpToken.address, owner)
        );
    });

    it("should be able to sell the token", async () => {
        //before a liquidity mint
        await truffleAssert.passes(
            this.transferManager.checkTransfer(owner, this.lpToken.address)
        );

        await this.lpToken.mint(owner, 1e18.toString());

        //after a liquidity mint
        await truffleAssert.passes(
            this.transferManager.checkTransfer(owner, this.lpToken.address)
        );
    });
    
    it("shouldn't be able to burn liquidity tokens***", async () => {
        //preventing 100% of liquidity burns without occasionally preventing buys is impossible.
        //this is because when adding liquidity tokens are sent to uniswap before the minting actually happens, making syncing in the same tx impossible
        await this.lpToken.burn(owner, 10e18.toString());

        await truffleAssert.reverts(
            this.transferManager.checkTransfer(this.lpToken.address, owner)
        );
    });

    it("should be able to burn liquidity tokens 2 days after killing the contract", async () => {
        await truffleAssert.passes(
            this.transferManager.kill({ from: killer })
        );

        await truffleAssert.passes(
            this.transferManager.checkTransfer(owner, owner)
        );

        await this.lpToken.burn(owner, 1e18.toString());
        await truffleAssert.reverts(
            this.transferManager.checkTransfer(this.lpToken.address, owner), "Liquidity burns are forbidden"
        );

        await this.transferManager.syncAll();
    
        await increaseEVMTime(60 * 60 * 48);

        await truffleAssert.reverts(
            this.transferManager.checkTransfer(owner, owner), "Only liquidity burns are allowed after the killswitch is triggered"
        );

        await truffleAssert.reverts(
            this.transferManager.checkTransfer(this.lpToken.address, owner), "Only liquidity burns are allowed after the killswitch is triggered"
        );

        await this.lpToken.burn(owner, 1e18.toString());
        await truffleAssert.passes(
            this.transferManager.checkTransfer(this.lpToken.address, owner)
        );
    });

    async function increaseEVMTime(timeToAdd) {
        return new Promise(resolve => {
            web3.currentProvider.send({jsonrpc: "2.0", method: "evm_increaseTime", params: [timeToAdd], id: 0}, () => {
                web3.currentProvider.send({jsonrpc: "2.0", method: "evm_mine", params: [], id: 0}, resolve);
            });
        });
    }

});