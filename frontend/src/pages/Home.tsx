import { motion } from "framer-motion";
import { useMarkets, useMarketCount } from "@/hooks/useMarkets";
import { MarketCard } from "@/components/market/MarketCard";
import { ClearingPriceHistory } from "@/components/market/ClearingPriceHistory";
import { Spinner } from "@/components/ui/Spinner";
import { PrivacyBoundary } from "@/components/ui/PrivacyBoundary";
import { useAccount } from "wagmi";
import { Link } from "react-router-dom";

const PILLARS = [
  {
    id: "01",
    title: "SEALED ACCUMULATION",
    desc: "Directional intent accumulates privately. No bid is observable during the epoch window.",
  },
  {
    id: "02",
    title: "AGGREGATE REVEAL",
    desc: "YES/NO split published once at epoch close — P_t^dir = ∅ for all t < t_close.",
  },
  {
    id: "03",
    title: "FHE SETTLEMENT",
    desc: "Payout computed via FHE.select. Your side is never revealed on-chain, ever.",
  },
];

function Hero() {
  return (
    <section className="pt-4 pb-16">
      {/* Classification stamp */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="flex items-center gap-3 mb-10"
      >
        <div className="h-px flex-1 bg-wire" />
        <span className="font-mono text-[10px] tracking-widest2 text-ink-dim">
          CBC / SEALED-BID / FHEVM / SEPOLIA
        </span>
        <div className="h-px flex-1 bg-wire" />
      </motion.div>

      {/* Main headline */}
      <div className="mb-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="font-display text-[72px] sm:text-[96px] leading-none tracking-widest text-ink-primary">
            SEALED
          </h1>
          <h1 className="font-display text-[72px] sm:text-[96px] leading-none tracking-widest text-gold">
            CAPITAL.
          </h1>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="font-body text-[16px] text-ink-secondary leading-relaxed max-w-xl mt-6"
        >
          Traditional prediction markets leak directional flow continuously — creating reflexive
          momentum, copy-trading, and pre-settlement signaling. This protocol accumulates
          sealed bids and reveals only aggregate clearing price at epoch close.
        </motion.p>
      </div>

      {/* Three pillars */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-wire"
      >
        {PILLARS.map(({ id, title, desc }) => (
          <div key={id} className="bg-void p-5">
            <div className="font-mono text-[10px] text-ink-dim mb-3">{id} /</div>
            <div className="font-mono text-[11px] tracking-widest text-gold mb-2">{title}</div>
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
      <div className="font-display text-5xl text-wire mb-4">NO EPOCHS</div>
      <p className="font-body text-ink-secondary text-[14px] mb-6">
        No information markets have been initialized.
      </p>
      <Link to="/create" className="btn-gold">
        INITIALIZE FIRST EPOCH
      </Link>
    </motion.div>
  );
}

export function Home() {
  const { isConnected } = useAccount();
  const { data: count } = useMarketCount();
  const { data: markets, isLoading } = useMarkets();
  const n = count ? Number(count) : 0;

  return (
    <div>
      {!isConnected && <Hero />}

      {/* Judge onboarding strip — visible when disconnected and markets exist */}
      {!isConnected && n > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.4 }}
          className="mb-8 border border-teal/30 bg-teal-faint px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-teal mt-1.5 flex-shrink-0 animate-pulse-gold" />
            <div>
              <div className="font-mono text-[10px] tracking-widest text-teal mb-1">
                {n} LIVE EPOCH{n !== 1 ? "S" : ""} — SEALED POOLS ACCUMULATING
              </div>
              <p className="font-body text-[13px] text-ink-secondary">
                Connect a Sepolia wallet to place a sealed bid. Need ETH?{" "}
                <a
                  href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal underline underline-offset-2 hover:text-white transition-colors"
                >
                  Google Faucet
                </a>
                {" or "}
                <a
                  href="https://sepolia-faucet.pk910.de/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal underline underline-offset-2 hover:text-white transition-colors"
                >
                  PoW Faucet
                </a>
                .
              </p>
            </div>
          </div>
          <div className="font-mono text-[10px] text-ink-dim flex-shrink-0">
            MIN BET: 0.001 ETH
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

      {/* Epoch listing */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl tracking-widest text-ink-primary">EPOCHS</span>
            {n > 0 && (
              <span className="font-mono text-[11px] text-ink-dim">
                {n} TOTAL
              </span>
            )}
          </div>
          <Link to="/create" className="btn-ghost text-[10px] px-4 py-1.5">
            + NEW EPOCH
          </Link>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-3">
            <Spinner size={20} />
            <span className="font-mono text-[11px] text-ink-secondary tracking-wider">
              LOADING EPOCHS
            </span>
          </div>
        ) : !markets || markets.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-2">
            {[...markets].reverse().map((m, i) => (
              <MarketCard key={m.id} market={m} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* Clearing price history — only shows when epochs have been revealed */}
      {markets && markets.length > 0 && (
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="mt-10"
        >
          <ClearingPriceHistory markets={markets} />
        </motion.section>
      )}
    </div>
  );
}
