// Type-only import is erased at build time — it carries no bundle weight. The actual
// SDK (WASM + crypto, the heaviest dependency) is dynamically imported inside
// initFheInstance so it lands in its own chunk and stays out of the initial page load.
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/web";
import { bytesToHex } from "viem";

// Reject `p` if it doesn't settle within `ms` — so a hung relayer surfaces an error
// instead of freezing the flow forever.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(label)), ms)),
  ]);
}

export async function initFheInstance(): Promise<FhevmInstance> {
  const eth = (window as Window & { ethereum?: unknown }).ethereum;
  if (!eth) throw new Error("No Ethereum provider found");

  // Lazy-load the SDK on first use (code-split — see note above).
  const { initSDK, createInstance, SepoliaConfig } = await import("@zama-fhe/relayer-sdk/web");
  await initSDK();

  const relayerUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/zama-relay`
      : undefined;

  try {
    return await withTimeout(
      createInstance({ ...SepoliaConfig, network: eth, ...(relayerUrl ? { relayerUrl } : {}) }),
      60_000,
      "FHE init timeout",
    );
  } catch {
    // Fallback to the SDK's default relayer — also timeout-guarded so it can't hang.
    return withTimeout(
      createInstance({ ...SepoliaConfig, network: eth }),
      60_000,
      "FHE init timeout (fallback)",
    );
  }
}

const toHex = (v: unknown): `0x${string}` => {
  if (typeof v === "string") return v.startsWith("0x") ? (v as `0x${string}`) : `0x${v}`;
  if (v instanceof Uint8Array) return bytesToHex(v);
  throw new Error(`FHE encrypt: unexpected type ${typeof v}`);
};

export async function encryptSide(
  fhevmInst: FhevmInstance,
  contractAddress: string,
  userAddress: string,
  side: number
): Promise<{ handle: `0x${string}`; inputProof: `0x${string}` }> {
  const buf = fhevmInst.createEncryptedInput(contractAddress, userAddress);
  buf.add8(BigInt(side));
  const enc = await buf.encrypt();
  return {
    handle:     toHex(enc.handles[0]),
    inputProof: toHex(enc.inputProof),
  };
}

/// Encrypts both side (uint8) and amount (uint64) in one proof batch.
/// Returns handles[0]=side, handles[1]=amount, shared inputProof.
export async function encryptSideAndAmount(
  fhevmInst: FhevmInstance,
  contractAddress: string,
  userAddress: string,
  side: number,
  amountRaw: bigint  // raw token units (e.g. 1 USDC = 1_000_000n for 6 decimals)
): Promise<{
  encSide:    `0x${string}`;
  encAmount:  `0x${string}`;
  inputProof: `0x${string}`;
}> {
  const buf = fhevmInst.createEncryptedInput(contractAddress, userAddress);
  buf.add8(BigInt(side));
  buf.add64(amountRaw);
  const enc = await buf.encrypt();
  return {
    encSide:    toHex(enc.handles[0]),
    encAmount:  toHex(enc.handles[1]),
    inputProof: toHex(enc.inputProof),
  };
}
