/**
 * Live epoch measurement script for ConfidentialBatchAuction on Sepolia.
 *
 * Runs a full epoch lifecycle and records gas and wall-clock latency at each step:
 *   createMarket → placeBet × N → resolveMarket → requestPoolReveal
 *   → (wait for relayer callback or manual onPoolRevealed) → requestPayout × N
 *   → onPayoutRevealed × N
 *
 * Usage:
 *   npx hardhat run scripts/measure-epoch.ts --network sepolia
 *
 * Set CONTRACT_ADDRESS env var to skip deployment and measure against an existing contract.
 * Set BET_COUNT env var to control the number of bettors (default 3, max ~10 for one wallet).
 */

import { ethers, fhevm, network } from "hardhat";

interface Measurement {
  step: string;
  gasUsed: bigint;
  wallMs: number;
  txHash: string;
  blockNumber: number;
}

const measurements: Measurement[] = [];

async function record(
  step: string,
  txPromise: Promise<any>,
): Promise<any> {
  const t0 = Date.now();
  const tx = await txPromise;
  const receipt = await tx.wait();
  const wallMs = Date.now() - t0;
  measurements.push({
    step,
    gasUsed: receipt.gasUsed,
    wallMs,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
  });
  console.log(`  ✓ ${step}`);
  console.log(`    gas: ${receipt.gasUsed.toLocaleString()}  wall: ${wallMs}ms  block: ${receipt.blockNumber}`);
  return receipt;
}

async function encryptSide(
  contractAddress: string,
  signerAddress: string,
  side: number,
): Promise<{ handle: string; inputProof: string }> {
  const enc = await fhevm
    .createEncryptedInput(contractAddress, signerAddress)
    .add8(BigInt(side))
    .encrypt();
  return { handle: enc.handles[0], inputProof: enc.inputProof };
}

function printSummary(totalEth: bigint) {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  EPOCH MEASUREMENT SUMMARY");
  console.log("══════════════════════════════════════════════════════");
  console.log(`  ${"Step".padEnd(40)} ${"Gas".padStart(12)}  ${"Wall (ms)".padStart(12)}`);
  console.log(`  ${"─".repeat(40)} ${"─".repeat(12)}  ${"─".repeat(12)}`);
  let totalGas = 0n;
  for (const m of measurements) {
    console.log(
      `  ${m.step.padEnd(40)} ${m.gasUsed.toLocaleString().padStart(12)}  ${m.wallMs.toLocaleString().padStart(12)}ms`,
    );
    totalGas += m.gasUsed;
  }
  console.log(`  ${"─".repeat(40)} ${"─".repeat(12)}  ${"─".repeat(12)}`);
  console.log(`  ${"TOTAL".padEnd(40)} ${totalGas.toLocaleString().padStart(12)}`);
  console.log("\n  Protocol observations:");
  const placeBets = measurements.filter((m) => m.step.startsWith("placeBet"));
  if (placeBets.length > 0) {
    const avgBetGas = placeBets.reduce((s, m) => s + m.gasUsed, 0n) / BigInt(placeBets.length);
    console.log(`  • avg placeBet gas: ${avgBetGas.toLocaleString()}`);
    console.log(`  • bettors in epoch: ${placeBets.length}`);
    console.log(`  • epoch total ETH:  ${ethers.formatEther(totalEth)} ETH`);
  }
  const poolReveal = measurements.find((m) => m.step === "requestPoolReveal");
  const poolCallback = measurements.find((m) => m.step === "onPoolRevealed");
  if (poolReveal && poolCallback) {
    console.log(`  • pool reveal latency: ${poolCallback.blockNumber - poolReveal.blockNumber} blocks`);
  }
  const payoutRequests = measurements.filter((m) => m.step.startsWith("requestPayout"));
  const payoutCallbacks = measurements.filter((m) => m.step.startsWith("onPayoutRevealed"));
  if (payoutRequests.length > 0) {
    const avgReqGas = payoutRequests.reduce((s, m) => s + m.gasUsed, 0n) / BigInt(payoutRequests.length);
    const avgClaimGas = payoutCallbacks.reduce((s, m) => s + m.gasUsed, 0n) / BigInt(payoutCallbacks.length);
    console.log(`  • avg requestPayout gas:    ${avgReqGas.toLocaleString()}`);
    console.log(`  • avg onPayoutRevealed gas: ${avgClaimGas.toLocaleString()}`);
  }
  console.log("══════════════════════════════════════════════════════\n");
}

