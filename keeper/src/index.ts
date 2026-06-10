import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS } from "./abi.js";
import { publicDecrypt } from "./zama.js";
import { loadState, saveState } from "./state.js";
import { refreshDemoMarkets } from "./refresh.js";

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_MS          = 30_000;        // 30 s between sweeps
const REFRESH_INTERVAL = 6 * 60 * 60;  // 6 hours in seconds — how often to check demo slots
const BLOCK_RANGE      = 10;            // Alchemy free tier max blocks per eth_getLogs request
const MAX_CHUNKS_PER_POLL = 50;        // ≤ 500 blocks drained per poll — bounds a single sweep while clearing backlogs fast
const DEPLOY_BLOCK     = 11_031_063;    // V2 (overflow-safe claim) deployment block — oracle backfill start
const FALLBACK_RPC     = "https://ethereum-sepolia-rpc.publicnode.com";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 4,
  baseDelayMs = 8_000,
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      const delay = baseDelayMs * (i + 1);
      console.warn(`[keeper] ${label} attempt ${i + 1} failed — retry in ${delay}ms:`, (e as Error).message);
      await sleep(delay);
    }
  }
  throw new Error("unreachable");
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ── Oracle auto-settlement (resolve → request reveal) ───────────────────────────
//
// Drives both autonomous steps for closed oracle markets:
//   1. resolveByOracle — commit the outcome from Chainlink
//   2. requestPoolReveal — makePubliclyDecryptable + emit PoolRevealRequested
// The emitted event is then serviced by handlePoolReveal (publicDecrypt → onPoolRevealed),
// after which bettors can claim. Both calls are idempotent (guarded by on-chain flags), so a
// market already resolved/requested by the frontend or a prior run is simply skipped.

