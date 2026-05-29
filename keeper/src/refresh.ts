/**
 * refresh.ts — Demo market freshness keeper
 *
 * Maintains a set of "canonical" demo market slots. Each slot is defined by
 * a (feed, strike) pair. When an existing market for a slot is no longer
 * ACCUMULATING (epoch closed), a fresh 14-day epoch is created automatically.
 *
 * This ensures judges always land on live sealed-pool markets regardless of
 * when they visit the frontend during the judging window.
 */

import { ethers } from "ethers";

const WEEK   = 60 * 60 * 24 * 7;
const TWO_WEEKS = WEEK * 2;

// Chainlink feeds on Sepolia (8 decimal USD)
const FEEDS = {
  ETH:  "0x694AA1769357215DE4FAC081bf1f309aDC325306",
  BTC:  "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  LINK: "0xc59E3633BAAC79493d908e63626716e204A45EdF",
} as const;

function toFeedUnits(price: number): bigint {
  return BigInt(Math.round(price * 1e8));
}

// Canonical demo slots — one live accumulating market per slot at all times
interface DemoSlot {
  question:  string;
  feed:      string;
  strike:    bigint;
  duration:  number;
}

const DEMO_SLOTS: DemoSlot[] = [
  { question: "Will ETH close above $2,500 at epoch end?",   feed: FEEDS.ETH,  strike: toFeedUnits(2500),   duration: TWO_WEEKS },
  { question: "Will ETH close above $3,500 at epoch end?",   feed: FEEDS.ETH,  strike: toFeedUnits(3500),   duration: TWO_WEEKS },
  { question: "Will BTC close above $90,000 at epoch end?",  feed: FEEDS.BTC,  strike: toFeedUnits(90000),  duration: TWO_WEEKS },
  { question: "Will BTC close above $110,000 at epoch end?", feed: FEEDS.BTC,  strike: toFeedUnits(110000), duration: TWO_WEEKS },
  { question: "Will LINK close above $15 at epoch end?",     feed: FEEDS.LINK, strike: toFeedUnits(15),     duration: TWO_WEEKS },
];

// Minimal ABI additions for refresh
const REFRESH_ABI = [
  "function marketCount() external view returns (uint256)",
  "function getMarket(uint256 marketId) external view returns (address creator, string question, uint64 epochStart, uint64 epochEnd, bool resolved, uint8 outcome, uint256 totalEth, uint256 revealedYesPool, uint256 revealedNoPool, uint256 clearingPrice, bool poolRevealRequested, bool poolRevealed, address priceFeed, int256 strikePrice, bool useOracle)",
  "function createMarketWithOracle(string question, uint64 epochDuration, address priceFeed, int256 strikePrice) external returns (uint256)",
] as const;

interface MarketSnapshot {
  id:         number;
  feed:       string;
  strike:     bigint;
  epochEnd:   number;
  isOracle:   boolean;
}

async function fetchAllMarkets(
  contract: ethers.Contract,
  log: (msg: string) => void,
): Promise<MarketSnapshot[]> {
  const count = Number(await contract.marketCount());
  if (count === 0) return [];

  const snapshots: MarketSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    try {
      const m = await contract.getMarket(i);
      snapshots.push({
        id:       i,
        feed:     (m.priceFeed as string).toLowerCase(),
        strike:   m.strikePrice as bigint,
        epochEnd: Number(m.epochEnd as bigint),
        isOracle: m.useOracle as boolean,
      });
    } catch (e) {
      log(`[refresh] getMarket(${i}) failed: ${(e as Error).message}`);
    }
  }
  return snapshots;
}

function slotKey(feed: string, strike: bigint): string {
  return `${feed.toLowerCase()}:${strike.toString()}`;
}

function isAccumulating(m: MarketSnapshot, now: number): boolean {
  return m.isOracle && m.epochEnd > now;
}

export async function refreshDemoMarkets(
  signer: ethers.Signer,
  contractAddress: string,
  log: (msg: string) => void,
): Promise<void> {
  const contract = new ethers.Contract(contractAddress, REFRESH_ABI, signer);
  const now = Math.floor(Date.now() / 1000);

  log("[refresh] checking demo market slots…");
  const markets = await fetchAllMarkets(contract, log);

  // Build a map: slot key → true if there's an active accumulating market
  const activeSlots = new Map<string, boolean>();
  for (const m of markets) {
    if (isAccumulating(m, now)) {
      activeSlots.set(slotKey(m.feed, m.strike), true);
    }
  }

  let created = 0;
  for (const slot of DEMO_SLOTS) {
    const key = slotKey(slot.feed, slot.strike);
    if (activeSlots.get(key)) continue;

    log(`[refresh] slot ${key} has no active market — creating replacement…`);
    try {
      const tx = await contract.createMarketWithOracle(
        slot.question,
        BigInt(slot.duration),
        slot.feed,
        slot.strike,
      );
      const receipt = await tx.wait();
      log(`[refresh] created market gas=${receipt.gasUsed} slot=${key} ✓`);
      created++;

      // Don't hammer the RPC
      await new Promise((r) => setTimeout(r, 3_000));
    } catch (e) {
      log(`[refresh] failed to create market for slot ${key}: ${(e as Error).message}`);
    }
  }

  if (created === 0) {
    log("[refresh] all slots active — no refresh needed");
  } else {
    log(`[refresh] refreshed ${created} slot(s)`);
  }
}
