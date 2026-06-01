import { useParams, Link } from "react-router-dom";
import { useAccount, useWriteContract } from "wagmi";
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

function fmtUsdc(raw: bigint) {
  return (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

// ── Oracle resolve panel ──────────────────────────────────────────────────────

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
      <div className="px-4 py-3 bg-teal-faint border border-teal/25 font-mono text-[10px] text-teal space-y-1">
        <div>FEED: {feed?.label ?? market.priceFeed}</div>
        <div>STRIKE: {fromFeedUnits(market.strikePrice, feed?.decimals ?? 8)} {feed?.unit}</div>
        <div>CONDITION: PRICE ≥ STRIKE → YES · PRICE &lt; STRIKE → NO</div>
      </div>
      <button
        onClick={resolve}
        disabled={isPending}
        className="btn-gold w-full flex items-center justify-center gap-3"
      >
        {isPending ? <><Spinner size={14} /><span>READING ORACLE</span></> : "RESOLVE VIA ORACLE"}
      </button>
      {error && <p className="font-mono text-[11px] text-crimson">{error}</p>}
    </div>
  );
}

// ── Manual resolve panel ───────────────────────────────────────────────────────

function ResolvePanel({ market, isCreator, onSuccess }: {
  market: MarketView; isCreator: boolean; onSuccess: () => void;
}) {
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
      <div className="data-label">COMMIT OUTCOME</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => resolve(SIDE_YES)} disabled={isPending}
          className="py-3 font-mono text-[12px] tracking-widest text-void bg-teal disabled:opacity-30 flex items-center justify-center gap-2 transition-all hover:brightness-110"
        >
          {isPending && <Spinner size={12} color="white" />} YES WINS
        </button>
        <button
          onClick={() => resolve(SIDE_NO)} disabled={isPending}
          className="py-3 font-mono text-[12px] tracking-widest text-white bg-crimson disabled:opacity-30 flex items-center justify-center gap-2 transition-all hover:brightness-110"
        >
          {isPending && <Spinner size={12} color="white" />} NO WINS
        </button>
      </div>
    </div>
  );
}

// ── Right-hand action panel (sticky) ─────────────────────────────────────────

