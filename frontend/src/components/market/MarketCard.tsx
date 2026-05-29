import { formatEther } from "viem";
import { useNavigate } from "react-router-dom";
import { useAccount } from "wagmi";
import { motion } from "framer-motion";
import type { MarketView } from "@/types";
import { MarketStatusBadge } from "./MarketStatusBadge";
import { MarketCountdown } from "./MarketCountdown";
import { usePosition } from "@/hooks/useMarkets";

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function fmtEth(wei: bigint) {
  return Number(formatEther(wei)).toFixed(4);
}

export function MarketCard({ market, index }: { market: MarketView; index: number }) {
  const navigate = useNavigate();
  const { address } = useAccount();
  const { data: position } = usePosition(market.id, address);
  const hasPos = !!position;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate(`/market/${market.id}`)}
      className="intel-card notched cursor-pointer group p-0"
      style={{ willChange: "transform" }}
    >
      {/* Card header strip */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-wire">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-widest text-ink-dim">
            CBC-{String(market.id + 1).padStart(3, "0")} · {shortAddr(market.creator)}
          </span>
          {market.useOracle && (
            <span className="font-mono text-[9px] tracking-wider text-teal border border-teal/30 px-1.5 py-0.5">
              ⬡ ORACLE
            </span>
          )}
          {market.isTokenMarket && (
            <span className="font-mono text-[9px] tracking-wider text-gold border border-gold-border px-1.5 py-0.5">
              cUSDC
            </span>
          )}
        </div>
        <MarketStatusBadge status={market.epochStatus} />
      </div>

      {/* Question */}
      <div className="px-5 py-4">
        <p className="font-body text-[15px] text-ink-primary leading-snug group-hover:text-white transition-colors line-clamp-2">
          {market.question}
        </p>
      </div>

      {/* Sealed pool bar */}
      <div className="px-5 pb-4">
        {market.poolRevealed ? (
          <div className="space-y-1.5">
            <div className="flex justify-between font-mono text-[10px] text-ink-dim mb-2">
              <span>YES POOL</span>
              <span>NO POOL</span>
            </div>
            <div className="h-2 bg-base rounded-full overflow-hidden flex">
              <div
                className="h-full bg-teal transition-all duration-700"
                style={{ width: `${Number(market.clearingPrice) / 100}%` }}
              />
              <div
                className="h-full bg-crimson/60"
                style={{ width: `${100 - Number(market.clearingPrice) / 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="font-mono text-[10px] text-ink-dim mb-2 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-gold" />
              POOL COMPOSITION SEALED
            </div>
            <div className="h-2 sealed-bar w-full" />
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-wire border-t border-wire">
        <div className="px-4 py-3">
          <div className="data-label mb-1">
            {market.epochStatus === "accumulating" ? "Closes In" : "Status"}
          </div>
          {market.epochStatus === "accumulating" ? (
            <MarketCountdown epochEnd={market.epochEnd} />
          ) : (
            <div className="font-mono text-[13px] text-ink-dim uppercase tracking-wider">
              {market.epochStatus}
            </div>
          )}
        </div>
        <div className="px-4 py-3">
          <div className="data-label mb-1">Volume</div>
          <div className="font-mono text-[15px] font-bold text-ink-primary">
            {fmtEth(market.totalEth)}
            <span className="text-[11px] text-ink-dim ml-1">ETH</span>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="data-label mb-1">Price</div>
          <div className={`font-mono text-[15px] font-bold ${
            market.poolRevealed ? "text-teal" : "text-ink-dim"
          }`}>
            {market.poolRevealed
              ? `${(Number(market.clearingPrice) / 100).toFixed(1)}%`
              : "████"}
          </div>
        </div>
      </div>

      {/* Owned position indicator */}
      {hasPos && (
        <div className="flex items-center gap-2 px-5 py-2.5 border-t border-gold-border bg-gold-faint">
          <span className="w-1.5 h-1.5 rounded-full bg-gold" />
          <span className="font-mono text-[10px] tracking-wider text-gold">
            SEALED POSITION HELD
          </span>
        </div>
      )}
    </motion.div>
  );
}
