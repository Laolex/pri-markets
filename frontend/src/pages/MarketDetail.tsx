import { useParams, Link } from "react-router-dom";
import { useAccount, useWriteContract } from "wagmi";
import { formatEther } from "viem";
import { motion } from "framer-motion";
import { useState } from "react";
import { useMarket, usePosition } from "@/hooks/useMarkets";
import { useQueryClient } from "@tanstack/react-query";
import { MarketStatusBadge } from "@/components/market/MarketStatusBadge";
import { MarketCountdown } from "@/components/market/MarketCountdown";
import { OraclePriceTicker } from "@/components/market/OraclePriceTicker";
import { EpochLifecycle } from "@/components/ui/EpochLifecycle";
import { BetPanel } from "@/components/auction/BetPanel";
import { RevealPanel } from "@/components/auction/RevealPanel";
import { ClaimPanel } from "@/components/auction/ClaimPanel";
import { SettlementPanel } from "@/components/auction/SettlementPanel";
import { Spinner } from "@/components/ui/Spinner";
import { useAppStore } from "@/store/appStore";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";
import { type MarketView, SIDE_YES, SIDE_NO, UNRESOLVED, computeEpochStatus, SEPOLIA_FEEDS, fromFeedUnits } from "@/types";

function fmtEth(wei: bigint) {
  return Number(formatEther(wei)).toFixed(4);
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function OracleResolvePanel({ market, onSuccess }: { market: MarketView; onSuccess: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const { setTxStatus } = useAppStore();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!market.useOracle || market.resolved || market.epochStatus !== "closed") return null;

  const feed = SEPOLIA_FEEDS.find(
    (f) => f.address.toLowerCase() === market.priceFeed.toLowerCase()
  );

  async function resolve() {
    setIsPending(true);
    setError(null);
    try {
      setTxStatus("Reading oracle + resolving…");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "resolveByOracle",
        args: [BigInt(market.id)],
      });
      setTxStatus(`Oracle resolved: ${hash.slice(0, 10)}…`);
      onSuccess();
    } catch (e: unknown) {
      const msg = (e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as { message?: string })?.message ?? String(e);
      setError(msg);
      setTxStatus("Oracle resolve failed");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="data-label mb-1">PERMISSIONLESS ORACLE RESOLUTION</div>
        <p className="font-body text-[13px] text-ink-secondary">
          Anyone can resolve. Reads {feed?.label ?? "price feed"} and resolves YES if price ≥{" "}
          <span className="font-mono text-ink-primary">
            {fromFeedUnits(market.strikePrice, feed?.decimals ?? 8)} {feed?.unit ?? "USD"}
          </span>.
        </p>
      </div>
      <div className="px-4 py-3 bg-teal-faint border border-teal/30 font-mono text-[10px] text-teal space-y-1">
        <div>FEED: {feed?.label ?? market.priceFeed}</div>
        <div>STRIKE: {fromFeedUnits(market.strikePrice, feed?.decimals ?? 8)} {feed?.unit}</div>
        <div>CONDITION: PRICE ≥ STRIKE → YES · PRICE &lt; STRIKE → NO</div>
      </div>
      <button
        onClick={resolve}
        disabled={isPending}
        className="btn-gold flex items-center gap-3"
      >
        {isPending ? (
          <>
            <Spinner size={14} />
            <span>READING ORACLE</span>
          </>
        ) : (
          "RESOLVE VIA ORACLE"
        )}
      </button>
      {error && <p className="font-mono text-[11px] text-crimson">{error}</p>}
    </div>
  );
}