async function settleEligibleOracleMarkets(
  contract: ethers.Contract,
  oracleMarketIds: number[],
): Promise<void> {
  if (oracleMarketIds.length === 0) return;
  const now = Math.floor(Date.now() / 1000);

  for (const id of oracleMarketIds) {
    try {
      let m = await contract.getMarket(id);
      if (Number(m.epochEnd) > now) continue; // epoch still open

      // Step 1: resolve
      if (!m.resolved) {
        log(`market ${id}: epoch closed, resolving via oracle…`);
        const tx = await withRetry(() => contract.resolveByOracle(id), `resolveByOracle market=${id}`);
        await tx.wait();
        m = await contract.getMarket(id);
        log(`market ${id}: resolved ✓ outcome=${Number(m.outcome)} (0=NO,1=YES) tx=${tx.hash}`);
      }

      // Step 2: request pool reveal (handlePoolReveal finishes the decryption callback)
      if (m.resolved && !m.poolRevealRequested) {
        log(`market ${id}: requesting pool reveal…`);
        const tx = await withRetry(() => contract.requestPoolReveal(id), `requestPoolReveal market=${id}`);
        await tx.wait();
        log(`market ${id}: pool reveal requested ✓ tx=${tx.hash}`);
      }

      // Step 3: safety-net fee sweep for already-revealed markets whose reveal event was serviced
      // before the sweep hook existed (handlePoolReveal's primary sweep covers fresh reveals).
      if (m.poolRevealed) {
        await sweepFeesIfPending(contract, BigInt(id));
      }
    } catch (e) {
      console.error(`[keeper] settle failed market=${id}:`, (e as Error).message);
    }
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handlePoolReveal(contract: ethers.Contract, ev: ethers.EventLog) {
  const marketId: bigint = ev.args.marketId;
  const handles: string[] = Array.from(ev.args.handles as string[]);

  let m = await contract.getMarket(marketId);
  if (m.poolRevealed) {
    log(`market ${marketId}: pool already revealed, skipping`);
    await sweepFeesIfPending(contract, marketId);
    return;
  }
  if (!m.poolRevealRequested) {
    // Stale/duplicate event (e.g. re-seen while draining a block backlog) for a market
    // whose reveal was never requested or was already cleared — onPoolRevealed would
    // revert "No pending reveal". Skip instead of burning gas.
    log(`market ${marketId}: no pending reveal request, skipping`);
    return;
  }

  log(`market ${marketId}: decrypting pools…`);
  const { abiEncodedClearValues, decryptionProof } = await withRetry(
    () => publicDecrypt(handles),
    `publicDecrypt pools market=${marketId}`,
  );

  // Re-check after the (~10s) decryption: another tx or a duplicate event may have
  // revealed this market while publicDecrypt was in flight. Submitting onPoolRevealed
  // now would revert "Already revealed" (the 44990-gas wasted-tx we were seeing), so
  // re-read state and bail to the fee sweep instead.
  m = await contract.getMarket(marketId);
  if (m.poolRevealed) {
    log(`market ${marketId}: pool revealed concurrently during decryption, skipping submit`);
    await sweepFeesIfPending(contract, marketId);
    return;
  }

  const tx = await withRetry(
    () => contract.onPoolRevealed(marketId, handles, abiEncodedClearValues, decryptionProof),
    `onPoolRevealed market=${marketId}`,
  );
  await tx.wait();
  log(`market ${marketId}: pool revealed ✓ tx=${tx.hash}`);

  // Once pools are revealed the protocol fee (and any no-winner pot) is computable on-chain.
  // Sweep it into the treasury. Permissionless + idempotent (guarded by feesSwept), so a retry
  // or a prior manual sweep just no-ops.
  await sweepFeesIfPending(contract, marketId);
}

// ── Treasury fee sweep ──────────────────────────────────────────────────────────
//
// Collects the 2% protocol fee — or, when a market had no winning bettors, the entire pot —
// into the treasury address set in the contract. Safe to call repeatedly: getFeeInfo.feesSwept
// gates the on-chain transfer, so this skips already-swept markets.

async function sweepFeesIfPending(contract: ethers.Contract, marketId: bigint): Promise<void> {
  try {
    const info = await contract.getFeeInfo(marketId);
    if (info.feesSwept) return;
    log(`market ${marketId}: sweeping fees → treasury…`);
    const tx = await withRetry(() => contract.sweepFees(marketId), `sweepFees market=${marketId}`);
    await tx.wait();
    log(`market ${marketId}: fees swept ✓ tx=${tx.hash}`);
  } catch (e) {
    console.error(`[keeper] sweepFees failed market=${marketId}:`, (e as Error).message);
  }
}

// V2 note: settlement is a single-step `claim()` computed entirely in the coprocessor —
// there is no payout-reveal KMS callback for the keeper to service. The keeper's only
// callback duty is the pool reveal above.

// ── Main loop ─────────────────────────────────────────────────────────────────

async function processRange(
  contract: ethers.Contract,
  from: number,
  to: number,
  oracleMarketIds: Set<number>,
): Promise<void> {
  const [oracleLogs, poolLogs] = await Promise.all([
    contract.queryFilter(contract.filters.MarketCreatedWithOracle(), from, to),
    contract.queryFilter(contract.filters.PoolRevealRequested(), from, to),
  ]);

  for (const ev of oracleLogs) {
    const id = Number((ev as ethers.EventLog).args.marketId);
    if (!oracleMarketIds.has(id)) {
      oracleMarketIds.add(id);
      log(`market ${id}: oracle market discovered`);
    }
  }

  if (poolLogs.length) {
    log(`blocks ${from}–${to}: ${poolLogs.length} pool reveal(s)`);
  }

  for (const ev of poolLogs) {
    try {
      await handlePoolReveal(contract, ev as ethers.EventLog);
    } catch (e) {
      console.error(`[keeper] pool reveal failed market=${(ev as ethers.EventLog).args.marketId}:`, e);
    }
  }
}

async function main() {
  const rpcUrl     = requireEnv("SEPOLIA_RPC_URL");
  const privateKey = requireEnv("KEEPER_PRIVATE_KEY");

  const provider = new ethers.FallbackProvider([
    { provider: new ethers.JsonRpcProvider(rpcUrl),        priority: 1, weight: 1 },
    { provider: new ethers.JsonRpcProvider(FALLBACK_RPC),  priority: 2, weight: 1 },
  ], 11155111);
  const wallet   = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  log(`keeper wallet: ${wallet.address}`);
  log(`chain: ${network.name} (${network.chainId})`);
  log(`balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther("0.01")) {
    console.warn("[keeper] WARNING: balance below 0.01 ETH — fund the keeper wallet");
  }

  const state = loadState();
  let { lastBlock } = state;
  const oracleMarketIds  = new Set<number>(state.oracleMarketIds);
  let lastRefreshAt      = 0; // unix seconds — 0 forces immediate first run

  if (lastBlock === 0) {
    lastBlock = Math.max(0, (await provider.getBlockNumber()) - 1);
    log(`first run, starting from block ${lastBlock}`);
  } else {
    log(`resuming from block ${lastBlock}`);
  }

  // Backfill: scan from deploy block to lastBlock for any oracle markets created before this run.
  // Uses publicnode directly to avoid Alchemy free-tier rate limits on rapid sequential queries.
  if (oracleMarketIds.size === 0) {
    log(`backfilling oracle markets from block ${DEPLOY_BLOCK}…`);
    const backfillProvider = new ethers.JsonRpcProvider(FALLBACK_RPC);
    const backfillContract = new ethers.Contract(CONTRACT_ADDRESS, ABI, backfillProvider);
    for (let b = DEPLOY_BLOCK; b <= lastBlock; b += BLOCK_RANGE) {
      const to = Math.min(b + BLOCK_RANGE - 1, lastBlock);
      const logs = await backfillContract.queryFilter(backfillContract.filters.MarketCreatedWithOracle(), b, to);
      for (const ev of logs) {
        const id = Number((ev as ethers.EventLog).args.marketId);
        oracleMarketIds.add(id);
      }
      await sleep(50);
    }
    if (oracleMarketIds.size > 0) {
      log(`backfill found ${oracleMarketIds.size} oracle market(s): [${[...oracleMarketIds].join(", ")}]`);
    }
  }

  log("keeper running — poll interval 30s");

  while (true) {
    try {
      const current = await provider.getBlockNumber();
      // Drain the backlog in multiple BLOCK_RANGE-sized chunks per poll so a
      // restart/downtime gap is cleared in minutes instead of crawling 10
      // blocks/30s. Each eth_getLogs stays within the Alchemy free-tier 10-block
      // limit; chunks-per-poll is capped so a single poll stays bounded, and a
      // small inter-chunk sleep mirrors the backfill pacing to avoid rate limits.
      let chunks = 0;
      while (current > lastBlock && chunks++ < MAX_CHUNKS_PER_POLL) {
        const from = lastBlock + 1;
        const to   = Math.min(from + BLOCK_RANGE - 1, current);
        await processRange(contract, from, to, oracleMarketIds);
        lastBlock = to;
        saveState({ lastBlock, oracleMarketIds: [...oracleMarketIds] });
        if (current > lastBlock) await sleep(60);
      }
      await settleEligibleOracleMarkets(contract, [...oracleMarketIds]);

      // Refresh demo market slots on startup and every 6 hours
      const now = Math.floor(Date.now() / 1000);
      if (now - lastRefreshAt >= REFRESH_INTERVAL) {
        await refreshDemoMarkets(wallet, CONTRACT_ADDRESS, log);
        lastRefreshAt = now;
      }
    } catch (e) {
      console.error("[keeper] poll error:", e);
    }
    await sleep(POLL_MS);
  }
}

main().catch(e => {
  console.error("[keeper] fatal:", e);
  process.exit(1);
});
