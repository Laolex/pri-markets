import { useState } from "react";
import { parseUnits } from "viem";
import { useWriteContract, useAccount, usePublicClient } from "wagmi";
import { encryptSideAndAmount } from "@/lib/fhe/encrypt";
import { useAppStore } from "@/store/appStore";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";
import { USDC_DECIMALS } from "@/types";

// Minimal ERC-20 ABI for USDC approve
const ERC20_ABI = [
  {
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// cUSDC (ERC-7984) — depositFor wraps USDC; setOperator authorizes the auction to pull funds.
// The auction's placeBet calls confidentialTransferFrom(bettor, auction, amt), which ERC-7984
// only permits from an approved operator — there is no ERC-20-style allowance fallback.
const CUSDC_ABI = [
  {
    inputs: [{ name: "account", type: "address" }, { name: "amount", type: "uint256" }],
    name: "depositFor",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "operator", type: "address" }, { name: "until", type: "uint48" }],
    name: "setOperator",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "holder", type: "address" }, { name: "spender", type: "address" }],
    name: "isOperator",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export function usePlaceBetToken() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { fhevmInst, setTxStatus } = useAppStore();
  const { writeContractAsync } = useWriteContract();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function placeBetToken(
    marketId:     number,
    side:         number,
    amountUsdc:   string,   // human-readable USDC (e.g. "10" = 10 USDC)
    usdcAddress:  `0x${string}`,
    cusdcAddress: `0x${string}`
  ) {
    if (!fhevmInst) throw new Error("FHE relayer not initialized");
    if (!address)   throw new Error("Wallet not connected");

    setIsPending(true);
    setError(null);
    try {
      const rawAmount = parseUnits(amountUsdc, USDC_DECIMALS); // 6 decimals

      // Step 1: Approve USDC to be spent by cUSDC wrapper
      setTxStatus("Approving USDC for wrapping…");
      await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [cusdcAddress, rawAmount],
      });

      // Step 2: Wrap USDC → cUSDC (depositFor mints encrypted balance)
      setTxStatus("Wrapping USDC → cUSDC…");
      await writeContractAsync({
        address: cusdcAddress,
        abi: CUSDC_ABI,
        functionName: "depositFor",
        args: [address, rawAmount],
      });

      // Step 2b: Authorize the auction as a cUSDC operator (idempotent — skip if already set).
      // placeBet pulls via confidentialTransferFrom, which ERC-7984 permits only from operators.
      const alreadyOperator = await publicClient?.readContract({
        address: cusdcAddress,
        abi: CUSDC_ABI,
        functionName: "isOperator",
        args: [address, CONTRACT_ADDRESS as `0x${string}`],
      });
      if (!alreadyOperator) {
        setTxStatus("Authorizing auction to settle your bid…");
        const until = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60; // 1 year (uint48 → number)
        await writeContractAsync({
          address: cusdcAddress,
          abi: CUSDC_ABI,
          functionName: "setOperator",
          args: [CONTRACT_ADDRESS as `0x${string}`, until],
        });
      }

      // Step 3: Encrypt side + amount in one proof batch
      setTxStatus("Encrypting side and amount…");
      const { encSide, encAmount, inputProof } = await encryptSideAndAmount(
        fhevmInst,
        CONTRACT_ADDRESS,
        address,
        side,
        rawAmount
      );

      // Step 4: Place sealed bet (V2 token-only `placeBet`; callable repeatedly for top-ups)
      setTxStatus("Submitting sealed bid…");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "placeBet",
        args: [BigInt(marketId), encSide, encAmount, inputProof],
      });

      setTxStatus(`Token bid sealed: ${hash.slice(0, 10)}…`);
      return hash;
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as { message?: string })?.message
        ?? String(e);
      setError(msg);
      setTxStatus("Error: " + msg);
      throw e;
    } finally {
      setIsPending(false);
    }
  }

  return { placeBetToken, isPending, error };
}
