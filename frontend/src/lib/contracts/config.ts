import ABI_JSON from "./abi.json";
import type { Abi } from "viem";

// ConfidentialBatchAuction V2 (token-only) — Sepolia, deployed 2026-06-02
export const CONTRACT_ADDRESS =
  "0x68D2E94D5A94C542ea0741A8F38a957A436df2c6" as const;

export const CONTRACT_ABI = ABI_JSON as unknown as Abi;

export const CHAIN_ID = 11155111; // Sepolia
