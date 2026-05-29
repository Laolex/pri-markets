import { motion } from "framer-motion";
import { useState } from "react";
import { useMarkets, useMarketCount } from "@/hooks/useMarkets";
import { MarketCard } from "@/components/market/MarketCard";
import { ClearingPriceHistory } from "@/components/market/ClearingPriceHistory";
import { Spinner } from "@/components/ui/Spinner";
import { PrivacyBoundary } from "@/components/ui/PrivacyBoundary";
import { useAccount } from "wagmi";
import { Link } from "react-router-dom";
import { formatEther } from "viem";
import type { MarketView } from "@/types";

type FilterTab = "all" | "live" | "token" | "revealed";

function DashboardStats({ markets }: { markets: MarketView[] }) {
  const liveCount     = markets.filter(m => m.epochStatus === "accumulating").length;
  const revealedCount = markets.filter(m => m.poolRevealed).length;
  const tokenCount    = markets.filter(m => m.isTokenMarket).length;
  const totalVol      = markets.reduce((s, m) => s + m.totalEth, 0n);

  const stats = [
    { label: "TOTAL EPOCHS",    value: markets.length.toString(),                           accent: false },
    { label: "LIVE",            value: liveCount.toString(),                                accent: liveCount > 0 },
    { label: "REVEALED",        value: revealedCount.toString(),                            accent: false },
    { label: "cUSDC MARKETS",   value: tokenCount.toString(),                               accent: tokenCount > 0 },
    { label: "TOTAL VOLUME",    value: `${Number(formatEther(totalVol)).toFixed(3)} ETH`,   accent: false },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="grid grid-cols-2 sm:grid-cols-5 gap-px bg-wire mb-8"
    >
      {stats.map(({ label, value, accent }) => (
        <div key={label} className="bg-surface px-4 py-3 text-center">
          <div className="data-label mb-1">{label}</div>
          <div className={`font-display text-[20px] leading-none ${
            accent ? "text-gold" : "text-ink-primary"
          }`}>
            {value}
          </div>
        </div>
      ))}
    </motion.div>
  );
}

const FILTER_LABELS: Record<FilterTab, string> = {
  all:      "ALL",
  live:     "LIVE",
  token:    "cUSDC",
  revealed: "REVEALED",
};

function filterMarkets(markets: MarketView[], tab: FilterTab): MarketView[] {
  switch (tab) {
    case "live":     return markets.filter(m => m.epochStatus === "accumulating");
    case "token":    return markets.filter(m => m.isTokenMarket);
    case "revealed": return markets.filter(m => m.poolRevealed);
    default:         return markets;
  }
}

// ── Hero section ──────────────────────────────────────────────────────────

const PILLARS = [
  {
    id: "01",
    title: "SEALED ACCUMULATION",
    desc: "Directional intent accumulates privately. No bid is observable during the epoch window.",
    accent: "gold",
  },
  {
    id: "02",
    title: "AGGREGATE REVEAL",
    desc: "YES/NO split published once at epoch close — P_t^dir = ∅ for all t < t_close.",
    accent: "teal",
  },
  {
    id: "03",
    title: "FHE SETTLEMENT",
    desc: "Payout via FHE.select. Your YES/NO side is never revealed on-chain, ever.",
    accent: "teal",
  },
];

