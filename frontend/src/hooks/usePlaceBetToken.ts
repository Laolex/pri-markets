import { useState } from "react";
import { parseUnits } from "viem";
import { useWriteContract, useAccount, usePublicClient } from "wagmi";
import { encryptSideAndAmount } from "@/lib/fhe/encrypt";
import { useAppStore } from "@/store/appStore";
import { getErrMsg } from "@/lib/errors";
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

// cUSDC (ERC-7984 ERC20-wrapper) — wrap(to, amount) mints the encrypted balance from the
// approved underlying; setOperator authorizes the auction to pull funds. The auction's placeBet
// calls confidentialTransferFrom(bettor, auction, amt), which ERC-7984 only permits from an
// approved operator — there is no ERC-20-style allowance fallback. (This is the same wrap entry-
// point the VeilX wrapper engine uses; the wrapper has no depositFor.)
const CUSDC_ABI = [
  {
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    name: "wrap",
    outputs: [],
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

      // Mine each tx before the next: the steps depend on each other (allowance → wrap →
      // operator → transferFrom). Firing them back-to-back without waiting races the wallet
      // nonce and can hang the UI after the first confirmation.
      const mine = async (hash: `0x${string}`) => {
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
      };

      // Step 1: Encrypt FIRST. The relayer round-trip is the slowest, most failure-prone step;
      // doing it before any token movement means a relayer hang/error can never strand wrapped
      // cUSDC. Guarded by a timeout so a stuck relayer surfaces an error instead of freezing.
      setTxStatus("Encrypting side and amount…");
      const { encSide, encAmount, inputProof } = await Promise.race([
        encryptSideAndAmount(fhevmInst, CONTRACT_ADDRESS, address, side, rawAmount),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("Encryption timed out — reload the page and retry")), 60_000)
        ),
      ]);

      // Step 2: Approve USDC for the wrapper (wait for the allowance to mine).
      setTxStatus("Approving USDC for wrapping…");
      await mine(await writeContractAsync({
        address: usdcAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [cusdcAddress, rawAmount],
      }));

      // Step 3: Wrap USDC → cUSDC (mints the encrypted balance; wait so placeBet sees it).
      setTxStatus("Wrapping USDC → cUSDC…");
      await mine(await writeContractAsync({
        address: cusdcAddress,
        abi: CUSDC_ABI,
        functionName: "wrap",
        args: [address, rawAmount],
      }));

      // Step 4: Authorize the auction as a cUSDC operator (idempotent — skip if already set).
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
        await mine(await writeContractAsync({
          address: cusdcAddress,
          abi: CUSDC_ABI,
          functionName: "setOperator",
          args: [CONTRACT_ADDRESS as `0x${string}`, until],
        }));
      }

      // Step 5: Place the sealed bet, and WAIT for it to mine so the post-bet refetch reads the
      // landed position/betCount (otherwise the UI looks like the bet never registered).
      setTxStatus("Submitting sealed bid…");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "placeBet",
        args: [BigInt(marketId), encSide, encAmount, inputProof],
      });
      await mine(hash);

      setTxStatus(`Bid sealed ✓ ${hash.slice(0, 10)}…`);
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

  return { placeBetToken, isPending, error };
}
