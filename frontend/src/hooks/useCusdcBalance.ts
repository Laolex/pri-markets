import { useState, useCallback } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { useAppStore } from "@/store/appStore";
import { CUSDC_ABI } from "@/lib/contracts/cusdc";
import { CUSDC_TOKEN, USDC_DECIMALS } from "@/types";

const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Reads + privately reveals the caller's encrypted cUSDC balance.
 *
 * The balance is an euint64 handle returned by `confidentialBalanceOf`, FHE.allow-ed to the
 * holder. Revealing it requires an EIP-712-signed ephemeral keypair and a relayer `userDecrypt`
 * round-trip (identical to the payout reveal flow) — the cleartext is visible only to the signer.
 * The handle is re-read fresh on every reveal so it reflects the latest balance after wrap/unwrap.
 */
export function useCusdcBalance() {
  const { fhevmInst } = useAppStore();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();

  const [balance, setBalance] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drop a stale reveal (e.g. after a wrap/unwrap changes the balance).
  const clear = useCallback(() => {
    setBalance(null);
    setError(null);
  }, []);

  async function reveal(): Promise<string | null> {
    if (!fhevmInst) throw new Error("FHE relayer not initialized");
    if (!address) throw new Error("Wallet not connected");
    if (!publicClient) throw new Error("RPC client unavailable");

    setIsPending(true);
    setError(null);
    try {
      const handle = (await publicClient.readContract({
        address: CUSDC_TOKEN as `0x${string}`,
        abi: CUSDC_ABI,
        functionName: "confidentialBalanceOf",
        args: [address],
      })) as `0x${string}`;

      if (!handle || handle === ZERO_HANDLE) {
        setBalance("0");
        return "0";
      }

      const keypair = fhevmInst.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000);
      const durationDays = 1;
      const contracts = [CUSDC_TOKEN];
      const eip712 = fhevmInst.createEIP712(keypair.publicKey, contracts, startTimestamp, durationDays);

      // viem derives EIP712Domain from `domain`; strip it from `types` to avoid a duplicate.
      const { EIP712Domain: _omit, ...types } = eip712.types as Record<string, unknown>;
      void _omit;
      const signature = await signTypedDataAsync({
        domain: eip712.domain,
        types,
        primaryType: "UserDecryptRequestVerification",
        message: eip712.message,
      } as Parameters<typeof signTypedDataAsync>[0]);

      const result = await fhevmInst.userDecrypt(
        [{ handle, contractAddress: CUSDC_TOKEN }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace(/^0x/, ""),
        contracts,
        address,
        startTimestamp,
        durationDays,
      );

      const raw = result[handle] as bigint;
      const human = formatUnits(raw, USDC_DECIMALS);
      setBalance(human);
      return human;
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as { message?: string })?.message
        ?? String(e);
      setError(msg);
      throw e;
    } finally {
      setIsPending(false);
    }
  }

  return { balance, reveal, clear, isPending, error };
}
