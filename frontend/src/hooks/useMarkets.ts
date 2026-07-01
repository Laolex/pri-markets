import { useReadContract } from "wagmi";
import { getPublicClient } from "@wagmi/core";
import { useQuery } from "@tanstack/react-query";
import { sepolia } from "wagmi/chains";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";
import { wagmiConfig } from "@/lib/wagmi/config";
import { type MarketView, computeEpochStatus } from "@/types";

// Single source of RPC truth: derive the read client from the wagmi config (already
// pointed at SEPOLIA_RPC with Multicall3) instead of standing up a second viem client.
const publicClient = getPublicClient(wagmiConfig, { chainId: sepolia.id });

/** Decode a raw getMarket() tuple into a MarketView. Exported so MarketDetail reuses
 *  the exact same mapping instead of duplicating (and drifting from) it. */
export function parseMarket(id: number, raw: readonly unknown[]): MarketView {
  const [
    creator, question, epochStart, epochEnd, resolved, outcome,
    revealedYesPool, revealedNoPool, clearingPrice, poolRevealRequested, poolRevealed,
    priceFeed, strikePrice, useOracle,
    token, betCount, bettorCount,
  ] = raw as [
    string, string, bigint, bigint, boolean, number,
    bigint, bigint, bigint, boolean, boolean,
    string, bigint, boolean,
    string, bigint, bigint,
  ];
  const m: MarketView = {
    id,
    creator,
    question,
    epochStart: Number(epochStart),
    epochEnd: Number(epochEnd),
    resolved,
    outcome: Number(outcome),
    clearingPrice,
    revealedYesPool,
    revealedNoPool,
    poolRevealRequested,
    poolRevealed,
    priceFeed:   priceFeed   ?? "0x0000000000000000000000000000000000000000",
    strikePrice: strikePrice ?? 0n,
    useOracle:   useOracle    ?? false,
    token:       token        ?? "0x0000000000000000000000000000000000000000",
    betCount:    betCount     ?? 0n,
    bettorCount: bettorCount  ?? 0n,
    epochStatus: "accumulating",
  };
  m.epochStatus = computeEpochStatus(m);
  return m;
}

export function useMarketCount() {
  return useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "marketCount",
  });
}

export function useMarket(id: number) {
  return useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getMarket",
    args: [BigInt(id)],
    query: { refetchInterval: 5_000 },
  });
}

export function useMarkets() {
  const { data: count } = useMarketCount();
  const n = count ? Number(count) : 0;

  return useQuery({
    queryKey: ["markets", n],
    queryFn: async (): Promise<MarketView[]> => {
      if (n === 0) return [];

      const calls = Array.from({ length: n }, (_, i) => ({
        address: CONTRACT_ADDRESS as `0x${string}`,
        abi: CONTRACT_ABI,
        functionName: "getMarket" as const,
        args: [BigInt(i)] as const,
      }));

      const results = await publicClient.multicall({ contracts: calls });
      return results
        .map((r, i) => (r.status === "success" ? parseMarket(i, r.result as readonly unknown[]) : null))
        .filter(Boolean) as MarketView[];
    },
    enabled: n > 0,
    refetchInterval: 6_000,
  });
}

export function usePosition(marketId: number, address?: string) {
  return useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getPosition",
    args: [BigInt(marketId), (address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`],
    query: {
      enabled: !!address,
      refetchInterval: 5_000,
      select: (data) => {
        const [exists, claimed] = data as [boolean, boolean];
        return exists ? { exists, claimed } : null;
      },
    },
  });
}

export function useEncPools(marketId: number) {
  return useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getEncPools",
    args: [BigInt(marketId)],
  });
}
