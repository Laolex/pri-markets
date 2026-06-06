import { useReadContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http, parseAbiItem } from "viem";
import { sepolia } from "wagmi/chains";
import { SEPOLIA_RPC } from "@/lib/contracts/config";
import { CUSDC_ABI, CUSDC_DEPLOY_BLOCK } from "@/lib/contracts/cusdc";
import { CUSDC_TOKEN } from "@/types";

const client = createPublicClient({ chain: sepolia, transport: http(SEPOLIA_RPC) });

// publicnode caps getLogs result size, not block range tightly — 50k-block chunks keep each
// response small while bounding the scan to ~17 requests over the wrapper's lifetime.
const CHUNK = 50_000n;

const WRAP_EVENT = parseAbiItem(
  "event Wrap(address indexed to, uint256 roundedAmount, bytes32 encryptedWrappedAmount)"
);
const UNWRAP_FINALIZED_EVENT = parseAbiItem(
  "event UnwrapFinalized(address indexed receiver, bytes32 indexed unwrapRequestId, bytes32 encryptedAmount, uint64 cleartextAmount)"
);

export interface WrapperLifetime {
  wrapped: bigint;    // cumulative USDC wrapped (6 decimals)
  unwrapped: bigint;  // cumulative USDC unwrapped (6 decimals)
  partial: boolean;   // true if any chunk failed and was skipped
}

async function scanRange<T>(
  event: typeof WRAP_EVENT | typeof UNWRAP_FINALIZED_EVENT,
  pick: (args: Record<string, unknown>) => bigint,
): Promise<{ total: bigint; partial: boolean }> {
  const latest = await client.getBlockNumber();
  let total = 0n;
  let partial = false;

  for (let from = CUSDC_DEPLOY_BLOCK; from <= latest; from += CHUNK) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
    try {
      const logs = await client.getLogs({ address: CUSDC_TOKEN as `0x${string}`, event, fromBlock: from, toBlock: to });
      for (const l of logs) total += pick(l.args as Record<string, unknown>);
    } catch {
      // Best-effort: a rate-limited / oversized chunk is skipped and the figure is flagged partial
      // rather than failing the whole strip.
      partial = true;
    }
  }
  return { total, partial };
}

/** Lifetime cumulative wrapped + unwrapped, scanned from the deploy block and cached. */
export function useWrapperLifetime() {
  return useQuery({
    queryKey: ["wrapper-lifetime", CUSDC_TOKEN],
    queryFn: async (): Promise<WrapperLifetime> => {
      const [w, u] = await Promise.all([
        scanRange(WRAP_EVENT, (a) => (a.roundedAmount as bigint) ?? 0n),
        scanRange(UNWRAP_FINALIZED_EVENT, (a) => (a.cleartextAmount as bigint) ?? 0n),
      ]);
      return { wrapped: w.total, unwrapped: u.total, partial: w.partial || u.partial };
    },
    staleTime: 5 * 60_000,    // lifetime totals barely move — scan at most every 5 min
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Net USDC currently locked in the wrapper (cheap single read, refreshed often). */
export function useWrapperNet() {
  return useReadContract({
    address: CUSDC_TOKEN as `0x${string}`,
    abi: CUSDC_ABI,
    functionName: "inferredTotalSupply",
    query: { refetchInterval: 15_000 },
  });
}