function ActionPanel({
  market, position, isCreator, onSuccess,
}: {
  market: MarketView;
  position: ReturnType<typeof usePosition>["data"];
  isCreator: boolean;
  onSuccess: () => void;
}) {
  const hasPos = !!position;
  const isLive = market.epochStatus === "accumulating";

  const cardBorder = isLive
    ? "border-gold/25 shadow-card-live"
    : market.poolRevealed
    ? "border-teal/25 shadow-card-revealed"
    : "border-wire";

  return (
    <div className={`bg-surface border ${cardBorder} overflow-hidden`}>
      {/* Panel header */}
      <div className={`h-px w-full ${
        isLive ? "bg-gradient-to-r from-transparent via-gold/40 to-transparent" :
        market.poolRevealed ? "bg-gradient-to-r from-transparent via-teal/40 to-transparent" :
        "bg-wire"
      }`} />
      <div className="px-5 py-3 border-b border-wire flex items-center justify-between">
        <span className="section-header">
          {isLive && !hasPos ? "PLACE BID" :
           isLive && hasPos  ? "POSITION" :
           market.poolRevealed ? "SETTLEMENT" :
           "ACTIONS"}
        </span>
        <MarketStatusBadge status={market.epochStatus} />
      </div>

      <div className="p-5 space-y-5">

        {/* Accumulating — no position */}
        {isLive && !hasPos && (
          <BetPanel
            marketId={market.id}
            onSuccess={onSuccess}
          />
        )}

        {/* Accumulating — position held */}
        {isLive && hasPos && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 border border-gold-border bg-gold-faint">
              <div className="relative flex-shrink-0 mt-0.5">
                <span className="absolute w-3 h-3 rounded-full bg-gold/30 animate-ring-expand" />
                <span className="relative w-3 h-3 rounded-full bg-gold block" />
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[10px] text-gold tracking-wider mb-1">BID SEALED</div>
                <div className="font-mono text-[13px] text-ink-primary">
                  cUSDC committed · direction encrypted · top-ups accumulate
                </div>
                <div className="font-mono text-[10px] text-ink-dim mt-1.5">
                  Side: never observable · Pool: sealed until epoch close
                </div>
              </div>
            </div>

            {/* Mechanisnm note */}
            <div className="text-center py-3">
              <div className="font-mono text-[9px] text-ink-dim tracking-widest">
                P_t^dir = ∅ for all t &lt; t_close
              </div>
            </div>
          </div>
        )}

        {/* Closed — waiting for creator */}
        {market.epochStatus === "closed" && !isCreator && !market.resolved && (
          <p className="font-body text-[13px] text-ink-secondary py-2">
            Epoch closed. Waiting for outcome to be committed on-chain.
          </p>
        )}

        {/* Oracle resolve */}
        <OracleResolvePanel market={market} onSuccess={onSuccess} />

        {/* Manual resolve */}
        <ResolvePanel market={market} isCreator={isCreator} onSuccess={onSuccess} />

        {/* Pool reveal */}
        <RevealPanel market={market} isCreator={false} onSuccess={onSuccess} />

        {/* Claim */}
        {hasPos && (
          <ClaimPanel
            marketId={market.id}
            position={position!}
            poolRevealed={market.poolRevealed}
            onSuccess={onSuccess}
          />
        )}

        {!hasPos && market.epochStatus !== "accumulating" && market.epochStatus !== "closed" && (
          <p className="font-body text-[13px] text-ink-dim py-2">
            No position held in this epoch.
          </p>
        )}
      </div>

      {/* Resolved outcome */}
      {market.resolved && market.outcome !== UNRESOLVED && (
        <div className={`px-5 py-4 border-t flex items-center justify-between ${
          market.outcome === SIDE_YES
            ? "border-teal/30 bg-teal-faint"
            : "border-crimson/30 bg-crimson/5"
        }`}>
          <span className="font-mono text-[10px] text-ink-dim tracking-wider">RESOLVED</span>
          <span className={`font-display text-3xl tracking-widest ${
            market.outcome === SIDE_YES ? "text-teal" : "text-crimson"
          }`}
            style={{
              textShadow: market.outcome === SIDE_YES
                ? "0 0 16px rgba(46,196,182,0.5)"
                : "0 0 16px rgba(196,64,64,0.5)"
            }}>
            {market.outcome === SIDE_YES ? "YES" : "NO"}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

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
        <span className="font-mono text-[11px] text-ink-secondary tracking-wider">LOADING EPOCH</span>
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
    revealedYesPool:     raw[6] as bigint,
    revealedNoPool:      raw[7] as bigint,
    clearingPrice:       raw[8] as bigint,
    poolRevealRequested: raw[9] as boolean,
    poolRevealed:        raw[10] as boolean,
    priceFeed:           (raw[11] as string)  ?? "0x0000000000000000000000000000000000000000",
    strikePrice:         (raw[12] as bigint)  ?? 0n,
    useOracle:           (raw[13] as boolean) ?? false,
    token:               (raw[14] as string)  ?? "0x0000000000000000000000000000000000000000",
    betCount:            (raw[15] as bigint)  ?? 0n,
    bettorCount:         (raw[16] as bigint)  ?? 0n,
    epochStatus:         "accumulating",
  };
  market.epochStatus = computeEpochStatus(market);

  const isCreator = address?.toLowerCase() === market.creator.toLowerCase();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Back */}
      <Link
        to="/"
        className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest text-ink-dim hover:text-gold transition-colors group mb-5"
      >
        <span className="transition-transform group-hover:-translate-x-0.5">←</span>
        ALL EPOCHS
      </Link>

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-5 items-start">

        {/* ── Left column — market info ──────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* Header card */}
          <div className={`bg-surface border notched-lg overflow-hidden relative ${
            market.epochStatus === "accumulating" ? "border-gold/20" :
            market.poolRevealed ? "border-teal/20" : "border-wire"
          }`}>
            <div className={`h-px w-full ${
              market.epochStatus === "accumulating"
                ? "bg-gradient-to-r from-transparent via-gold/40 to-transparent"
                : market.poolRevealed
                ? "bg-gradient-to-r from-transparent via-teal/40 to-transparent"
                : "bg-wire"
            }`} />
            <div className="flex items-center justify-between px-5 py-3 border-b border-wire">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="font-mono text-[10px] text-ink-dim">
                  CBC-{String(market.id + 1).padStart(3, "0")}
                </span>
                <span className="text-wire">·</span>
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
                <span className="font-mono text-[9px] tracking-widest bg-gold-faint border border-gold-border text-gold px-2 py-0.5">
                  cUSDC
                </span>
              </div>
            </div>
            <div className="px-5 py-6">
              <h1 className="font-body text-[22px] text-ink-primary leading-snug">
                {market.question}
              </h1>
              {market.bettorCount > 0n && (
                <div className="font-mono text-[10px] text-ink-dim mt-2 tracking-wider">
                  {market.bettorCount.toString()} BETTOR{market.bettorCount !== 1n ? "S" : ""} · {market.betCount.toString()} BID{market.betCount !== 1n ? "S" : ""}
                </div>
              )}
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
                  {new Date(market.epochEnd * 1000).toLocaleString()}
                </div>
              )}
            </div>
            <div className="bg-surface px-4 py-4">
              <div className="data-label mb-2">{market.poolRevealed ? "TOTAL POOL" : "BIDS"}</div>
              <div className="flex items-baseline gap-1">
                <span className="font-display text-[24px] leading-none text-ink-primary">
                  {market.poolRevealed ? fmtUsdc(market.revealedYesPool + market.revealedNoPool) : market.betCount.toString()}
                </span>
                <span className="font-mono text-[10px] text-ink-dim">{market.poolRevealed ? "USDC" : "SEALED"}</span>
              </div>
            </div>
            <div className="bg-surface px-4 py-4">
              <div className="data-label mb-2">CLEARING PRICE</div>
              {market.poolRevealed ? (
                <div
                  className="font-display text-[24px] leading-none text-teal"
                  style={{ textShadow: "0 0 16px rgba(46,196,182,0.4)" }}
                >
                  {(Number(market.clearingPrice) / 100).toFixed(2)}%
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[18px] text-wire tracking-widest">████</span>
                  {market.epochStatus === "accumulating" && (
                    <span className="font-mono text-[8px] text-gold/50 tracking-wider">SEALED</span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Oracle price ticker */}
          <OraclePriceTicker market={market} />

          {/* Settlement panel */}
          {market.poolRevealed && (
            <div className="bg-surface border border-wire p-5">
              <div className="section-header mb-4">AGGREGATE REVEAL</div>
              <SettlementPanel market={market} />
            </div>
          )}

          {/* Protocol state / timeline */}
          <div className="bg-surface border border-wire overflow-hidden">
            <div className="px-5 py-3 border-b border-wire">
              <span className="section-header">PROTOCOL STATE</span>
            </div>
            <EpochLifecycle status={market.epochStatus} />
          </div>

        </div>

        {/* ── Right column — sticky action panel ────────────────────────── */}
        <div className="w-full lg:w-80 xl:w-96 flex-shrink-0 lg:sticky lg:top-20">
          <ActionPanel
            market={market}
            position={position}
            isCreator={isCreator}
            onSuccess={invalidate}
          />
        </div>

      </div>
    </motion.div>
  );
}
