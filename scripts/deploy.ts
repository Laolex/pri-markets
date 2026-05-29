import { ethers, network, run } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Network:", network.name);

  if (balance < ethers.parseEther("0.004")) {
    throw new Error("Insufficient balance for deployment — fund the deployer first");
  }

  console.log("\nDeploying ConfidentialBatchAuction...");
  const Factory = await ethers.getContractFactory("ConfidentialBatchAuction");

  const deployTx = await Factory.getDeployTransaction();
  const gasEstimate = await ethers.provider.estimateGas(deployTx);
  const feeData = await ethers.provider.getFeeData();
  const gasCost = gasEstimate * (feeData.gasPrice ?? 0n);
  console.log("Deploy gas estimate:", gasEstimate.toString());
  console.log("Estimated cost:", ethers.formatEther(gasCost), "ETH");

  const contract = await Factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();

  const receipt = await ethers.provider.getTransactionReceipt(contract.deploymentTransaction()!.hash);
  console.log("\nDeployed!");
  console.log("Contract:  ", addr);
  console.log("Tx hash:   ", contract.deploymentTransaction()!.hash);
  console.log("Gas used:  ", receipt?.gasUsed.toString());
  console.log("Block:     ", receipt?.blockNumber);
  console.log("Etherscan: ", `https://sepolia.etherscan.io/address/${addr}`);
  console.log("\nUpdate frontend/src/config.ts:");
  console.log(`  MARKET_CONTRACT_ADDRESS = "${addr}"`);

  if (network.name !== "hardhat" && network.name !== "localhost") {
    // Note: hardhat-verify <=2.1.3 is broken against the Etherscan v2 API.
    // If this fails, upload std_input.json manually at https://sepolia.etherscan.io/verifyContract
    console.log("\nWaiting 30s for Etherscan indexing...");
    await new Promise((r) => setTimeout(r, 30_000));
    try {
      await run("verify:verify", { address: addr, constructorArguments: [] });
      console.log("Etherscan verification submitted");
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (/already verified/i.test(msg)) console.log("Already verified");
      else console.warn("Verify failed — use manual std_input.json upload:", msg);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
