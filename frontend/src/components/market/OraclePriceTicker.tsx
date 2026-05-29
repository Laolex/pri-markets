import { motion } from "framer-motion";
import { useOraclePrice } from "@/hooks/useOraclePrice";
import { type MarketView, SEPOLIA_FEEDS, fromFeedUnits } from "@/types";

function AgeBadge({ seconds }: { seconds: number }) {
  if (seconds < 60)  return <span className="text-teal">LIVE ({seconds}s ago)</span>;
  if (seconds < 300) return <span className="text-gold">{Math.floor(seconds / 60)}m ago</span>;
  return <span className="text-crimson">STALE ({Math.floor(seconds / 60)}m)</span>;
}

export function OraclePriceTicker({ market }: { market: MarketView }) {
  const { data, isLoading } = useOraclePrice(
    market.useOracle ? market.priceFeed : undefined
  );

  if (!market.useOracle) return null;

  const feed = SEPOLIA_FEEDS.find(
    (f) => f.address.toLowerCase() === market.priceFeed.toLowerCase()
  );

  const strikeStr = fromFeedUnits(market.strikePrice, feed?.decimals ?? 8);

  if (isLoading || !data) {
    return (
      <div className="bg-surface border border-wire p-5">
        <div className="data-label mb-3">LIVE ORACLE FEED</div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-gold" />
          <span className="font-mono text-[11px] text-ink-dim tracking-wider">
            READING {feed?.label ?? "PRICE FEED"}…
          </span>
        </div>
      </div>
    );
  }

  const currentStr  = fromFeedUnits(data.price, feed?.decimals ?? 8);
  const isAbove     = data.price >= market.strikePrice;
  const diff        = data.price - market.strikePrice;
  const diffStr     = fromFeedUnits(diff < 0n ? -diff : diff, feed?.decimals ?? 8);
  const diffSign    = diff >= 0n ? "+" : "−";

  return (
    <div className="bg-surface border border-wire overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-wire">
        <span className="section-header">⬡ LIVE ORACLE — {feed?.label ?? "PRICE FEED"}</span>
        <span className="font-mono text-[10px]">
          <AgeBadge seconds={data.ageSeconds} />
        </span>
      </div>

      {/* Price rail */}
      <div className="grid grid-cols-3 divide-x divide-wire">
        {/* Current price */}
        <div className="px-5 py-4">
          <div className="data-label mb-1">CURRENT PRICE</div>
          <div className="font-mono text-[22px] font-bold text-ink-primary leading-none">
            {currentStr}
          </div>
          <div className="font-mono text-[10px] text-ink-dim mt-1">{feed?.unit}</div>
        </div>

        {/* Strike */}
        <div className="px-5 py-4">
          <div className="data-label mb-1">STRIKE PRICE</div>
          <div className="font-mono text-[22px] font-bold text-gold leading-none">
            {strikeStr}
          </div>
          <div className="font-mono text-[10px] text-ink-dim mt-1">{feed?.unit}</div>
        </div>

        {/* Distance + projected outcome */}
        <div className="px-5 py-4">
          <div className="data-label mb-1">DISTANCE</div>
          <div className={`font-mono text-[22px] font-bold leading-none ${
            isAbove ? "text-teal" : "text-crimson"
          }`}>
            {diffSign}{diffStr}
          </div>
          <div className={`font-mono text-[10px] mt-1 tracking-wider ${
            isAbove ? "text-teal" : "text-crimson"
          }`}>
            {isAbove ? "ABOVE STRIKE" : "BELOW STRIKE"}
          </div>
        </div>
      </div>

      {/* Projected outcome banner */}
      {!market.resolved && (
        <motion.div
          key={isAbove ? "yes" : "no"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className={`px-5 py-3 border-t flex items-center justify-between ${
            isAbove
              ? "border-teal/20 bg-teal-faint"
              : "border-crimson/20 bg-crimson/5"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-1.5 h-1.5 rounded-full ${isAbove ? "bg-teal" : "bg-crimson"} animate-pulse-gold`} />
            <span className="font-mono text-[10px] tracking-wider text-ink-secondary">
              IF RESOLVED NOW
            </span>
          </div>
          <span className={`font-display text-2xl tracking-widest ${
            isAbove ? "text-teal" : "text-crimson"
          }`}>
            {isAbove ? "YES" : "NO"}
          </span>
        </motion.div>
      )}

      {/* Sealed reminder — pool direction still hidden */}
      {market.epochStatus === "accumulating" && (
        <div className="px-5 py-2.5 border-t border-wire/50 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-gold animate-pulse-gold" />
          <span className="font-mono text-[9px] tracking-widest text-gold-dim">
            POOL DIRECTION SEALED · ORACLE SIGNAL VISIBLE BUT POOL COMPOSITION IS NOT
          </span>
        </div>
      )}
    </div>
  );
}
