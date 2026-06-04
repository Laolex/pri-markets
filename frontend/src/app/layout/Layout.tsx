import { useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { useFhe } from "@/hooks/useFhe";
import { useAppStore } from "@/store/appStore";
import { CONTRACT_ADDRESS } from "@/lib/contracts/config";

function FheStatus() {
  const { fheStatus } = useAppStore();
  if (fheStatus === "idle") return null;

  const isReady  = fheStatus === "ready";
  const isInit   = fheStatus === "initializing";

  return (
    <div className="hidden sm:flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${
        isReady ? "bg-teal shadow-glow-teal-sm" :
        isInit  ? "bg-gold animate-pulse-gold" :
        "bg-crimson"
      }`} />
      <span className={`font-mono text-[9px] tracking-widest ${
        isReady ? "text-teal/80" : isInit ? "text-gold/70" : "text-crimson/80"
      }`}>
        {isReady ? "FHE READY" : isInit ? "FHE INIT" : "FHE ERR"}
      </span>
    </div>
  );
}

const NAV_LINKS = [
  { to: "/",       label: "MARKETS" },
  { to: "/create", label: "NEW EPOCH" },
];

export function Layout() {
  useFhe();
  const location = useLocation();
  const { txStatus, clearTxStatus } = useAppStore();

  // Auto-dismiss terminal toasts (success ✓ / error) after a few seconds so they don't
  // linger forever. In-progress statuses (ending in …) persist until the flow updates them.
  useEffect(() => {
    if (!txStatus) return;
    const terminal = txStatus.includes("✓") || txStatus.startsWith("Error:");
    if (!terminal) return;
    const t = setTimeout(clearTxStatus, 5000);
    return () => clearTimeout(t);
  }, [txStatus, clearTxStatus]);

  return (
    <div className="min-h-screen bg-void text-ink-primary font-body relative">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-wire/60 bg-void/90 backdrop-blur-md">
        {/* Subtle top glow line */}
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gold/30 to-transparent" />

        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-baseline gap-3 group flex-shrink-0">
            <div className="relative">
              <span
                className="font-display text-[26px] text-gold leading-none tracking-widest transition-all duration-300 group-hover:text-gold-bright"
                style={{ textShadow: "0 0 20px rgba(196,153,59,0.3)" }}
              >
                CBC
              </span>
            </div>
            <span className="font-mono text-[9px] text-ink-dim tracking-widest hidden sm:block leading-none">
              CONFIDENTIAL<br />BATCH CLEARING
            </span>
          </Link>

          {/* Nav */}
          <nav className="flex items-center">
            {NAV_LINKS.map(({ to, label }) => {
              const active = location.pathname === to;
              return (
                <Link
                  key={to}
                  to={to}
                  className={`relative font-mono text-[10px] tracking-widest px-4 py-2 transition-colors duration-200 ${
                    active ? "text-gold" : "text-ink-secondary hover:text-ink-primary"
                  }`}
                >
                  {label}
                  {active && (
                    <motion.div
                      layoutId="nav-underline"
                      className="absolute bottom-0 left-2 right-2 h-px bg-gold"
                      style={{ boxShadow: "0 0 8px rgba(196,153,59,0.6)" }}
                    />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-4 flex-shrink-0">
            <FheStatus />
            <ConnectWalletButton />
          </div>
        </div>

        {/* Tx status ticker */}
        <AnimatePresence>
          {txStatus && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-gold/20 bg-gold-faint"
            >
              <div className="px-6 py-1.5 flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-gold animate-pulse-gold flex-shrink-0" />
                <span className="font-mono text-[10px] tracking-wider text-gold">{txStatus}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ── Main ───────────────────────────────────────────── */}
      <NetworkGuard>
        <main className="max-w-5xl mx-auto px-6 py-10 relative z-10">
          <Outlet />
        </main>
      </NetworkGuard>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-wire/50 mt-20 py-10 px-6 relative z-10">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <div className="font-display text-2xl text-gold-dim tracking-widest mb-2">
              CBC PROTOCOL
            </div>
            <p className="font-body text-[12px] text-ink-dim max-w-sm leading-relaxed">
              No directional information observable during accumulation. Settlement via FHE.select —
              side never exposed. Residual V1 inference occurs post-settlement via payout observation.
            </p>
          </div>

          <div className="space-y-3 text-right">
            <div>
              <div className="data-label mb-1">CONTRACT</div>
              <a
                href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="addr-display hover:text-gold transition-colors duration-200"
              >
                {CONTRACT_ADDRESS}
              </a>
              <div className="font-mono text-[9px] text-ink-dim mt-0.5">SEPOLIA TESTNET</div>
            </div>
            <div>
              <div className="data-label mb-1">NEED SEPOLIA ETH?</div>
              <div className="flex items-center gap-3 justify-end">
                <a
                  href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[10px] text-teal hover:text-white transition-colors"
                >
                  Google Faucet ↗
                </a>
                <span className="text-wire">·</span>
                <a
                  href="https://sepolia-faucet.pk910.de/"
                  target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[10px] text-teal hover:text-white transition-colors"
                >
                  PoW Faucet ↗
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
