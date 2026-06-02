/**
 * settle-market.ts — one-shot back-half settlement for a single market.
 *
 *   resolveByOracle(id) -> requestPoolReveal(id) -> publicDecrypt(handles) -> onPoolRevealed(id)
 *
 * After this, the YES/NO pools are revealed on-chain and bettors can claim from the UI.
 *
 * Usage:
 *   SEPOLIA_RPC_URL=… KEEPER_PRIVATE_KEY=… npx ts-node --esm src/settle-market.ts <marketId>
 */
import { ethers } from "ethers";
import { ABI, CONTRACT_ADDRESS } from "./abi.js";
import { publicDecrypt } from "./zama.js";

const SETTLE_ABI = [
  ...ABI,
  "function requestPoolReveal(uint256 marketId) external",
];

function need(k: string): string {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

async function main() {
  const id = Number(process.argv[2]);
  if (Number.isNaN(id)) throw new Error("Usage: settle-market.ts <marketId>");

  const provider = new ethers.JsonRpcProvider(need("SEPOLIA_RPC_URL"), 11155111);
  const wallet   = new ethers.Wallet(need("KEEPER_PRIVATE_KEY"), provider);
  const c        = new ethers.Contract(CONTRACT_ADDRESS, SETTLE_ABI, wallet);

  const log = (m: string) => console.log(`[settle ${id}] ${m}`);
  log(`signer ${wallet.address}`);

  let m = await c.getMarket(id);
  const now = Math.floor(Date.now() / 1000);
  if (Number(m.epochEnd) > now) throw new Error(`epoch not closed (closes in ${Math.round((Number(m.epochEnd)-now)/60)} min)`);

  // 1) resolve
  if (!m.resolved) {
    log("resolveByOracle…");
    await (await c.resolveByOracle(id)).wait();
    m = await c.getMarket(id);
  }
  log(`resolved=${m.resolved} outcome=${Number(m.outcome)} (1=YES,2=NO)`);

  // 2) request pool reveal (makes YES/NO pools publicly decryptable, emits PoolRevealRequested)
  if (!m.poolRevealRequested) {
    log("requestPoolReveal…");
    const tx = await c.requestPoolReveal(id);
    await tx.wait();
  }

  if (m.poolRevealed) { log("already revealed ✓"); return; }

  // 3) read the two handles from the PoolRevealRequested event
  const filt = c.filters.PoolRevealRequested(id);
  const logs = await c.queryFilter(filt, -5000);
  if (!logs.length) throw new Error("no PoolRevealRequested event found");
  const handles: string[] = Array.from((logs[logs.length - 1] as ethers.EventLog).args.handles as string[]);
  log(`handles ${handles.join(", ")}`);

  // 4) decrypt via relayer + submit callback
  log("publicDecrypt via relayer…");
  const { abiEncodedClearValues, decryptionProof } = await publicDecrypt(handles);
  log("onPoolRevealed…");
  await (await c.onPoolRevealed(id, handles, abiEncodedClearValues, decryptionProof)).wait();

  const f = await c.getMarket(id);
  log(`DONE ✓ poolRevealed=${f.poolRevealed} yesPool=${f.revealedYesPool} noPool=${f.revealedNoPool}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
