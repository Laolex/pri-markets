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

function SealedPoolBar() {
  return (
    <div className="relative">
      <div className="h-2 sealed-bar w-full overflow-hidden" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-[8px] tracking-widest text-gold/50 bg-surface px-2">
          SEALED
        </span>
      </div>
    </div>
  );
}

function RevealedPoolBar({ clearingPrice }: { clearingPrice: bigint }) {
  const yesPct = Number(clearingPrice) / 100;
  const noPct  = 100 - yesPct;

  return (
    <div className="space-y-1.5">
      <div className="h-2 bg-base rounded-none overflow-hidden flex relative">
        <motion.div
          className="h-full bg-teal"
          initial={{ width: 0 }}
          animate={{ width: `${yesPct}%` }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.div
          className="h-full bg-crimson/60 flex-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
        />
      </div>
      <div className="flex justify-between font-mono text-[9px]">
        <span className="text-teal">{yesPct.toFixed(1)}% YES</span>
        <span className="text-crimson/70">{noPct.toFixed(1)}% NO</span>
      </div>
    </div>
  );
}

export function MarketCard({ market, index }: { market: MarketView; index: number }) {
  const navigate  = useNavigate();
  const { address } = useAccount();
  const { data: position } = usePosition(market.id, address);
  const hasPos = !!position;

  const isLive     = market.epochStatus === "accumulating";
  const isRevealed = market.poolRevealed;

  const cardClass = isLive
    ? "intel-card card-live notched cursor-pointer group p-0"
    : isRevealed
    ? "intel-card card-revealed notched cursor-pointer group p-0"
    : "intel-card notched cursor-pointer group p-0";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      onClick={() => navigate(`/market/${market.id}`)}
      className={cardClass}
      style={{ willChange: "transform" }}
    >
      {/* Top accent line — status color */}
      <div className={`h-px w-full ${
        isLive ? "bg-gradient-to-r from-transparent via-gold/50 to-transparent" :
        isRevealed ? "bg-gradient-to-r from-transparent via-teal/50 to-transparent" :
        "bg-wire"
      }`} />

      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-wire">
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-[10px] tracking-widest text-ink-dim">
            CBC-{String(market.id + 1).padStart(3, "0")}
          </span>
          <span className="text-wire">·</span>
          <span className="addr-display">{shortAddr(market.creator)}</span>
          {market.useOracle && (
            <span className="font-mono text-[9px] tracking-wider text-teal border border-teal/30 bg-teal-faint px-1.5 py-0.5">
              ⬡ ORACLE
            </span>
          )}
          {market.isTokenMarket && (
            <span className="font-mono text-[9px] tracking-wider text-gold border border-gold-border bg-gold-faint px-1.5 py-0.5">
              cUSDC
            </span>
          )}
        </div>
        <MarketStatusBadge status={market.epochStatus} />
      </div>

      {/* Question — main content */}
      <div className="px-5 pt-4 pb-3">
        <p className="font-body text-[16px] text-ink-primary leading-snug group-hover:text-white transition-colors line-clamp-2">
          {market.question}
        </p>
      </div>

      {/* Pool visualization */}
      <div className="px-5 pb-4">
        {isRevealed
          ? <RevealedPoolBar clearingPrice={market.clearingPrice} />
          : <SealedPoolBar />
        }
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-wire border-t border-wire">
        {/* Countdown / Status */}
        <div className="px-4 py-3">
          <div className="data-label mb-2">
            {isLive ? "CLOSES IN" : "STATUS"}
          </div>
          {isLive ? (
            <MarketCountdown epochEnd={market.epochEnd} />
          ) : (
            <div className="font-mono text-[12px] text-ink-dim uppercase tracking-wider">
              {market.epochStatus}
            </div>
          )}
        </div>

        {/* Volume */}
        <div className="px-4 py-3">
          <div className="data-label mb-2">VOLUME</div>
          <div className="flex items-baseline gap-1">
            <span className={`font-display text-[22px] leading-none ${
              isLive ? "text-gold" : "text-ink-primary"
            }`}>
              {fmtEth(market.totalEth)}
            </span>
            <span className="font-mono text-[10px] text-ink-dim">ETH</span>
          </div>
          {market.participantCount > 0n && (
            <div className="font-mono text-[9px] text-ink-dim mt-0.5">
              {market.participantCount.toString()} BID{market.participantCount !== 1n ? "S" : ""}
            </div>
          )}
        </div>

        {/* Clearing price */}
        <div className="px-4 py-3">
          <div className="data-label mb-2">CLEARING PRICE</div>
          {isRevealed ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`font-display text-[22px] leading-none text-teal`}
              style={{ textShadow: "0 0 20px rgba(46,196,182,0.5)" }}
            >
              {(Number(market.clearingPrice) / 100).toFixed(1)}%
            </motion.div>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="font-mono text-[18px] text-wire tracking-widest">████</div>
              {isLive && (
                <span className="font-mono text-[8px] text-gold/50 tracking-wider">SEALED</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Position indicator */}
      {hasPos && (
        <div className="flex items-center gap-2 px-5 py-2.5 border-t border-gold-border bg-gold-faint">
          <div className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-gold animate-ring-expand" />
            <span className="relative rounded-full h-2 w-2 bg-gold" />
          </div>
          <span className="font-mono text-[10px] tracking-wider text-gold">
            SEALED POSITION HELD
          </span>
        </div>
      )}
    </motion.div>
  );
}
