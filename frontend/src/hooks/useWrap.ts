import { useState } from "react";
import { parseUnits } from "viem";
import { useWriteContract, useAccount, usePublicClient } from "wagmi";
import { useAppStore } from "@/store/appStore";
import { USDC_ERC20_ABI, CUSDC_ABI } from "@/lib/contracts/cusdc";
import { USDC_TOKEN, CUSDC_TOKEN, USDC_DECIMALS } from "@/types";

/**
 * Wrap USDC → cUSDC (1:1). Two synchronous steps: approve the wrapper for the underlying,
 * then `wrap(to, amount)` which pulls the USDC and mints the encrypted cUSDC balance.
 * Each tx is mined before the next so the approval is visible to wrap and the post-wrap
 * balance refresh reads the landed state.
 */
export function useWrap() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { setTxStatus } = useAppStore();
  const { writeContractAsync } = useWriteContract();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function wrap(amountUsdc: string) {
    if (!address) throw new Error("Wallet not connected");
    setIsPending(true);
    setError(null);
    try {
      const rawAmount = parseUnits(amountUsdc, USDC_DECIMALS);
      if (rawAmount <= 0n) throw new Error("Enter an amount greater than 0");

      const mine = async (hash: `0x${string}`) => {
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      };

      // Skip the approve if the existing allowance already covers this wrap.
      const allowance = (await publicClient?.readContract({
        address: USDC_TOKEN as `0x${string}`,
        abi: USDC_ERC20_ABI,
        functionName: "allowance",
        args: [address, CUSDC_TOKEN as `0x${string}`],
      })) as bigint | undefined;

      if ((allowance ?? 0n) < rawAmount) {
        setTxStatus("Approving USDC for wrapping…");
        await mine(await writeContractAsync({
          address: USDC_TOKEN as `0x${string}`,
          abi: USDC_ERC20_ABI,
          functionName: "approve",
          args: [CUSDC_TOKEN as `0x${string}`, rawAmount],
        }));
      }

      setTxStatus("Wrapping USDC → cUSDC…");
      const hash = await writeContractAsync({
        address: CUSDC_TOKEN as `0x${string}`,
        abi: CUSDC_ABI,
        functionName: "wrap",
        args: [address, rawAmount],
      });
      await mine(hash);

      setTxStatus(`Wrapped ${amountUsdc} USDC → cUSDC ✓`);
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

  return { wrap, isPending, error };
}
