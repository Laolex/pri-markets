import {
  initSDK,
  createInstance,
  SepoliaConfig,
  type FhevmInstance,
} from "@zama-fhe/relayer-sdk/web";
import { bytesToHex } from "viem";

export async function initFheInstance(
  userAddress: string
): Promise<FhevmInstance> {
  const eth = (window as Window & { ethereum?: unknown }).ethereum;
  if (!eth) throw new Error("No Ethereum provider found");

  await initSDK();

  const relayerUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/zama-relay`
      : undefined;

  try {
    const inst = (await Promise.race([
      createInstance({ ...SepoliaConfig, network: eth, ...(relayerUrl ? { relayerUrl } : {}) }),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("FHE init timeout")), 60_000)
      ),
    ])) as FhevmInstance;
    return inst;
  } catch {
    // Fallback without relayer
    return createInstance({ ...SepoliaConfig, network: eth }) as Promise<FhevmInstance>;
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

/// Encrypts a single uint64 amount (e.g. for the unwrap burn input).
/// Returns handles[0]=amount and its inputProof.
export async function encryptAmount(
  fhevmInst: FhevmInstance,
  contractAddress: string,
  userAddress: string,
  amountRaw: bigint
): Promise<{ encAmount: `0x${string}`; inputProof: `0x${string}` }> {
  const buf = fhevmInst.createEncryptedInput(contractAddress, userAddress);
  buf.add64(amountRaw);
  const enc = await buf.encrypt();
  return {
    encAmount:  toHex(enc.handles[0]),
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
