// ── Token ABIs for the wrap/unwrap dashboard ────────────────────────────────
//
// cUSDC on Sepolia (0x7c5B…3639) is an ERC-1967 proxy → impl ConfidentialWrapperV3,
// Zama's upgraded ERC-7984 ERC-20 wrapper. rate() == 1 and both tokens are 6-decimals,
// so wrap/unwrap are exactly 1:1 with no rounding loss.
//
// Verified against the live impl (0x390a…d0ee) via Sourcify. Only the entries the
// dashboard needs are included.

import type { Abi } from "viem";

// Underlying USDC mock — plain ERC-20 with an open mint() faucet.
export const USDC_ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const satisfies Abi;

// cUSDC ERC-7984 wrapper — the subset used for balance reveal + wrap + two-phase unwrap.
export const CUSDC_ABI = [
  // Encrypted balance handle (euint64) — userDecrypt to reveal.
  {
    inputs: [{ name: "account", type: "address" }],
    name: "confidentialBalanceOf",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
    type: "function",
  },
  // Wrap: pull `amount` underlying (after approve) and mint encrypted balance to `to`.
  {
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    name: "wrap",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Unwrap phase 1: burn an encrypted amount; emits UnwrapRequested(requestId == burned handle).
  {
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "encryptedAmount", type: "bytes32" }, // externalEuint64
      { name: "inputProof", type: "bytes" },
    ],
    name: "unwrap",
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Unwrap phase 2: submit the publicly-decrypted amount + KMS proof; releases USDC.
  {
    inputs: [
      { name: "unwrapRequestId", type: "bytes32" },
      { name: "unwrapAmountCleartext", type: "uint64" },
      { name: "decryptionProof", type: "bytes" },
    ],
    name: "finalizeUnwrap",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // Owner deny-list — cheap pre-flight so a blocked wallet gets a clear message, not a revert.
  {
    inputs: [{ name: "user", type: "address" }],
    name: "isBlocked",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "underlying",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  // Net USDC currently locked in the wrapper = cumulative wrapped − unwrapped. One cheap read.
  {
    inputs: [],
    name: "inferredTotalSupply",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  // Events (for parsing the unwrap request id out of the receipt, and lifetime stat scans).
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "receiver", type: "address" },
      { indexed: true, name: "unwrapRequestId", type: "bytes32" },
      { indexed: false, name: "amount", type: "bytes32" },
    ],
    name: "UnwrapRequested",
    type: "event",
  },
  // wrap() → roundedAmount is the USDC wrapped (6 decimals). Sum over history = lifetime wrapped.
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "roundedAmount", type: "uint256" },
      { indexed: false, name: "encryptedWrappedAmount", type: "bytes32" },
    ],
    name: "Wrap",
    type: "event",
  },
  // finalizeUnwrap() → cleartextAmount is the USDC released (rate == 1). Sum = lifetime unwrapped.
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "receiver", type: "address" },
      { indexed: true, name: "unwrapRequestId", type: "bytes32" },
      { indexed: false, name: "encryptedAmount", type: "bytes32" },
      { indexed: false, name: "cleartextAmount", type: "uint64" },
    ],
    name: "UnwrapFinalized",
    type: "event",
  },
] as const satisfies Abi;

// Block the cUSDC proxy was deployed (creator tx 0x7373…ec86) — lower bound for log scans.
export const CUSDC_DEPLOY_BLOCK = 10162159n;
