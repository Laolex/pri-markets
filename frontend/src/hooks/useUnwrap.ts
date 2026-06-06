import { useState } from "react";
import { parseUnits, parseEventLogs } from "viem";
import { useWriteContract, useAccount, usePublicClient } from "wagmi";
import { encryptAmount } from "@/lib/fhe/encrypt";
import { useAppStore } from "@/store/appStore";
import { CUSDC_ABI } from "@/lib/contracts/cusdc";
import { CUSDC_TOKEN, USDC_DECIMALS } from "@/types";

/**
 * Unwrap cUSDC → USDC — the ERC-7984 wrapper's two-phase, gateway-mediated withdrawal.
 *
 *   Phase 1  unwrap(from, to, encAmount, proof)  burns the encrypted amount and emits
 *            UnwrapRequested(requestId). The requestId IS the burned euint64 handle, which
 *            the contract makes publicly decryptable.
 *   Phase 2  publicDecrypt([requestId]) → KMS cleartext + proof, then
 *            finalizeUnwrap(requestId, cleartext, proof) verifies the signatures and releases
 *            the underlying USDC to `to`.
 *
 * Both txs are signed/paid by the user. from == to == user, so no operator authorization is
 * needed. This mirrors the pool-reveal publicDecrypt flow already used for settlement.
 */
export function useUnwrap() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { fhevmInst, setTxStatus } = useAppStore();
  const { writeContractAsync } = useWriteContract();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unwrap(amountUsdc: string) {
    if (!fhevmInst) throw new Error("FHE relayer not initialized");
    if (!address) throw new Error("Wallet not connected");
    if (!publicClient) throw new Error("RPC client unavailable");

    setIsPending(true);
    setError(null);
    try {
      const rawAmount = parseUnits(amountUsdc, USDC_DECIMALS);
      if (rawAmount <= 0n) throw new Error("Enter an amount greater than 0");

      const mine = (hash: `0x${string}`) => publicClient.waitForTransactionReceipt({ hash });

      // ── Phase 1: encrypt the amount and submit the burn ──────────────────
      setTxStatus("Encrypting unwrap amount…");
      const { encAmount, inputProof } = await Promise.race([
        encryptAmount(fhevmInst, CUSDC_TOKEN, address, rawAmount),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("Encryption timed out — reload the page and retry")), 60_000)
        ),
      ]);

      setTxStatus("Phase 1 — requesting unwrap (burning cUSDC)…");
      const reqHash = await writeContractAsync({
        address: CUSDC_TOKEN as `0x${string}`,
        abi: CUSDC_ABI,
        functionName: "unwrap",
        args: [address, address, encAmount, inputProof],
      });
      const receipt = await mine(reqHash);

      // The requestId is the burned ciphertext handle, emitted (indexed) in UnwrapRequested.
      const logs = parseEventLogs({
        abi: CUSDC_ABI,
        eventName: "UnwrapRequested",
        logs: receipt.logs,
      });
      const requestId = logs[0]?.args?.unwrapRequestId as `0x${string}` | undefined;
      if (!requestId) throw new Error("Unwrap request id not found in receipt");

      // ── Phase 2: public-decrypt the burned amount, then finalize ─────────
      setTxStatus("Phase 2 — waiting for KMS decryption…");
      const result = await fhevmInst.publicDecrypt([requestId]);
      const cleartext = result.clearValues[requestId] as bigint;

      setTxStatus("Phase 2 — finalizing withdrawal (releasing USDC)…");
      const finalizeHash = await writeContractAsync({
        address: CUSDC_TOKEN as `0x${string}`,
        abi: CUSDC_ABI,
        functionName: "finalizeUnwrap",
        args: [requestId, cleartext, result.decryptionProof as `0x${string}`],
      });
      await mine(finalizeHash);

      setTxStatus(`Unwrapped ${amountUsdc} cUSDC → USDC ✓`);
      return finalizeHash;
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

  return { unwrap, isPending, error };
}
