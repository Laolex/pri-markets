import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS } from "./abi.js";
import { publicDecrypt } from "./zama.js";
import { loadState, saveState } from "./state.js";

// ── Config ────────────────────────────────────────────────────────────────────

const POLL_MS     = 30_000;  // 30 s between sweeps
const BLOCK_RANGE = 500;     // max blocks per query
const DEPLOY_BLOCK = 10_940_944; // contract deployment block — oracle backfill start

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

// ── Oracle auto-resolution ────────────────────────────────────────────────────

async function resolveEligibleOracleMarkets(
  contract: ethers.Contract,
  oracleMarketIds: number[],
): Promise<void> {
  if (oracleMarketIds.length === 0) return;
  const now = Math.floor(Date.now() / 1000);

  for (const id of oracleMarketIds) {
    try {
      const m = await contract.getMarket(id);
      if (m.resolved) continue;
      if (Number(m.epochEnd) > now) continue;

      log(`market ${id}: epoch closed, triggering oracle resolution…`);
      const tx = await withRetry(
        () => contract.resolveByOracle(id),
        `resolveByOracle market=${id}`,
      );
      await tx.wait();
      log(`market ${id}: oracle resolved ✓ tx=${tx.hash}`);
    } catch (e) {
      console.error(`[keeper] resolveByOracle failed market=${id}:`, (e as Error).message);
    }
  }
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handlePoolReveal(contract: ethers.Contract, ev: ethers.EventLog) {
  const marketId: bigint = ev.args.marketId;
  const handles: string[] = Array.from(ev.args.handles as string[]);

  const m = await contract.getMarket(marketId);
  if (m.poolRevealed) {
    log(`market ${marketId}: pool already revealed, skipping`);
    return;
  }

  log(`market ${marketId}: decrypting pools…`);
  const { abiEncodedClearValues, decryptionProof } = await withRetry(
    () => publicDecrypt(handles),
    `publicDecrypt pools market=${marketId}`,
  );

  const tx = await withRetry(
    () => contract.onPoolRevealed(marketId, handles, abiEncodedClearValues, decryptionProof),
    `onPoolRevealed market=${marketId}`,
  );
  await tx.wait();
  log(`market ${marketId}: pool revealed ✓ tx=${tx.hash}`);
}

async function handlePayout(contract: ethers.Contract, ev: ethers.EventLog) {
  const marketId: bigint = ev.args.marketId;
  const bettor: string   = ev.args.bettor;
  const handle: string   = ev.args.handle;

  const pos = await contract.getPosition(marketId, bettor);
  if (pos.claimed) {
    log(`market ${marketId} bettor ${bettor}: already claimed, skipping`);
    return;
  }

  log(`market ${marketId}: settling payout for ${bettor}…`);
  const { abiEncodedClearValues, decryptionProof } = await withRetry(
    () => publicDecrypt([handle]),
    `publicDecrypt payout market=${marketId} bettor=${bettor}`,
  );

  const tx = await withRetry(
    () => contract.onPayoutRevealed(marketId, bettor, [handle], abiEncodedClearValues, decryptionProof),
    `onPayoutRevealed market=${marketId} bettor=${bettor}`,
  );
  await tx.wait();
  log(`market ${marketId}: settled ${bettor} ✓ tx=${tx.hash}`);
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function processRange(
  contract: ethers.Contract,
  from: number,
  to: number,
  oracleMarketIds: Set<number>,
): Promise<void> {
  const [oracleLogs, poolLogs, payoutLogs] = await Promise.all([
    contract.queryFilter(contract.filters.MarketCreatedWithOracle(), from, to),
    contract.queryFilter(contract.filters.PoolRevealRequested(), from, to),
    contract.queryFilter(contract.filters.PayoutRequested(), from, to),
  ]);

  for (const ev of oracleLogs) {
    const id = Number((ev as ethers.EventLog).args.marketId);
    if (!oracleMarketIds.has(id)) {
      oracleMarketIds.add(id);
      log(`market ${id}: oracle market discovered`);
    }
  }

  if (poolLogs.length || payoutLogs.length) {
    log(`blocks ${from}–${to}: ${poolLogs.length} pool reveal(s), ${payoutLogs.length} payout(s)`);
  }

  for (const ev of poolLogs) {
    try {
      await handlePoolReveal(contract, ev as ethers.EventLog);
    } catch (e) {
      console.error(`[keeper] pool reveal failed market=${(ev as ethers.EventLog).args.marketId}:`, e);
    }
  }

  for (const ev of payoutLogs) {
    try {
      await handlePayout(contract, ev as ethers.EventLog);
    } catch (e) {
      console.error(`[keeper] payout failed:`, e);
    }
  }
}

async function main() {
  const rpcUrl     = requireEnv("SEPOLIA_RPC_URL");
  const privateKey = requireEnv("KEEPER_PRIVATE_KEY");

  const FALLBACK_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
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
  const oracleMarketIds = new Set<number>(state.oracleMarketIds);

  if (lastBlock === 0) {
    lastBlock = Math.max(0, (await provider.getBlockNumber()) - 1);
    log(`first run, starting from block ${lastBlock}`);
  } else {
    log(`resuming from block ${lastBlock}`);
  }

  // Backfill: scan from deploy block to lastBlock for any oracle markets created before this run
  if (oracleMarketIds.size === 0) {
    log(`backfilling oracle markets from block ${DEPLOY_BLOCK}…`);
    for (let b = DEPLOY_BLOCK; b <= lastBlock; b += BLOCK_RANGE) {
      const to = Math.min(b + BLOCK_RANGE - 1, lastBlock);
      const logs = await contract.queryFilter(contract.filters.MarketCreatedWithOracle(), b, to);
      for (const ev of logs) {
        const id = Number((ev as ethers.EventLog).args.marketId);
        oracleMarketIds.add(id);
      }
    }
    if (oracleMarketIds.size > 0) {
      log(`backfill found ${oracleMarketIds.size} oracle market(s): [${[...oracleMarketIds].join(", ")}]`);
    }
  }

  log("keeper running — poll interval 30s");

  while (true) {
    try {
      const current = await provider.getBlockNumber();
      if (current > lastBlock) {
        const from = lastBlock + 1;
        const to   = Math.min(from + BLOCK_RANGE - 1, current);
        await processRange(contract, from, to, oracleMarketIds);
        lastBlock = to;
        saveState({ lastBlock, oracleMarketIds: [...oracleMarketIds] });
      }
      await resolveEligibleOracleMarkets(contract, [...oracleMarketIds]);
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
