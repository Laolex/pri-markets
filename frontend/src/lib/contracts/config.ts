import ABI_JSON from "./abi.json";
import type { Abi } from "viem";

export const CONTRACT_ADDRESS =
  "0x234780242f26E891cb3167F396049b104EAF25D0" as const;

export const CONTRACT_ABI = ABI_JSON as unknown as Abi;

export const CHAIN_ID = 11155111; // Sepolia
