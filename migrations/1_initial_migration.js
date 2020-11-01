const Migrations = artifacts.require("Migrations");

const QuadToken = artifacts.require("QuadToken");
const FeeManager = artifacts.require("FeeManager");
const TransferManager = artifacts.require("TransferManager");

module.exports = async function (deployer) {
  await deployer.deploy(Migrations);

  /*let transferManager = await deployer.deploy(TransferManager);
  let feeManager = await deployer.deploy(FeeManager, ["100"]);

  await deployer.deploy(QuadToken, ["QUAD", "QUAD", "18", 10000e18.toLocaleString("fullwide", { useGrouping: false }), feeManager.address, transferManager.address]);*/
};