async function main() {
  await fhevm.initializeCLIApi();

  const [deployer, alice, bob] = await ethers.getSigners();
  const contractAddress = process.env.CONTRACT_ADDRESS;

  console.log("Network:", network.name);
  console.log("Deployer:", deployer.address);

  let contract: any;

  if (contractAddress) {
    console.log("Using existing contract:", contractAddress);
    const Factory = await ethers.getContractFactory("ConfidentialBatchAuction");
    contract = Factory.attach(contractAddress);
  } else {
    console.log("\nDeploying ConfidentialBatchAuction...");
    const Factory = await ethers.getContractFactory("ConfidentialBatchAuction");
    const deployT0 = Date.now();
    contract = await Factory.deploy();
    await contract.waitForDeployment();
    const deployReceipt = await ethers.provider.getTransactionReceipt(
      contract.deploymentTransaction()!.hash,
    );
    measurements.push({
      step: "deploy",
      gasUsed: deployReceipt!.gasUsed,
      wallMs: Date.now() - deployT0,
      txHash: deployReceipt!.hash,
      blockNumber: deployReceipt!.blockNumber,
    });
    const addr = await contract.getAddress();
    console.log(`  ✓ deploy  ${addr}  gas: ${deployReceipt!.gasUsed.toLocaleString()}`);
  }

  const addr = await contract.getAddress();

  // ── 1. createMarket ──────────────────────────────────────────────────────
  // 5-minute epoch for fast live testing
  const EPOCH_DURATION = 300n; // 5 minutes
  console.log("\n[1] Creating market...");
  await record(
    "createMarket",
    contract.connect(deployer).createMarket(
      "Will ETH close above $3000 on this epoch?",
      EPOCH_DURATION,
    ),
  );
  const marketId = 0n;

  // ── 2. placeBet × 3 ──────────────────────────────────────────────────────
  console.log("\n[2] Placing encrypted bets...");
  const bettors = [
    { signer: deployer, side: 1, amount: "0.01" }, // YES
    { signer: alice,    side: 0, amount: "0.005" }, // NO
    { signer: bob,      side: 1, amount: "0.005" }, // YES
  ];

  let totalEth = 0n;
  for (let i = 0; i < bettors.length; i++) {
    const { signer, side, amount } = bettors[i];
    const enc = await encryptSide(addr, signer.address, side);
    await record(
      `placeBet[${i}] (${side === 1 ? "YES" : "NO"} ${amount} ETH)`,
      contract.connect(signer).placeBet(marketId, enc.handle, enc.inputProof, {
        value: ethers.parseEther(amount),
      }),
    );
    totalEth += ethers.parseEther(amount);
  }

  // ── 3. Wait for epoch to expire ───────────────────────────────────────────
  console.log("\n[3] Waiting for epoch to close...");
  const m = await contract.getMarket(marketId);
  const now = Math.floor(Date.now() / 1000);
  const epochEnd = Number(m.epochEnd);
  const waitSecs = Math.max(0, epochEnd - now + 15);
  console.log(`    epoch closes in ~${waitSecs}s — waiting...`);

  if (network.name === "sepolia" || network.name === "mainnet") {
    // Real network: poll until epoch closes
    const pollInterval = 15_000;
    while (true) {
      const latest = await ethers.provider.getBlock("latest");
      if (latest && latest.timestamp >= epochEnd) break;
      await new Promise((r) => setTimeout(r, pollInterval));
      process.stdout.write(".");
    }
    console.log("\n    epoch closed");
  } else {
    // Hardhat: time travel
    await ethers.provider.send("evm_increaseTime", [waitSecs]);
    await ethers.provider.send("evm_mine", []);
    console.log("    time-travelled to epoch close");
  }

  // ── 4. resolveMarket ─────────────────────────────────────────────────────
  console.log("\n[4] Resolving market (outcome = YES)...");
  await record(
    "resolveMarket",
    contract.connect(deployer).resolveMarket(marketId, 1),
  );

  // ── 5. requestPoolReveal ──────────────────────────────────────────────────
  console.log("\n[5] Requesting pool reveal...");
  const poolRevealT0 = Date.now();
  await record("requestPoolReveal", contract.requestPoolReveal(marketId));
  const [yesHandle, noHandle] = await contract.getEncPools(marketId);
  console.log("    yesPool handle:", yesHandle);
  console.log("    noPool handle: ", noHandle);

  // On Sepolia the relayer picks up makePubliclyDecryptable automatically.
  // On hardhat we simulate with fhevm.publicDecrypt.
  console.log("\n[6] Waiting for relayer / submitting onPoolRevealed...");
  if (network.name !== "sepolia") {
    const result = await fhevm.publicDecrypt([yesHandle, noHandle]);
    await record(
      "onPoolRevealed",
      contract.onPoolRevealed(
        marketId,
        [yesHandle, noHandle],
        result.abiEncodedClearValues,
        result.decryptionProof,
      ),
    );
  } else {
    // Poll for the relayer callback — the contract emits PoolRevealed once it arrives
    console.log("    polling for relayer PoolRevealed event...");
    const revealT0 = Date.now();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Relayer timeout after 3 minutes")), 180_000);
      contract.once("PoolRevealed", (...args: any[]) => {
        clearTimeout(timeout);
        const latencyMs = Date.now() - revealT0;
        console.log("    PoolRevealed event received");
        console.log(`    relayer latency: ${latencyMs}ms`);
        measurements.push({
          step: "relayer→PoolRevealed",
          gasUsed: 0n,
          wallMs: latencyMs,
          txHash: "",
          blockNumber: 0,
        });
        resolve();
      });
    });
  }

  const marketAfterReveal = await contract.getMarket(marketId);
  console.log(`    yesPool: ${ethers.formatEther(marketAfterReveal.revealedYesPool)} ETH`);
  console.log(`    noPool:  ${ethers.formatEther(marketAfterReveal.revealedNoPool)} ETH`);
  console.log(`    clearingPrice: ${Number(marketAfterReveal.clearingPrice) / 100}%`);

  // ── 7. requestPayout + onPayoutRevealed for each bettor ───────────────────
  console.log("\n[7] Settling payouts...");
  for (let i = 0; i < bettors.length; i++) {
    const { signer } = bettors[i];
    await record(
      `requestPayout[${i}]`,
      contract.connect(signer).requestPayout(marketId),
    );

    const encPayout = await contract.getEncPayout(marketId, signer.address);

    if (network.name !== "sepolia") {
      const result = await fhevm.publicDecrypt([encPayout]);
      const receipt = await record(
        `onPayoutRevealed[${i}]`,
        contract.onPayoutRevealed(
          marketId,
          signer.address,
          [encPayout],
          result.abiEncodedClearValues,
          result.decryptionProof,
        ),
      );
      const ev = receipt.logs
        .map((l: any) => {
          try { return contract.interface.parseLog(l); } catch { return null; }
        })
        .find((e: any) => e && e.name === "PayoutClaimed");
      if (ev) {
        console.log(`    payout: ${ethers.formatEther(ev.args.payout)} ETH`);
      }
    } else {
      console.log(`    encPayout handle: ${encPayout}`);
      console.log("    (on Sepolia: relayer will call onPayoutRevealed automatically)");
      console.log("    polling for PayoutClaimed event...");
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Payout timeout after 3 minutes")), 180_000);
        contract.once(
          contract.filters.PayoutClaimed(marketId, signer.address),
          (...args: any[]) => {
            clearTimeout(timeout);
            console.log(`    PayoutClaimed: ${ethers.formatEther(args[2])} ETH`);
            resolve();
          },
        );
      });
    }
  }

  printSummary(totalEth);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
