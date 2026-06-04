import {
  createInstance,
  SepoliaConfig,
  type FhevmInstanceConfig,
  type FhevmInstance,
} from "@zama-fhe/relayer-sdk/node";

let _inst: FhevmInstance | null = null;

async function getInstance(): Promise<FhevmInstance> {
  if (!_inst) {
    const rpcUrl = process.env.SEPOLIA_RPC_URL;
    if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL not set");

    const config: FhevmInstanceConfig = {
      ...SepoliaConfig,
      network: rpcUrl,   // string RPC URL works for server-side (no browser wallet needed)
      // The Zama testnet relayer migrated its API under /v2; SepoliaConfig's default points at
      // the deprecated bare endpoints (/keyurl → 404). The SDK appends /keyurl etc. to relayerUrl,
      // so targeting …/v2 yields the live /v2/keyurl route.
      relayerUrl: process.env.ZAMA_RELAYER_URL ?? "https://relayer.testnet.zama.org/v2",
    };
    _inst = await createInstance(config);
  }
  return _inst;
}

export async function publicDecrypt(handles: string[]): Promise<{
  abiEncodedClearValues: string;
  decryptionProof: string;
}> {
  const inst = await getInstance();
  const result = await inst.publicDecrypt(handles);
  return {
    abiEncodedClearValues: result.abiEncodedClearValues,
    decryptionProof: result.decryptionProof,
  };
}
