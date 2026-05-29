import ABI_JSON from "./abi.json";
import type { Abi } from "viem";

export const CONTRACT_ADDRESS =
  "0xC4c7ee422ca2Df0C5bFb2829fbd01c8649f681B5" as const;

export const CONTRACT_ABI = ABI_JSON as unknown as Abi;

export const CHAIN_ID = 11155111; // Sepolia