function Hero() {
  return (
    <section className="pt-2 pb-14">
      {/* Classification stamp */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="flex items-center gap-4 mb-12"
      >
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-wire" />
        <span className="font-mono text-[9px] tracking-widest2 text-ink-dim">
          CBC / SEALED-BID / FHEVM / SEPOLIA
        </span>
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-wire" />
      </motion.div>

      {/* Main headline */}
      <div className="mb-12">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1
            className="font-display text-[80px] sm:text-[108px] leading-none tracking-widest text-ink-primary"
            style={{ lineHeight: "0.92" }}
          >
            SEALED
          </h1>
          <h1
            className="font-display text-[80px] sm:text-[108px] leading-none tracking-widest text-gold"
            style={{
              lineHeight: "0.92",
              textShadow: "0 0 60px rgba(196,153,59,0.2)",
            }}
          >
            CAPITAL.
          </h1>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="font-body text-[15px] text-ink-secondary leading-relaxed max-w-lg mt-8"
        >
          Traditional prediction markets leak directional flow continuously — creating
          reflexive momentum, copy-trading, and pre-settlement signaling. This protocol
          accumulates sealed bids and reveals only aggregate clearing price at epoch close.
        </motion.p>
      </div>

      {/* Three pillars */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45, duration: 0.6 }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-wire"
      >
        {PILLARS.map(({ id, title, desc, accent }) => (
          <div key={id} className="bg-surface p-5 relative overflow-hidden group">
            {/* Top accent */}
            <div className={`absolute top-0 left-0 right-0 h-px ${
              accent === "gold"
                ? "bg-gradient-to-r from-transparent via-gold/50 to-transparent"
                : "bg-gradient-to-r from-transparent via-teal/50 to-transparent"
            }`} />
            <div className="font-mono text-[9px] text-ink-dim mb-3 tracking-widest">{id} /</div>
            <div className={`font-mono text-[11px] tracking-widest mb-2 ${
              accent === "gold" ? "text-gold" : "text-teal"
            }`}>
              {title}
            </div>
            <p className="font-body text-[13px] text-ink-secondary leading-relaxed">{desc}</p>
          </div>
        ))}
      </motion.div>
    </section>
  );
}

function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-surface border border-wire py-20 text-center"
    >
      <div
        className="font-display text-6xl text-wire mb-4 tracking-widest"
        style={{ textShadow: "0 0 40px rgba(26,37,53,0.8)" }}
      >
        NO EPOCHS
      </div>
      <p className="font-body text-ink-secondary text-[14px] mb-8">
        No information markets have been initialized.
      </p>
      <Link to="/create" className="btn-gold">
        INITIALIZE FIRST EPOCH
      </Link>
    </motion.div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────

export function Home() {
  const { isConnected } = useAccount();
  const { data: count }              = useMarketCount();
  const { data: markets, isLoading } = useMarkets();
  const [activeTab, setActiveTab]    = useState<FilterTab>("all");
  const n = count ? Number(count) : 0;

  const liveCount    = markets?.filter(m => m.epochStatus === "accumulating").length ?? 0;
  const filtered     = markets ? filterMarkets(markets, activeTab) : [];
  const showEmpty    = !isLoading && filtered.length === 0 && markets && markets.length > 0;

  return (
    <div>
      {!isConnected && <Hero />}

      {/* Judge onboarding strip */}
      {!isConnected && n > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.4 }}
          className="mb-10 border border-teal/25 bg-teal/[0.03] px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <div className="relative flex-shrink-0 mt-1">
              <span className="absolute w-3 h-3 rounded-full bg-teal/30 animate-ring-expand" />
              <span className="relative w-3 h-3 rounded-full bg-teal block" />
            </div>
            <div>
              <div className="font-mono text-[10px] tracking-widest text-teal mb-1">
                {liveCount} LIVE EPOCH{liveCount !== 1 ? "S" : ""} — SEALED POOLS ACCUMULATING
              </div>
              <p className="font-body text-[13px] text-ink-secondary">
                Connect a Sepolia wallet to place a sealed bid. Need ETH?{" "}
                <a
                  href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                  target="_blank" rel="noopener noreferrer"
                  className="text-teal underline underline-offset-2 hover:text-white transition-colors"
                >
                  Google Faucet
                </a>
                {" or "}
                <a
                  href="https://sepolia-faucet.pk910.de/"
                  target="_blank" rel="noopener noreferrer"
                  className="text-teal underline underline-offset-2 hover:text-white transition-colors"
                >
                  PoW Faucet
                </a>
              </p>
            </div>
          </div>
          <div className="font-mono text-[10px] text-ink-dim flex-shrink-0">
            MIN BET · 0.001 ETH
          </div>
        </motion.div>
      )}

      {/* Information topology */}
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: isConnected ? 0 : 0.7, duration: 0.5 }}
        className="mb-10"
      >
        <PrivacyBoundary />
      </motion.section>

      {/* Dashboard stats — when markets exist */}
      {markets && markets.length > 0 && (
        <DashboardStats markets={markets} />
      )}

      {/* Epoch listing */}
      <section>
        {/* Header + filter tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-4">
            <span className="font-display text-2xl tracking-widest text-ink-primary">EPOCHS</span>
            {n > 0 && (
              <span className="font-mono text-[11px] text-ink-dim">
                {activeTab === "all" ? `${n} TOTAL` : `${filtered.length} / ${n}`}
                {liveCount > 0 && activeTab === "all" && (
                  <span className="text-gold ml-2">· {liveCount} LIVE</span>
                )}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Filter tabs */}
            {(Object.keys(FILTER_LABELS) as FilterTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`font-mono text-[9px] tracking-widest px-3 py-1.5 border transition-all ${
                  activeTab === tab
                    ? "border-gold-border bg-gold-faint text-gold"
                    : "border-wire text-ink-dim hover:text-ink-secondary hover:border-ink-dim"
                }`}
              >
                {FILTER_LABELS[tab]}
              </button>
            ))}
            <Link to="/create" className="btn-ghost text-[9px] px-3 py-1.5 ml-2">
              + NEW
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-3">
            <Spinner size={20} />
            <span className="font-mono text-[11px] text-ink-secondary tracking-wider">
              LOADING EPOCHS
            </span>
          </div>
        ) : !markets || markets.length === 0 ? (
          <EmptyState />
        ) : showEmpty ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-surface border border-wire py-12 text-center"
          >
            <div className="font-display text-3xl text-wire mb-2">NO {FILTER_LABELS[activeTab]} EPOCHS</div>
            <button
              onClick={() => setActiveTab("all")}
              className="font-mono text-[10px] text-gold hover:text-gold-bright mt-2 tracking-wider"
            >
              SHOW ALL
            </button>
          </motion.div>
        ) : (
          <div className="space-y-2.5">
            {[...filtered].reverse().map((m, i) => (
              <MarketCard key={m.id} market={m} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* Clearing price history */}
      {markets && markets.length > 0 && (
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-12"
        >
          <ClearingPriceHistory markets={markets} />
        </motion.section>
      )}
    </div>
  );
}
