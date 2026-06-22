import { ethers, network } from "hardhat";

// One-off variant of deploy.ts for the June 2026 Sepolia gas spike: pins
// maxFeePerGas so the tx waits in the mempool for base fee to cool instead
// of failing ethers' 2x-base-fee balance check up front.
async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Network:", network.name);

  const treasury = process.env.TREASURY_ADDRESS ?? ethers.ZeroAddress;
  console.log("Treasury:", treasury);

  const Factory = await ethers.getContractFactory("ConfidentialBatchAuction");
  const contract = await Factory.deploy(treasury, {
    gasLimit: 3_650_000n,
    maxFeePerGas: ethers.parseUnits("16", "gwei"),
    maxPriorityFeePerGas: ethers.parseUnits("1.5", "gwei"),
  });
  const tx = contract.deploymentTransaction()!;
  console.log("Submitted:", tx.hash, "(nonce", tx.nonce + ") — waiting for base fee <= ~14.5 gwei");

  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  const receipt = await ethers.provider.getTransactionReceipt(tx.hash);
  console.log("\nDeployed!");
  console.log("Contract:  ", addr);
  console.log("Gas used:  ", receipt?.gasUsed.toString());
  console.log("Block:     ", receipt?.blockNumber);
  console.log("Etherscan: ", `https://sepolia.etherscan.io/address/${addr}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
