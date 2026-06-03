import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount, usePublicClient, useSignTypedData } from "wagmi";
import { useAppStore } from "@/store/appStore";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";
import { USDC_DECIMALS } from "@/types";

// A zeroed handle means the contract never allowed a payout to this address (no winning stake).
const ZERO_HANDLE = "0x0000000000000000000000000000000000000000000000000000000000000000";

/**
 * Lets a winner privately decrypt their own claimed payout via the relayer's userDecrypt flow.
 *
 * The payout euint64 is computed inside `claim()` and `FHE.allow`-ed to the bettor, so only they
 * (with an EIP-712-signed ephemeral keypair) can read it. The amount is never written to plaintext
 * storage and never exposed to anyone else — this is a client-side reveal of the user's own value.
 */
export function useRevealPayout(marketId: number) {
  const { fhevmInst } = useAppStore();
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();

  const [payout, setPayout] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revealPayout() {
    if (!fhevmInst) throw new Error("FHE relayer not initialized");
    if (!address) throw new Error("Wallet not connected");
    if (!publicClient) throw new Error("RPC client unavailable");

    setIsPending(true);
    setError(null);
    try {
      // 1. Read the encrypted-payout handle the contract allowed to this address.
      const handle = (await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "getEncPayout",
        args: [BigInt(marketId), address],
      })) as `0x${string}`;

      if (!handle || handle === ZERO_HANDLE) {
        setPayout("0");
        return "0";
      }

      // 2. Ephemeral keypair + EIP-712 grant, signed by the user's wallet.
      const keypair = fhevmInst.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = "1";
      const contracts = [CONTRACT_ADDRESS];
      const eip712 = fhevmInst.createEIP712(keypair.publicKey, contracts, Number(startTimestamp), Number(durationDays));

      // viem derives EIP712Domain from `domain`; strip it from `types` to avoid a duplicate.
      const { EIP712Domain: _omit, ...types } = eip712.types as Record<string, unknown>;
      void _omit;
      const signature = await signTypedDataAsync({
        domain: eip712.domain,
        types,
        primaryType: "UserDecryptRequestVerification",
        message: eip712.message,
      } as Parameters<typeof signTypedDataAsync>[0]);

      // 3. Relayer userDecrypt — returns the cleartext keyed by handle.
      const result = await fhevmInst.userDecrypt(
        [{ handle, contractAddress: CONTRACT_ADDRESS }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace(/^0x/, ""),
        contracts,
        address,
        Number(startTimestamp),
        Number(durationDays),
      );

      const raw = result[handle] as bigint;
      const human = formatUnits(raw, USDC_DECIMALS);
      setPayout(human);
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

  return { revealPayout, payout, isPending, error };
}
