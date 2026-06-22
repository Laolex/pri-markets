import { useState } from "react";
import { useWriteContract, usePublicClient } from "wagmi";
import { useAppStore } from "@/store/appStore";
import { useEncPools } from "@/hooks/useMarkets";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";
import { getErrMsg } from "@/lib/errors";

export function useRevealPools(marketId: number) {
  const { fhevmInst, setTxStatus } = useAppStore();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { refetch: refetchPools } = useEncPools(marketId);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revealPools(alreadyRequested: boolean) {
    if (!fhevmInst) throw new Error("FHE relayer not initialized");

    setIsPending(true);
    setError(null);
    try {
      if (!alreadyRequested) {
        setTxStatus("Requesting pool reveal…");
        const reqHash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "requestPoolReveal",
          args: [BigInt(marketId)],
        });
        // MUST mine before publicDecrypt: requestPoolReveal is what marks the pool
        // handles publicly-decryptable in the on-chain ACL. If we decrypt before the tx
        // confirms, the KMS sees no grant and the reveal races/fails.
        setTxStatus("Confirming reveal request…");
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash: reqHash });
      }

      const { data: freshPools } = await refetchPools();
      const pools = freshPools as [string, string] | undefined;
      if (!pools) throw new Error("Pool handles not available");

      const [yesHandle, noHandle] = pools;
      setTxStatus("Requesting KMS signatures…");
      const result = await fhevmInst.publicDecrypt([yesHandle, noHandle]);

      setTxStatus("Submitting decryption proof…");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "onPoolRevealed",
        args: [
          BigInt(marketId),
          [yesHandle, noHandle] as [`0x${string}`, `0x${string}`],
          result.abiEncodedClearValues as `0x${string}`,
          result.decryptionProof as `0x${string}`,
        ],
      });

      setTxStatus(`Pools revealed: ${hash.slice(0, 10)}…`);
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

  return { revealPools, isPending, error };
}
