/**
 * seed-demo.ts
 *
 * Creates a set of long-running oracle markets designed to stay ACCUMULATING
 * throughout a 2-week judging window. Run this once before submission.
 *
 * Usage:
 *   npx hardhat run scripts/seed-demo.ts --network sepolia
 *
 * What it creates:
 *   - 5 oracle markets with 14-day epochs (live for the full judging window)
 *   - Covers ETH, BTC, and LINK feeds at varying strike prices
 *   - One deliberately easy-to-resolve market (short epoch, slightly OTM)
 *     so the ClearingPriceHistory section has at least one entry
 *
 * The contract address is read from the hardhat vars (same as deploy.ts).
 * Set CONTRACT_ADDRESS below or pass via env.
 */

import { ethers } from "hardhat";

// ── Config ────────────────────────────────────────────────────────────────────

// Update this after deploy, or set CONTRACT_ADDRESS env var
const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS ?? "0x06F2f1B8B5e41575a17A7EFB91Ce4d4561FF5Ae3";

const DAY  = 60 * 60 * 24;
const WEEK = DAY * 7;

// Chainlink feeds on Sepolia (8 decimal USD)
const FEEDS = {
  ETH:  "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  BTC:  "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  LINK: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
};

function toFeedUnits(price: number): bigint {
  return BigInt(Math.round(price * 1e8));
}

// ── Markets to seed ───────────────────────────────────────────────────────────

const DEMO_MARKETS: {
  question: string;
  duration: number;
  feed: string;
  strike: bigint;
  note: string;
}[] = [
  // --- 14-day epochs (stay ACCUMULATING throughout the judging window) ---
  {
    question:  "Will ETH close above $2,500 at epoch end?",
    duration:  WEEK * 2,
    feed:      FEEDS.ETH,
    strike:    toFeedUnits(2500),
    note:      "ETH/USD · 14d · moderate strike",
  },
  {
    question:  "Will ETH close above $3,500 at epoch end?",
    duration:  WEEK * 2,
    feed:      FEEDS.ETH,
    strike:    toFeedUnits(3500),
    note:      "ETH/USD · 14d · higher strike",
  },
  {
    question:  "Will BTC close above $90,000 at epoch end?",
    duration:  WEEK * 2,
    feed:      FEEDS.BTC,
    strike:    toFeedUnits(90000),
    note:      "BTC/USD · 14d · below current ATH zone",
  },
  {
    question:  "Will BTC close above $110,000 at epoch end?",
    duration:  WEEK * 2,
    feed:      FEEDS.BTC,
    strike:    toFeedUnits(110000),
    note:      "BTC/USD · 14d · above ATH zone",
  },
  {
    question:  "Will LINK close above $15 at epoch end?",
    duration:  WEEK * 2,
    feed:      FEEDS.LINK,
    strike:    toFeedUnits(15),
    note:      "LINK/USD · 14d",
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance    = await ethers.provider.getBalance(deployer.address);
  console.log("Seeder:   ", deployer.address);
  console.log("Balance:  ", ethers.formatEther(balance), "ETH");
  console.log("Contract: ", CONTRACT_ADDRESS);
  console.log();

  const ABI = [
    "function createMarketWithOracle(string question, uint64 epochDuration, address priceFeed, int256 strikePrice) returns (uint256)",
    "function marketCount() view returns (uint256)",
  ];

  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, deployer);

  const before = Number(await contract.marketCount());
  console.log(`Markets before seed: ${before}`);
  console.log(`Creating ${DEMO_MARKETS.length} demo markets...\n`);

  for (let i = 0; i < DEMO_MARKETS.length; i++) {
    const m = DEMO_MARKETS[i];
    process.stdout.write(`  [${i + 1}/${DEMO_MARKETS.length}] ${m.note} ... `);

    try {
      const tx = await contract.createMarketWithOracle(
        m.question,
        BigInt(m.duration),
        m.feed,
        m.strike,
      );
      const receipt = await tx.wait();
      const marketId = before + i;
      console.log(`✓  id=${marketId}  gas=${receipt.gasUsed}`);
    } catch (err: unknown) {
      console.error(`✗  ${(err as Error).message?.slice(0, 120)}`);
    }

    // Brief pause to avoid nonce collisions on fast RPCs
    await new Promise((r) => setTimeout(r, 2_000));
  }

  const after = Number(await contract.marketCount());
  console.log(`\nMarkets after seed: ${after} (+${after - before})`);
  console.log("\nEpoch durations:");
  console.log("  14-day epochs close:", new Date(Date.now() + WEEK * 2 * 1000).toUTCString());
  console.log("\nFrontend: https://confidential-batch-auction.vercel.app");
  console.log("Contract: https://sepolia.etherscan.io/address/" + CONTRACT_ADDRESS);
  console.log("\nDone. Judges will see ACCUMULATING epochs for the full judging window.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
