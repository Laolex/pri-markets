import ABI_JSON from "./abi.json";
import type { Abi } from "viem";

export const CONTRACT_ADDRESS =
  "0x06F2f1B8B5e41575a17A7EFB91Ce4d4561FF5Ae3" as const;

export const CONTRACT_ABI = ABI_JSON as unknown as Abi;

export const CHAIN_ID = 11155111; // Sepolia
