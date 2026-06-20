import { useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { useWriteContract, useAccount, usePublicClient } from "wagmi";
import { useAppStore } from "@/store/appStore";
import { getErrMsg } from "@/lib/errors";
import { USDC_TOKEN, USDC_DECIMALS } from "@/types";

// USDCMock on Sepolia exposes an open mint(address,uint256) + balanceOf — a public test faucet.
const USDC_FAUCET_ABI = [
  {
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    name: "mint",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const FAUCET_AMOUNT = "1000"; // mint 1,000 USDCMock per click

export function useMintUsdc() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { setTxStatus } = useAppStore();
  const { writeContractAsync } = useWriteContract();
  const [isPending, setIsPending] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refreshBalance(): Promise<string | null> {
    if (!address || !publicClient) return null;
    const raw = (await publicClient.readContract({
      address: USDC_TOKEN as `0x${string}`,
      abi: USDC_FAUCET_ABI,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    const human = formatUnits(raw, USDC_DECIMALS);
    setBalance(human);
    return human;
  }

  async function mintUsdc() {
    if (!address) throw new Error("Wallet not connected");
    setIsPending(true);
    setError(null);
    try {
      setTxStatus(`Minting ${FAUCET_AMOUNT} test USDC…`);
      const hash = await writeContractAsync({
        address: USDC_TOKEN as `0x${string}`,
        abi: USDC_FAUCET_ABI,
        functionName: "mint",
        args: [address, parseUnits(FAUCET_AMOUNT, USDC_DECIMALS)],
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      setTxStatus(`Minted ${FAUCET_AMOUNT} test USDC ✓`);
      await refreshBalance();
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

  return { mintUsdc, refreshBalance, balance, isPending, error, faucetAmount: FAUCET_AMOUNT };
}
