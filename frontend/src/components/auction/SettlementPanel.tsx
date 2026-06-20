import { motion } from "framer-motion";
import { formatUnits } from "viem";
import type { MarketView } from "@/types";
import { SIDE_YES, UNRESOLVED, USDC_DECIMALS } from "@/types";

// V2 is token-only: revealed pools are cUSDC (6 decimals), NOT ETH.
function fmtUsdc(raw: bigint) {
  return Number(formatUnits(raw, USDC_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function SettlementPanel({ market }: { market: MarketView }) {
  if (!market.poolRevealed) return null;

  const total      = market.revealedYesPool + market.revealedNoPool;
  const yesPct     = total > 0n ? Number((market.revealedYesPool * 10000n) / total) / 100 : 0;
  const noPct      = 100 - yesPct;
  const clearingStr = (Number(market.clearingPrice) / 100).toFixed(2);

  return (
    <div className="space-y-5">
      {/* Clearing price — cinematic */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative overflow-hidden bg-base border border-teal/25 p-6"
      >
        {/* Background glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(46,196,182,0.06) 0%, transparent 70%)"
          }}
        />

        {/* Data scan sweep */}
        <div className="data-scan absolute inset-0 pointer-events-none" />

        <div className="relative z-10 flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] tracking-widest text-teal/70 mb-1 uppercase">
              Terminal Clearing Price
            </div>
            <p className="font-mono text-[11px] text-ink-secondary max-w-xs">
              First &amp; only public directional signal. Emitted once at epoch close.
            </p>
            <p className="font-mono text-[10px] text-ink-dim mt-1">
              P_t^dir = ∅ for all t &lt; t_close
            </p>
          </div>
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="text-right"
          >
            <div
              className="font-display text-[64px] leading-none text-teal"
              style={{ textShadow: "0 0 30px rgba(46,196,182,0.5), 0 0 60px rgba(46,196,182,0.2)" }}
            >
              {clearingStr}
              <span className="text-[32px] text-teal/70">%</span>
            </div>
            <div className="font-mono text-[9px] text-teal/60 tracking-widest mt-1">
              YES PROBABILITY
            </div>
          </motion.div>
        </div>
      </motion.div>

      {/* Pool split */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="space-y-3"
      >
        <div className="flex justify-between items-end">
          <div>
            <div className="data-label mb-1">YES POOL</div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-[20px] leading-none text-teal">
                {fmtUsdc(market.revealedYesPool)}
              </span>
              <span className="font-mono text-[10px] text-ink-dim">USDC</span>
              <span className="font-mono text-[11px] text-teal/60">({yesPct.toFixed(1)}%)</span>
            </div>
          </div>
          <div className="text-right">
            <div className="data-label mb-1">NO POOL</div>
            <div className="flex items-baseline gap-1.5 justify-end">
              <span className="font-mono text-[11px] text-crimson/60">({noPct.toFixed(1)}%)</span>
              <span className="font-mono text-[10px] text-ink-dim">USDC</span>
              <span className="font-display text-[20px] leading-none text-crimson">
                {fmtUsdc(market.revealedNoPool)}
              </span>
            </div>
          </div>
        </div>

        {/* Animated pool bar */}
        <div className="h-3 bg-base border border-wire/50 overflow-hidden flex relative">
          <motion.div
            className="h-full bg-gradient-to-r from-teal to-teal/80"
            initial={{ width: 0 }}
            animate={{ width: `${yesPct}%` }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
          <motion.div
            className="h-full bg-gradient-to-r from-crimson/60 to-crimson/40 flex-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.5 }}
          />
          {/* Center marker */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-wire/60" />
        </div>

        <p className="font-mono text-[9px] text-ink-dim text-center tracking-wider">
          SEALED DURING ACCUMULATION · REVEALED ONCE AT EPOCH CLOSE
        </p>
      </motion.div>

      {/* Outcome */}
      {market.resolved && market.outcome !== UNRESOLVED && (
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className={`flex items-center justify-between p-4 border ${
            market.outcome === SIDE_YES
              ? "border-teal/40 bg-teal-faint"
              : "border-crimson/40 bg-crimson/5"
          }`}
        >
          <div>
            <div className="data-label mb-0.5">RESOLVED OUTCOME</div>
            <p className="font-body text-[12px] text-ink-secondary">
              Winners may now claim via FHE.select
            </p>
          </div>
          <div
            className={`font-display text-5xl ${
              market.outcome === SIDE_YES ? "text-teal" : "text-crimson"
            }`}
            style={{
              textShadow: market.outcome === SIDE_YES
                ? "0 0 20px rgba(46,196,182,0.5)"
                : "0 0 20px rgba(196,64,64,0.5)"
            }}
          >
            {market.outcome === SIDE_YES ? "YES" : "NO"}
          </div>
        </motion.div>
      )}
    </div>
  );
}
