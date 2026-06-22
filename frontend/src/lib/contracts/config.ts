import ABI_JSON from "./abi.json";
import type { Abi } from "viem";

// ConfidentialBatchAuction V2 (token-only, fee+treasury, overflow-safe claim) — Sepolia, redeployed 2026-06-10
export const CONTRACT_ADDRESS =
  "0xc9E6798c8f25E288e6d578B180AD0F5Fe7Dea935" as const;

export const CONTRACT_ABI = ABI_JSON as unknown as Abi;

export const CHAIN_ID = 11155111; // Sepolia

// Reliable Sepolia RPC for reads/multicall. viem/RainbowKit default to a public endpoint that
// is rate-limited and fails the market-list multicall (→ empty list). publicnode is free,
// keyless, and serves Multicall3. Override with VITE_SEPOLIA_RPC_URL for a dedicated provider.
export const SEPOLIA_RPC =
  (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined)?.trim() ||
  "https://ethereum-sepolia-rpc.publicnode.com";
