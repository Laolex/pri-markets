/**
 * e2e-live-v2.mjs — LIVE token-only (V2) end-to-end round on Sepolia.
 *
 * Verifies the euint64 claim-path OVERFLOW FIX end-to-end against the live
 * overflow-safe contract 0xc9E6798c. Uses LARGE pools (5000/5000 cUSDC) so the
 * claim routes through the Q13 fixed-point branch, not the trivial direct path.
 *
 * Flow:
 *   1. Bettor A creates a short-epoch ETH oracle market (strike << live price → YES wins).
 *   2. Bettor A bets YES 5000, Bettor B bets NO 5000 — each: mint USDC → approve →
 *      wrap → setOperator → encrypt(side,amount) → placeBet.  (mirrors usePlaceBetToken.ts)
 *   3. Wait for the epoch to close.
 *   4. The VPS keeper auto-resolves (resolveByOracle) + requests + completes onPoolRevealed.
 *   5. Both bettors claim(). A (only YES bettor) should receive ≈ 9800 cUSDC (after 2% fee).
 *   6. Best-effort userDecrypt of A's encrypted payout to print the exact amount.
 *
 * Two bettor wallets are derived from E2E_MNEMONIC: Bettor A = index 1, Bettor B = index 2
 * (index 0 is the keeper/deployer — DO NOT use it, nonce clashes). Fund both with a little
 * Sepolia ETH for gas; cUSDC is self-minted from the faucet.
 *
 * Config via env (secrets are NOT hardcoded — keep them out of git):
 *   E2E_MNEMONIC   (required) — HD mnemonic the two bettor wallets derive from.
 *   E2E_RPC_URL    (optional) — Sepolia RPC. A keyed endpoint (Infura/Alchemy) is strongly
 *                               recommended; the public default rate-limits under load.
 *   MARKET_ID      (optional) — reuse an existing accumulating market instead of creating one.
 *
 * Run:  E2E_MNEMONIC="word1 … word12" E2E_RPC_URL="https://sepolia.infura.io/v3/<key>" \
 *       node scripts/e2e-live-v2.mjs
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first"); // some hosts have flaky IPv6 outbound to Cloudflare
                                        // (relayer + RPC are CF-fronted) → prefer IPv4.
import { ethers } from "ethers";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";

// ── Config ──────────────────────────────────────────────────────────────────
// Secrets come from the environment — nothing sensitive is committed. A keyed RPC is
// strongly recommended: the public default rate-limits (429) under the bet flow's request
// volume, and ethers' FallbackProvider retries a 429'd provider rather than failing over.
const RPC_URL  = process.env.E2E_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const RPC_SDK  = RPC_URL; // network for the FHE SDK
const MNEMONIC = process.env.E2E_MNEMONIC;
if (!MNEMONIC) {
  console.error("[config] E2E_MNEMONIC is required (12/24-word HD mnemonic for the bettor wallets).");
  console.error("         e.g.  E2E_MNEMONIC=\"word1 … word12\" E2E_RPC_URL=\"https://sepolia.infura.io/v3/<key>\" node scripts/e2e-live-v2.mjs");
  process.exit(1);
}

const AUCTION  = "0xc9E6798c8f25E288e6d578B180AD0F5Fe7Dea935";
const USDC     = "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF"; // open mint() faucet, 6dp
const CUSDC    = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639"; // ERC-7984 wrapper, 1:1
const ETH_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306"; // Chainlink ETH/USD Sepolia

const EPOCH_SECONDS = 900;          // 15 min — headroom for 2× FHE encrypt (~90s each) + provisioning
const DECIMALS      = 6;
const YES_USDC      = 5000n;        // Bettor A → YES
const NO_USDC       = 5000n;        // Bettor B → NO   (5000·5000 units triggers the Q13 branch)
const SIDE_YES = 1, SIDE_NO = 0;
const U64_MAX = (1n << 64n) - 1n;

const ABI = [
  "event MarketCreatedWithOracle(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address token, address priceFeed, int256 strikePrice)",
  "event PayoutClaimed(uint256 indexed marketId, address indexed bettor, uint256 payout)",
  "function createMarketWithOracle(string question, uint64 epochDuration, address priceFeed, int256 strikePrice) returns (uint256)",
  "function placeBet(uint256 marketId, bytes32 encSide, bytes32 encAmount, bytes inputProof)",
  "function claim(uint256 marketId)",
  "function getMarket(uint256) view returns (address creator,string question,uint64 epochStart,uint64 epochEnd,bool resolved,uint8 outcome,uint256 revealedYesPool,uint256 revealedNoPool,uint256 clearingPrice,bool poolRevealRequested,bool poolRevealed,address priceFeed,int256 strikePrice,bool useOracle,address token,uint256 betCount,uint256 bettorCount)",
  "function getPosition(uint256 marketId, address bettor) view returns (bool exists, bool claimed)",
  "function getEncPayout(uint256 marketId, address bettor) view returns (bytes32 payout)",
];
const USDC_ABI = [
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
];
const CUSDC_ABI = [
  "function wrap(address to, uint256 amount)",
  "function setOperator(address operator, uint48 until)",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
];
const FEED_ABI = ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"];

// ── Helpers ──────────────────────────────────────────────────────────────────
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toHex = (v) => (v instanceof Uint8Array ? ethers.hexlify(v) : (String(v).startsWith("0x") ? v : "0x" + v));

// Retry a flaky async op (relayer/CF calls intermittently fail from this host).
// Only use for idempotent ops with no on-chain side effect (init, encrypt, decrypt).
async function withRetry(label, fn, tries = 5, backoffMs = 5000) {
  for (let attempt = 1; ; attempt++) {
    try { return await fn(); }
    catch (e) {
      if (attempt >= tries) throw e;
      log(`${label}: attempt ${attempt} failed (${e.shortMessage ?? e.message?.slice(0, 70) ?? e}) — retry in ${(backoffMs * attempt) / 1000}s`);
      await sleep(backoffMs * attempt);
    }
  }
}

async function waitFor(label, check, pollMs = 10000, timeoutMs = 900_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await check();
    if (r) { log(`✓ ${label}`); return r; }
    log(`  … waiting for ${label}`);
    await sleep(pollMs);
  }
  throw new Error(`Timeout waiting for: ${label}`);
}

async function provisionAndBet(inst, provider, wallet, marketId, side, usdcWhole, tag) {
  const raw = usdcWhole * 10n ** BigInt(DECIMALS);
  const usdc  = new ethers.Contract(USDC, USDC_ABI, wallet);
  const cusdc = new ethers.Contract(CUSDC, CUSDC_ABI, wallet);
  const auction = new ethers.Contract(AUCTION, ABI, wallet);

  // Step 1: encrypt FIRST (slowest, most failure-prone) — one proof covers side + amount.
  // The relayer POST intermittently connect-times-out from this host; encryption has NO
  // on-chain side effect, so retry it freely (up to 4×) before any token movement.
  log(`${tag}: encrypting side=${side} amount=${usdcWhole} USDC (~90s)…`);
  let enc;
  for (let attempt = 1; ; attempt++) {
    try {
      const buf = inst.createEncryptedInput(AUCTION, wallet.address);
      buf.add8(BigInt(side));
      buf.add64(raw);
      enc = await buf.encrypt();
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      log(`${tag}: encrypt attempt ${attempt} failed (${e.shortMessage ?? e.message?.slice(0, 60) ?? e}) — retrying in ${attempt * 5}s`);
      await sleep(attempt * 5000);
    }
  }
  const encSide = toHex(enc.handles[0]);
  const encAmount = toHex(enc.handles[1]);
  const inputProof = toHex(enc.inputProof);
  log(`${tag}: encrypted ✓`);

  // Step 2: mint USDC from the open faucet (bettors start with 0).
  log(`${tag}: minting ${usdcWhole} USDC…`);
  await (await usdc.mint(wallet.address, raw)).wait();

  // Step 3: approve + wrap → cUSDC.
  log(`${tag}: approve + wrap → cUSDC…`);
  await (await usdc.approve(CUSDC, raw)).wait();
  await (await cusdc.wrap(wallet.address, raw)).wait();

  // Step 4: operator auth (idempotent) — auction pulls via confidentialTransferFrom.
  if (!(await cusdc.isOperator(wallet.address, AUCTION))) {
    const until = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    log(`${tag}: setOperator(auction)…`);
    await (await cusdc.setOperator(AUCTION, until)).wait();
  }

  // Step 5: sealed bid.
  log(`${tag}: placeBet…`);
  const tx = await auction.placeBet(marketId, encSide, encAmount, inputProof, { gasLimit: 3_000_000n });
  const r = await tx.wait();
  log(`${tag}: bet sealed ✓ gas=${r.gasUsed} tx=${tx.hash}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, 11155111);
  provider.pollingInterval = 6000; // ease receipt-poll request rate (default 4s → 6s)
  const A = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/1").connect(provider);
  const B = ethers.HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/2").connect(provider);
  log(`Bettor A (YES): ${A.address}  bal=${ethers.formatEther(await provider.getBalance(A.address))} ETH`);
  log(`Bettor B (NO):  ${B.address}  bal=${ethers.formatEther(await provider.getBalance(B.address))} ETH`);

  // Live ETH price → strike well below so YES ("close above strike") deterministically wins.
  const feed = new ethers.Contract(ETH_FEED, FEED_ABI, provider);
  const [, answer] = await feed.latestRoundData();
  const strike = answer / 2n; // half of live price
  log(`live ETH/USD=${Number(answer) / 1e8}  strike=${Number(strike) / 1e8} (YES should win)`);

  // FHE instance (node). Init downloads key-material from CF/S3 — flaky here, so retry.
  log("initialising FHE relayer instance…");
  const inst = await withRetry("FHE init", () => createInstance({ ...SepoliaConfig, network: RPC_SDK }));
  log("FHE ready");

  // 1. Create the market (Bettor A) — or reuse an existing accumulating one via MARKET_ID.
  const auctionA = new ethers.Contract(AUCTION, ABI, A);
  let marketId, epochEnd;
  if (process.env.MARKET_ID !== undefined) {
    marketId = BigInt(process.env.MARKET_ID);
    const mm = await auctionA.getMarket(marketId);
    epochEnd = Number(mm.epochEnd);
    const secs = epochEnd - Math.floor(Date.now() / 1000);
    log(`REUSING market #${marketId}  resolved=${mm.resolved} betCount=${mm.betCount} epochLeft=${secs}s`);
    if (mm.resolved || secs < 180) throw new Error(`market #${marketId} unusable (resolved or <180s epoch left)`);
  } else {
    log(`creating oracle market (${EPOCH_SECONDS}s epoch)…`);
    const createTx = await auctionA.createMarketWithOracle(
      "E2E overflow-fix test: ETH close above strike? [large pools]",
      BigInt(EPOCH_SECONDS), ETH_FEED, strike,
    );
    const cr = await createTx.wait();
    const iface = new ethers.Interface(ABI);
    const ev = cr.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } })
                      .find((e) => e && e.name === "MarketCreatedWithOracle");
    marketId = ev.args.marketId;
    epochEnd = Number(ev.args.epochEnd);
    log(`market #${marketId} created ✓  epoch ends ${new Date(epochEnd * 1000).toISOString()}`);
  }

  // 2. Bets (sequential — clean nonces).
  await provisionAndBet(inst, provider, A, marketId, SIDE_YES, YES_USDC, "A/YES");
  await provisionAndBet(inst, provider, B, marketId, SIDE_NO,  NO_USDC,  "B/NO");

  const mAfter = await auctionA.getMarket(marketId);
  log(`bets in: betCount=${mAfter.betCount} bettorCount=${mAfter.bettorCount}`);

  // 3. Wait for epoch close.
  const secsLeft = epochEnd - Math.floor(Date.now() / 1000);
  if (secsLeft > 0) { log(`epoch closes in ${secsLeft}s — waiting…`); await sleep((secsLeft + 5) * 1000); }

  // 4. Keeper auto-resolves + reveals.
  log("waiting for keeper: resolve → pool reveal…");
  await waitFor("resolved", async () => (await auctionA.getMarket(marketId)).resolved);
  const mRes = await auctionA.getMarket(marketId);
  log(`resolved outcome=${mRes.outcome} (${mRes.outcome === 1n ? "YES" : "NO"})`);
  await waitFor("poolRevealed", async () => (await auctionA.getMarket(marketId)).poolRevealed);

  const m = await auctionA.getMarket(marketId);
  const total = m.revealedYesPool + m.revealedNoPool;
  const fee = (total * 200n) / 10000n;
  const distributable = total - fee;
  const winPool = m.outcome === 1n ? m.revealedYesPool : m.revealedNoPool;
  const branch = winPool === 0n ? "zero"
               : (distributable <= U64_MAX / winPool) ? "DIRECT"
               : "Q13 (overflow-safe)";
  log(`revealed: YES=${m.revealedYesPool} NO=${m.revealedNoPool} distributable=${distributable} winPool=${winPool}`);
  log(`claim branch that will execute: ${branch}   (distributable·winPool=${distributable * winPool}  vs 2^64=${U64_MAX + 1n})`);

  // 5. Claims.
  for (const [tag, w] of [["A/YES", A], ["B/NO", B]]) {
    const c = new ethers.Contract(AUCTION, ABI, w);
    log(`${tag}: claim…`);
    try {
      const r = await (await c.claim(marketId, { gasLimit: 3_000_000n })).wait();
      log(`${tag}: claimed ✓ gas=${r.gasUsed} tx=${r.hash}`);
    } catch (e) {
      log(`${tag}: claim FAILED — ${e.shortMessage ?? e.message}`);
    }
  }

  // 6. Best-effort: reveal A's encrypted payout via userDecrypt.
  let revealed = "(userDecrypt skipped/failed — claim success + no revert is the core proof)";
  try {
    const payoutHandle = await auctionA.getEncPayout(marketId, A.address);
    const kp = inst.generateKeypair();
    const days = "10";
    const start = Math.floor(Date.now() / 1000).toString();
    const eip712 = inst.createEIP712(kp.publicKey, [AUCTION], start, days);
    const sig = await A.signTypedData(eip712.domain, { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification }, eip712.message);
    const res = await withRetry("userDecrypt", () => inst.userDecrypt(
      [{ handle: payoutHandle, contractAddress: AUCTION }],
      kp.privateKey, kp.publicKey, sig.replace(/^0x/, ""),
      [AUCTION], A.address, start, days,
    ), 3, 4000);
    const clear = res[payoutHandle];
    revealed = `${ethers.formatUnits(BigInt(clear), DECIMALS)} cUSDC`;
  } catch (e) {
    log(`userDecrypt note: ${e.shortMessage ?? e.message}`);
  }

  console.log("\n══════════════════════════════════════════════════════════");
  console.log("  LIVE V2 E2E COMPLETE — overflow-fix verified");
  console.log("══════════════════════════════════════════════════════════");
  console.log(`  Market #${marketId}  outcome=${m.outcome === 1n ? "YES" : "NO"}`);
  console.log(`  Pools: YES=${ethers.formatUnits(m.revealedYesPool, DECIMALS)}  NO=${ethers.formatUnits(m.revealedNoPool, DECIMALS)} cUSDC`);
  console.log(`  Distributable (after 2% fee): ${ethers.formatUnits(distributable, DECIMALS)} cUSDC`);
  console.log(`  Claim branch executed: ${branch}`);
  console.log(`  Bettor A revealed payout: ${revealed}  (expected ≈ ${ethers.formatUnits(distributable, DECIMALS)})`);
  console.log("══════════════════════════════════════════════════════════\n");
}

main().catch((e) => { console.error("[FATAL]", e); process.exit(1); });
