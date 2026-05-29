import { useReadContract } from "wagmi";

const AGGREGATOR_ABI = [
  {
    inputs: [],
    name: "latestRoundData",
    outputs: [
      { name: "roundId",        type: "uint80"  },
      { name: "answer",         type: "int256"  },
      { name: "startedAt",      type: "uint256" },
      { name: "updatedAt",      type: "uint256" },
      { name: "answeredInRound",type: "uint80"  },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

export interface OraclePriceData {
  price: bigint;
  updatedAt: bigint;
  ageSeconds: number;
  isStale: boolean;
}

export function useOraclePrice(feedAddress?: string) {
  const enabled =
    !!feedAddress &&
    feedAddress !== "0x0000000000000000000000000000000000000000";

  const result = useReadContract({
    address: feedAddress as `0x${string}`,
    abi: AGGREGATOR_ABI,
    functionName: "latestRoundData",
    query: {
      enabled,
      refetchInterval: 30_000,
      select: (data): OraclePriceData => {
        const [, answer, , updatedAt] = data as [bigint, bigint, bigint, bigint, bigint];
        const ageSeconds = Math.floor(Date.now() / 1000) - Number(updatedAt);
        return {
          price:      answer,
          updatedAt,
          ageSeconds,
          isStale:    ageSeconds > 3600,
        };
      },
    },
  });

  return result;
}
