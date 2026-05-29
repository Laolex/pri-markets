import { useState } from "react";
import { parseUnits } from "viem";
import { useWriteContract, useAccount } from "wagmi";
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

// cUSDC depositFor — wraps USDC into cUSDC
const CUSDC_ABI = [
  {
    inputs: [{ name: "account", type: "address" }, { name: "amount", type: "uint256" }],
    name: "depositFor",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export function usePlaceBetToken() {
  const { address } = useAccount();
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

      // Step 3: Encrypt side + amount in one proof batch
      setTxStatus("Encrypting side and amount…");
      const { encSide, encAmount, inputProof } = await encryptSideAndAmount(
        fhevmInst,
        CONTRACT_ADDRESS,
        address,
        side,
        rawAmount
      );

      // Step 4: Place sealed token bet
      setTxStatus("Submitting sealed token bid…");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "placeBetToken",
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