function ResolvePanel({
  market, isCreator, onSuccess,
}: { market: MarketView; isCreator: boolean; onSuccess: () => void }) {
  const { writeContractAsync } = useWriteContract();
  const { setTxStatus } = useAppStore();
  const [isPending, setIsPending] = useState(false);

  if (!isCreator || market.resolved || market.epochStatus !== "closed") return null;

  async function resolve(outcome: number) {
    setIsPending(true);
    try {
      setTxStatus("Resolving market…");
      const hash = await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: CONTRACT_ABI,
        functionName: "resolveMarket",
        args: [BigInt(market.id), outcome],
      });
      setTxStatus(`Resolved: ${hash.slice(0, 10)}…`);
      onSuccess();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="data-label mb-1">RESOLVE OUTCOME</div>
        <p className="font-body text-[13px] text-ink-secondary">
          Commit the result on-chain. This initiates the settlement sequence.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => resolve(SIDE_YES)}
          disabled={isPending}
          className="py-3 font-mono text-[12px] tracking-widest text-void bg-teal disabled:opacity-30 flex items-center justify-center gap-2 transition-all hover:brightness-110"
        >
          {isPending && <Spinner size={12} />}
          YES WINS
        </button>
        <button
          onClick={() => resolve(SIDE_NO)}
          disabled={isPending}
          className="py-3 font-mono text-[12px] tracking-widest text-white bg-crimson disabled:opacity-30 flex items-center justify-center gap-2 transition-all hover:brightness-110"
        >
          {isPending && <Spinner size={12} />}
          NO WINS
        </button>
      </div>
    </div>
  );
}

