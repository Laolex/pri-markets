import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import type { MarketView } from "@/types";
import { SIDE_YES, UNRESOLVED } from "@/types";

function fmtUsdc(raw: bigint) {
  return (Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function PriceBar({ pct, animated }: { pct: number; animated?: boolean }) {
  return (
    <div className="h-1.5 bg-base rounded-full overflow-hidden flex">
      <motion.div
        className="h-full bg-teal"
        initial={animated ? { width: 0 } : false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />
      <motion.div
        className="h-full bg-crimson/50"
        initial={animated ? { width: 0 } : false}
        animate={{ width: `${100 - pct}%` }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}

function EpochRow({ market, index }: { market: MarketView; index: number }) {
  const pct = Number(market.clearingPrice) / 100;
  const resolved = market.outcome !== UNRESOLVED;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      <Link to={`/market/${market.id}`} className="block group">
        <div className="space-y-2 py-3 px-1 hover:bg-panel/40 transition-colors rounded-sm">
          {/* Row header */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-[10px] text-ink-dim flex-shrink-0">
                PRI-{String(market.id + 1).padStart(3, "0")}
              </span>
              <span className="font-body text-[12px] text-ink-secondary group-hover:text-ink-primary transition-colors truncate">
                {market.question}
              </span>
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              {/* Volume */}
              <span className="font-mono text-[10px] text-ink-dim hidden sm:block">
                {market.poolRevealed ? `${fmtUsdc(market.revealedYesPool + market.revealedNoPool)} USDC` : `${market.betCount} bids`}
              </span>

              {/* Outcome */}
              {resolved && (
                <span className={`font-mono text-[9px] tracking-widest px-1.5 py-0.5 border ${
                  market.outcome === SIDE_YES
                    ? "text-teal border-teal/30 bg-teal-faint"
                    : "text-crimson border-crimson/30 bg-crimson/5"
                }`}>
                  {market.outcome === SIDE_YES ? "YES" : "NO"}
                </span>
              )}

              {/* Clearing price value */}
              <span className="font-mono text-[15px] font-bold text-teal w-14 text-right">
                {pct.toFixed(1)}%
              </span>
            </div>
          </div>

          {/* Price bar */}
          <PriceBar pct={pct} animated />

          {/* Labels */}
          <div className="flex justify-between font-mono text-[9px] text-ink-dim">
            <span>0% NO</span>
            <span className="text-teal">
              {pct.toFixed(1)}% YES — CLEARING PRICE
            </span>
            <span>100% YES</span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export function ClearingPriceHistory({ markets }: { markets: MarketView[] }) {
  const revealed = [...markets]
    .filter((m) => m.poolRevealed)
    .sort((a, b) => b.epochEnd - a.epochEnd);

  if (revealed.length === 0) return null;

  // Compute price spread for context
  const prices = revealed.map((m) => Number(m.clearingPrice) / 100);
  const avg    = prices.reduce((s, p) => s + p, 0) / prices.length;
  const minP   = Math.min(...prices);
  const maxP   = Math.max(...prices);

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="bg-surface border border-wire overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-wire">
          <div className="flex items-center gap-3">
            <span className="section-header">CLEARING PRICE HISTORY</span>
            <span className="font-mono text-[9px] text-ink-dim">
              {revealed.length} EPOCH{revealed.length !== 1 ? "S" : ""} REVEALED
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="font-mono text-[9px] text-ink-dim">AVG</div>
              <div className="font-mono text-[12px] text-gold">{avg.toFixed(1)}%</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[9px] text-ink-dim">RANGE</div>
              <div className="font-mono text-[12px] text-ink-secondary">
                {minP.toFixed(0)}–{maxP.toFixed(0)}%
              </div>
            </div>
          </div>
        </div>

        {/* Mechanism note */}
        <div className="px-5 py-2.5 border-b border-wire/50 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0" />
          <p className="font-mono text-[9px] text-ink-dim leading-relaxed">
            Each bar is the terminal clearing price — the first and only directional signal published per epoch. Pool composition was sealed during accumulation.
          </p>
        </div>

        {/* Epoch rows */}
        <div className="px-5 py-2 divide-y divide-wire/40">
          {revealed.map((m, i) => (
            <EpochRow key={m.id} market={m} index={i} />
          ))}
        </div>
      </div>
    </motion.section>
  );
}
