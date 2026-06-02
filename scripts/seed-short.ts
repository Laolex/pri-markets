/**
 * seed-short.ts — one short-epoch oracle market for a same-session full lifecycle test.
 * Bet + top-up while ACCUMULATING, then it closes for resolve → reveal → claim.
 */
import { ethers } from "hardhat";

const AUCTION = process.env.CONTRACT_ADDRESS ?? "0x68D2E94D5A94C542ea0741A8F38a957A436df2c6";
const ETH_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306"; // ETH/USD Sepolia
const EPOCH = 3 * 60 * 60; // 3 hours — comfortable window for the live test
const STRIKE = BigInt(Math.round(2000 * 1e8)); // $2,000 — low strike → very likely YES, easy resolve

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Creator:", signer.address);
  const c = new ethers.Contract(AUCTION, [
    "function createMarketWithOracle(string question, uint64 epochDuration, address priceFeed, int256 strikePrice) returns (uint256)",
    "function marketCount() view returns (uint256)",
  ], signer);

  const before = Number(await c.marketCount());
  const tx = await c.createMarketWithOracle(
    "Will ETH close above $2,000 in 3 hours? (live test)",
    BigInt(EPOCH), ETH_FEED, STRIKE,
  );
  const r = await tx.wait();
  console.log(`Created market id=${before}  gas=${r.gasUsed}  tx=${tx.hash}`);
  console.log(`Epoch closes: ${new Date(Date.now() + EPOCH * 1000).toUTCString()}`);
  console.log(`Bet here: https://confidential-batch-auction.vercel.app/market/${before}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
