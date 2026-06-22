import { useState } from "react";
import { useWriteContract } from "wagmi";
import { useAppStore } from "@/store/appStore";
import { getErrMsg } from "@/lib/errors";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";

export function useClaimToken(marketId: number) {
  const { setTxStatus } = useAppStore();
  const { writeContractAsync } = useWriteContract();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claimToken() {
    setIsPending(true);
    setError(null);
    try {
      setTxStatus("Computing encrypted payout + transferring cUSDC…");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "claim",
        args: [BigInt(marketId)],
      });
      setTxStatus(`Token settlement complete: ${hash.slice(0, 10)}…`);
      return hash;
    } catch (e: unknown) {
      const msg = getErrMsg(e);
      setError(msg);
      setTxStatus("Error: " + msg);
      throw e;
    } finally {
      setIsPending(false);
    }
  }

  return { claimToken, isPending, error };
}
