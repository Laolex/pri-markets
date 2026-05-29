import { useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";
import { sepolia } from "wagmi/chains";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";
import { type MarketView, computeEpochStatus } from "@/types";

const publicClient = createPublicClient({ chain: sepolia, transport: http() });

function parseMarket(id: number, raw: readonly unknown[]): MarketView {
  const [
    creator, question, epochStart, epochEnd, resolved, outcome, totalEth,
    revealedYesPool, revealedNoPool, clearingPrice, poolRevealRequested, poolRevealed,
    priceFeed, strikePrice, useOracle,
    isTokenMarket, token, participantCount,
  ] = raw as [
    string, string, bigint, bigint, boolean, number, bigint,
    bigint, bigint, bigint, boolean, boolean,
    string, bigint, boolean,
    boolean, string, bigint,
  ];
  const m: MarketView = {
    id,
    creator,
    question,
    epochStart: Number(epochStart),
    epochEnd: Number(epochEnd),
    resolved,
    outcome: Number(outcome),
    totalEth,
    clearingPrice,
    revealedYesPool,
    revealedNoPool,
    poolRevealRequested,
    poolRevealed,
    priceFeed:        priceFeed       ?? "0x0000000000000000000000000000000000000000",
    strikePrice:      strikePrice     ?? 0n,
    useOracle:        useOracle       ?? false,
    isTokenMarket:    isTokenMarket   ?? false,
    token:            token           ?? "0x0000000000000000000000000000000000000000",
    participantCount: participantCount ?? 0n,
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
        const [amount, payoutRequested, claimed, isToken] = data as [bigint, boolean, boolean, boolean];
        return (amount > 0n || isToken) ? { amount, payoutRequested, claimed, isToken } : null;
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

export function useEncPayout(marketId: number, address?: string) {
  return useReadContract({
    address: CONTRACT_ADDRESS,
    abi: CONTRACT_ABI,
    functionName: "getEncPayout",
    args: [BigInt(marketId), (address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`],
    query: { enabled: !!address },
  });
}
