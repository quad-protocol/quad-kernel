const Migrations = artifacts.require("Migrations");

const QuadToken = artifacts.require("QuadToken");
const FeeManager = artifacts.require("FeeManager");
const TransferManager = artifacts.require("TransferManager");
const FeeCollector = artifacts.require("FeeCollector");
const QuadVault = artifacts.require("QuadVault");
const InitialLGE = artifacts.require("InitialQuadLGE");
const QuadLGE = artifacts.require("QuadLGE");

//imports needed if deploying with network development
const WETH = artifacts.require("WETHMock");
const UniswapFactory = artifacts.require("UniswapV2Factory");
const UniswapPair = artifacts.require("UniswapV2Pair");
const ERC20 = artifacts.require("ERC20Mock");

const { deployProxy } = require('@openzeppelin/truffle-upgrades');

const quadAdmin = ""; //QuadAdmin's address goes here

let uniswapFactory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
let weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

//in seconds
const lgeDuration = 60 * 60 * 24 * 7;

class PairingToken {

    constructor(address, pairName, pairSymbol) {
        this.address = address;
        this.pairName = pairName;
        this.pairSymbol = pairSymbol;
    }
}

let pairingTokens = [
    new PairingToken("address", "name", "symbol"),
    new PairingToken("address1", "name1", "symbol1")
];

module.exports = async function (deployer, network, addresses) {
    await deployer.deploy(Migrations);
    //network test skips migrations
    if (network == "test")
        return;
    
    const quadInitialSupply = web3.utils.toBN(10000e18.toLocaleString("fullwide", { useGrouping: false }));

    //network development mocks migrations
    if (network == "development") {
        const uniswapFactoryContract = await deployer.deploy(UniswapFactory, "0x0000000000000000000000000000000000000000");
        const wethContract = await deployer.deploy(WETH, quadInitialSupply.muln(3));
        
        pairingTokens = [];
        for (let i = 0; i < 3; i++) {
            let token = await deployer.deploy(ERC20, quadInitialSupply.muln(i + 1));
            await uniswapFactoryContract.createPair(token.address, wethContract.address);
            let pair = await uniswapFactoryContract.getPair(token.address, wethContract.address);
            await wethContract.transfer(pair, quadInitialSupply);
            await token.transfer(pair, quadInitialSupply.muln(i + 1).divn(2));
            (await UniswapPair.at(pair)).mint(addresses[0]);
            pairingTokens.push(new PairingToken(token.address, "QUADLP" + i, "QUADLP" + i));
        }

        pairingTokens.push(new PairingToken(wethContract.address, "QUADWETH", "QUADWETH"));

        weth = wethContract.address,
        uniswapFactory = uniswapFactoryContract.address;
    }

    const quadToken = await deployer.deploy(QuadToken, "QUAD", "QUAD", quadInitialSupply, quadAdmin);
    await deployer.deploy(TransferManager, quadAdmin);
    await deployer.deploy(FeeManager, 100, quadAdmin);
    await deployProxy(FeeCollector, ["300", quadAdmin], { initializer: "init", unsafeAllowCustomTypes: true });
    await deployProxy(QuadVault, [quadAdmin], { initializer: "_init", unsafeAllowCustomTypes: true });
    const initialLGE = await deployer.deploy(InitialLGE, quadAdmin, uniswapFactory, weth);
    await deployer.deploy(QuadLGE, quadAdmin, weth, uniswapFactory);

    await quadToken.transfer(initialLGE.address, quadInitialSupply);

    for (let i = 0; i < pairingTokens.length; i++) {
        await initialLGE.addPairingToken(pairingTokens[i].address, pairingTokens[i].pairName, pairingTokens[i].pairSymbol);
    }

    await initialLGE.startLGE((await web3.eth.getBlock("latest")).timestamp + lgeDuration);

};