export function MarketDetail() {
  const { id } = useParams<{ id: string }>();
  const marketId = Number(id);
  const { address } = useAccount();
  const queryClient = useQueryClient();

  const { data: rawMarket, isLoading, refetch } = useMarket(marketId);
  const { data: position, refetch: refetchPosition } = usePosition(marketId, address);

  function invalidate() {
    refetch();
    refetchPosition();
    queryClient.invalidateQueries({ queryKey: ["markets"] });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32 gap-3">
        <Spinner size={20} />
        <span className="font-mono text-[11px] text-ink-secondary tracking-wider">
          LOADING EPOCH
        </span>
      </div>
    );
  }

  if (!rawMarket) {
    return (
      <div className="bg-surface border border-wire p-12 text-center">
        <div className="font-display text-4xl text-wire mb-3">NOT FOUND</div>
        <Link to="/" className="font-mono text-[11px] text-gold hover:text-gold-bright tracking-wider">
          ← ALL EPOCHS
        </Link>
      </div>
    );
  }

  const raw = rawMarket as readonly unknown[];
  const market: MarketView = {
    id: marketId,
    creator:             raw[0] as string,
    question:            raw[1] as string,
    epochStart:          Number(raw[2] as bigint),
    epochEnd:            Number(raw[3] as bigint),
    resolved:            raw[4] as boolean,
    outcome:             Number(raw[5] as number),
    totalEth:            raw[6] as bigint,
    revealedYesPool:     raw[7] as bigint,
    revealedNoPool:      raw[8] as bigint,
    clearingPrice:       raw[9] as bigint,
    poolRevealRequested: raw[10] as boolean,
    poolRevealed:        raw[11] as boolean,
    priceFeed:           (raw[12] as string) ?? "0x0000000000000000000000000000000000000000",
    strikePrice:         (raw[13] as bigint) ?? 0n,
    useOracle:           (raw[14] as boolean) ?? false,
    epochStatus:         "accumulating",
  };
  market.epochStatus = computeEpochStatus(market);

  const isCreator = address?.toLowerCase() === market.creator.toLowerCase();
  const hasPos = !!position;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="max-w-2xl space-y-5"
    >
      {/* Back */}
      <Link
        to="/"
        className="font-mono text-[10px] tracking-widest text-ink-dim hover:text-gold transition-colors"
      >
        ← ALL EPOCHS
      </Link>

      {/* Header card */}
      <div className="bg-surface border border-wire notched-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-wire">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-ink-dim">
              CBC-{String(market.id + 1).padStart(3, "0")}
            </span>
            <span className="font-mono text-[10px] text-ink-dim">·</span>
            <span className="addr-display">{shortAddr(market.creator)}</span>
            {isCreator && (
              <span className="font-mono text-[9px] tracking-widest bg-gold-faint border border-gold-border text-gold px-2 py-0.5">
                CREATOR
              </span>
            )}
            {market.useOracle && (
              <span className="font-mono text-[9px] tracking-widest bg-teal-faint border border-teal/40 text-teal px-2 py-0.5">
                ⬡ ORACLE
              </span>
            )}
          </div>
          <MarketStatusBadge status={market.epochStatus} />
        </div>
        <div className="px-5 py-5">
          <h1 className="font-body text-[20px] text-ink-primary leading-snug">
            {market.question}
          </h1>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-px bg-wire">
        <div className="bg-surface px-4 py-4">
          <div className="data-label mb-2">
            {market.epochStatus === "accumulating" ? "CLOSES IN" : "CLOSED"}
          </div>
          {market.epochStatus === "accumulating" ? (
            <MarketCountdown epochEnd={market.epochEnd} />
          ) : (
            <div className="font-mono text-[13px] text-ink-dim uppercase">
              {new Date(market.epochEnd * 1000).toLocaleTimeString()}
            </div>
          )}
        </div>
        <div className="bg-surface px-4 py-4">
          <div className="data-label mb-2">VOLUME</div>
          <div className="font-mono text-[20px] font-bold text-ink-primary leading-none">
            {fmtEth(market.totalEth)}
          </div>
          <div className="font-mono text-[10px] text-ink-dim mt-1">ETH</div>
        </div>
        <div className="bg-surface px-4 py-4">
          <div className="data-label mb-2">CLEARING PRICE</div>
          <div className={`font-mono text-[20px] font-bold leading-none ${
            market.poolRevealed ? "text-teal" : "text-wire"
          }`}>
            {market.poolRevealed
              ? `${(Number(market.clearingPrice) / 100).toFixed(2)}%`
              : "████"}
          </div>
          {!market.poolRevealed && (
            <div className="font-mono text-[9px] text-gold-dim mt-1 tracking-wider">SEALED</div>
          )}
        </div>
      </div>

      {/* Live oracle price ticker — visible for all oracle markets */}
      <OraclePriceTicker market={market} />

      {/* Settlement */}
      {market.poolRevealed && (
        <div className="bg-surface border border-wire p-5">
          <div className="section-header mb-4">AGGREGATE REVEAL</div>
          <SettlementPanel market={market} />
        </div>
      )}

      {/* Protocol state */}
      <div className="bg-surface border border-wire overflow-hidden">
        <div className="px-5 py-3 border-b border-wire">
          <span className="section-header">PROTOCOL STATE</span>
        </div>
        <div className="py-2">
          <EpochLifecycle status={market.epochStatus} />
        </div>
      </div>

      {/* Actions */}
      <div className="bg-surface border border-wire p-5 space-y-5">
        <div className="section-header">ACTIONS</div>

        {market.epochStatus === "accumulating" && !hasPos && (
          <BetPanel marketId={market.id} onSuccess={invalidate} />
        )}

        {market.epochStatus === "accumulating" && hasPos && (
          <div className="flex items-center gap-3 p-3 border border-gold-border bg-gold-faint">
            <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-gold" />
            <div>
              <div className="font-mono text-[10px] text-gold tracking-wider">BID SEALED</div>
              <div className="font-mono text-[12px] text-ink-secondary mt-0.5">
                {fmtEth(position!.amount)} ETH committed · direction encrypted
              </div>
            </div>
          </div>
        )}

        {market.epochStatus === "closed" && !isCreator && (
          <p className="font-body text-[13px] text-ink-secondary">
            Waiting for creator to commit outcome on-chain.
          </p>
        )}

        <OracleResolvePanel market={market} onSuccess={invalidate} />
        <ResolvePanel market={market} isCreator={isCreator} onSuccess={invalidate} />
        <RevealPanel market={market} isCreator={false} onSuccess={invalidate} />

        {hasPos && (
          <ClaimPanel
            marketId={market.id}
            position={position!}
            poolRevealed={market.poolRevealed}
            onSuccess={invalidate}
          />
        )}

        {!hasPos && market.epochStatus !== "accumulating" && (
          <p className="font-body text-[13px] text-ink-dim">
            No position held in this epoch.
          </p>
        )}
      </div>

      {/* Resolved outcome banner */}
      {market.resolved && market.outcome !== UNRESOLVED && (
        <div className={`border p-4 flex items-center gap-4 ${
          market.outcome === SIDE_YES
            ? "border-teal/40 bg-teal-faint"
            : "border-crimson/40 bg-crimson/5"
        }`}>
          <span className="data-label">RESOLVED</span>
          <span className={`font-display text-3xl ${
            market.outcome === SIDE_YES ? "text-teal" : "text-crimson"
          }`}>
            {market.outcome === SIDE_YES ? "YES" : "NO"}
          </span>
        </div>
      )}
    </motion.div>
  );
}
