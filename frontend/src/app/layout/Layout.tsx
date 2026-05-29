import { Outlet, Link, useLocation } from "react-router-dom";
import { ConnectWalletButton } from "@/components/wallet/ConnectWalletButton";
import { NetworkGuard } from "@/components/wallet/NetworkGuard";
import { useFhe } from "@/hooks/useFhe";
import { useAppStore } from "@/store/appStore";
import { CONTRACT_ADDRESS } from "@/lib/contracts/config";

function FheStatus() {
  const { fheStatus } = useAppStore();
  if (fheStatus === "idle") return null;

  const color =
    fheStatus === "ready" ? "bg-teal" :
    fheStatus === "initializing" ? "bg-gold animate-pulse-gold" :
    "bg-crimson";

  const label =
    fheStatus === "ready" ? "FHE READY" :
    fheStatus === "initializing" ? "FHE INIT" :
    "FHE ERR";

  return (
    <div className="hidden sm:flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span className="font-mono text-[10px] tracking-widest text-ink-secondary">{label}</span>
    </div>
  );
}

export function Layout() {
  useFhe();
  const location = useLocation();
  const { txStatus } = useAppStore();

  return (
    <div className="min-h-screen bg-void text-ink-primary font-body">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-wire bg-void/95 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-baseline gap-3 group">
            <span className="font-display text-2xl text-gold tracking-widest leading-none">CBC</span>
            <span className="font-mono text-[10px] text-ink-dim tracking-widest hidden sm:block">
              CONFIDENTIAL BATCH CLEARING
            </span>
          </Link>

          {/* Nav */}
          <nav className="flex items-center gap-1">
            {[
              { to: "/", label: "MARKETS" },
              { to: "/create", label: "NEW EPOCH" },
            ].map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                className={`font-mono text-[10px] tracking-widest px-3 py-2 transition-colors ${
                  location.pathname === to
                    ? "text-gold border-b border-gold"
                    : "text-ink-secondary hover:text-ink-primary"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Right */}
          <div className="flex items-center gap-4">
            <FheStatus />
            <ConnectWalletButton />
          </div>
        </div>

        {/* Tx status ticker */}
        {txStatus && (
          <div className="border-t border-wire bg-gold-faint px-6 py-1.5">
            <span className="font-mono text-[10px] tracking-wider text-gold">{txStatus}</span>
          </div>
        )}
      </header>

      {/* Main */}
      <NetworkGuard>
        <main className="max-w-5xl mx-auto px-6 py-10">
          <Outlet />
        </main>
      </NetworkGuard>

      {/* Footer */}
      <footer className="border-t border-wire mt-20 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="font-display text-xl text-gold-dim tracking-widest mb-1">CBC PROTOCOL</div>
            <p className="font-body text-[12px] text-ink-dim max-w-md">
              No directional information observable during accumulation. Residual inference
              occurs post-settlement via payout observation. See MECHANISM.md.
            </p>
          </div>
          <div className="text-right space-y-2">
            <div>
              <div className="data-label mb-1">CONTRACT</div>
              <a
                href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
                className="addr-display hover:text-gold transition-colors"
              >
                {CONTRACT_ADDRESS}
              </a>
              <div className="font-mono text-[10px] text-ink-dim mt-0.5">SEPOLIA TESTNET</div>
            </div>
            <div>
              <div className="data-label mb-1">NEED SEPOLIA ETH?</div>
              <a
                href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-teal hover:text-white transition-colors"
              >
                Google Faucet ↗
              </a>
              <span className="font-mono text-[10px] text-ink-dim mx-2">·</span>
              <a
                href="https://sepolia-faucet.pk910.de/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10px] text-teal hover:text-white transition-colors"
              >
                PoW Faucet ↗
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
