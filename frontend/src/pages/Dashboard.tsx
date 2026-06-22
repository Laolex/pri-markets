import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { useAccount, useReadContract } from "wagmi";
import { Link } from "react-router-dom";
import { useMintUsdc } from "@/hooks/useMintUsdc";
import { useCusdcBalance } from "@/hooks/useCusdcBalance";
import { useWrap } from "@/hooks/useWrap";
import { useUnwrap } from "@/hooks/useUnwrap";
import { useMarkets } from "@/hooks/useMarkets";
import { useWrapperLifetime, useWrapperNet } from "@/hooks/useWrapperStats";
import { useAppStore } from "@/store/appStore";
import { Spinner } from "@/components/ui/Spinner";
import { CUSDC_ABI } from "@/lib/contracts/cusdc";
import { USDC_TOKEN, CUSDC_TOKEN } from "@/types";
import type { MarketView } from "@/types";

type Tab = "wrap" | "unwrap";

function fmtUsdc(human: string | null) {
  if (human === null) return "—";
  return Number(human).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function usd(raw: bigint) {
  return `${(Number(raw) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
}

function StatGrid({ title, note, cols, stats }: {
  title: string;
  note?: string;
  cols: string;
  stats: { label: string; value: string; accent?: boolean; loading?: boolean }[];
}) {
  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="font-mono text-[11px] tracking-widest text-ink-secondary uppercase">{title}</span>
        {note && <span className="font-mono text-[9px] text-ink-dim">{note}</span>}
      </div>
      <div className={`grid ${cols} gap-px bg-wire`}>
        {stats.map(({ label, value, accent, loading }) => (
          <div key={label} className="bg-surface px-4 py-3 text-center">
            <div className="data-label mb-1">{label}</div>
            <div className={`font-display text-[20px] leading-none ${accent ? "text-gold" : "text-ink-primary"}`}>
              {loading ? <span className="text-ink-dim">…</span> : value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Protocol stats: pri-markets user activity + cUSDC wrapper flows ──
function ProtocolStats({ markets }: { markets: MarketView[] }) {
  // pri-markets — bids are encrypted until reveal, so only revealed markets contribute volume.
  const revealed    = markets.filter(m => m.poolRevealed);
  const totalVol    = revealed.reduce((s, m) => s + m.revealedYesPool + m.revealedNoPool, 0n);
  const uniqueUsers = markets.reduce((s, m) => s + m.bettorCount, 0n);
  const totalBids   = markets.reduce((s, m) => s + m.betCount, 0n);

  // cUSDC wrapper — net (cheap read) + lifetime cumulative (cached event scan).
  const { data: net } = useWrapperNet();
  const { data: life, isLoading: lifeLoading } = useWrapperLifetime();

  return (
    <div className="mt-12">
      <StatGrid
        title="Pri-Markets · User Activity"
        note="volume from revealed epochs only"
        cols="grid-cols-3"
        stats={[
          { label: "TOTAL VOLUME", value: usd(totalVol), accent: totalVol > 0n },
          { label: "UNIQUE USERS", value: uniqueUsers.toString() },
          { label: "TOTAL BIDS",   value: totalBids.toString() },
        ]}
      />
      <StatGrid
        title="cUSDC Wrapper · Flows"
        note={`token-wide${life?.partial ? " · partial (RPC-limited scan)" : ""}`}
        cols="grid-cols-3"
        stats={[
          { label: "NET WRAPPED",      value: net !== undefined ? usd(net as bigint) : "…", accent: true },
          { label: "LIFETIME WRAPPED", value: life ? usd(life.wrapped) : "…",   loading: lifeLoading },
          { label: "LIFETIME UNWRAPPED", value: life ? usd(life.unwrapped) : "…", loading: lifeLoading },
        ]}
      />
    </div>
  );
}

// ── A single balance card ───────────────────────────────────────────────────
function BalanceCard({
  label, symbol, accent, children,
}: { label: string; symbol: string; accent: "gold" | "teal"; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-wire p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-px ${
        accent === "gold"
          ? "bg-gradient-to-r from-transparent via-gold/50 to-transparent"
          : "bg-gradient-to-r from-transparent via-teal/50 to-transparent"
      }`} />
      <div className="flex items-center justify-between mb-3">
        <div className="data-label">{label}</div>
        <span className={`font-mono text-[10px] tracking-widest ${accent === "gold" ? "text-gold" : "text-teal"}`}>
          {symbol}
        </span>
      </div>
      {children}
    </div>
  );
}

export function Dashboard() {
  const { address, isConnected } = useAccount();
  const { fheStatus } = useAppStore();

  // USDC — clear balance + faucet
  const { mintUsdc, refreshBalance, balance: usdcBalance, isPending: minting, faucetAmount } = useMintUsdc();
  // cUSDC — encrypted; ciphertext until the user signs to reveal
  const { balance: cusdcBalance, reveal, clear: clearCusdc, isPending: revealing, error: revealError } = useCusdcBalance();

  const { wrap,   isPending: wrapping }   = useWrap();
  const { unwrap, isPending: unwrapping } = useUnwrap();

  const { data: markets } = useMarkets();

  const [tab, setTab] = useState<Tab>("wrap");
  const [amount, setAmount] = useState("");
  const [actionErr, setActionErr] = useState<string | null>(null);

  // Deny-list pre-flight — a blocked wallet would revert on wrap/unwrap.
  const { data: blocked } = useReadContract({
    address: CUSDC_TOKEN as `0x${string}`,
    abi: CUSDC_ABI,
    functionName: "isBlocked",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });

  const refreshUsdc = useCallback(() => { void refreshBalance(); }, [refreshBalance]);

  useEffect(() => { if (address) refreshUsdc(); }, [address, refreshUsdc]);

  const busy = wrapping || unwrapping;
  const fheReady = fheStatus === "ready";

  async function handleAction() {
    setActionErr(null);
    try {
      if (tab === "wrap") await wrap(amount);
      else                await unwrap(amount);
      setAmount("");
      refreshUsdc();
      clearCusdc(); // balance changed — drop the stale reveal, user re-signs to see the new figure
    } catch (e) {
      setActionErr((e as { shortMessage?: string; message?: string })?.shortMessage
        ?? (e as Error)?.message ?? "Transaction failed");
    }
  }

  if (!isConnected) {
    return (
      <div className="py-24 text-center">
        <div className="font-display text-5xl text-wire mb-4 tracking-widest">WALLET REQUIRED</div>
        <p className="font-body text-ink-secondary text-[14px]">
          Connect a Sepolia wallet to view balances and convert USDC ↔ cUSDC.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Header */}
      <div className="flex items-end justify-between mb-2">
        <h1 className="font-display text-4xl tracking-widest text-ink-primary">DASHBOARD</h1>
        <span className="font-mono text-[10px] text-ink-dim tracking-widest hidden sm:block">
          USDC ↔ cUSDC · 1:1 · SEPOLIA
        </span>
      </div>
      <p className="font-body text-[13px] text-ink-secondary mb-8 max-w-lg">
        Your public USDC and confidential cUSDC balances. Wrap to obtain encrypted cUSDC for sealed
        bids; unwrap to redeem it back to USDC. The cUSDC balance is ciphertext until you sign to reveal it.
      </p>

      {blocked && (
        <div className="mb-6 px-4 py-3 border border-crimson/30 bg-crimson/[0.05] font-mono text-[11px] text-crimson">
          This wallet is on the cUSDC deny-list — wrap/unwrap will revert.
        </div>
      )}

      {/* Balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BalanceCard label="PUBLIC BALANCE" symbol="USDC" accent="gold">
          <div className="font-display text-[34px] leading-none text-ink-primary mb-4">
            {fmtUsdc(usdcBalance)}
          </div>
          <button
            onClick={() => mintUsdc().then(refreshUsdc).catch(() => {})}
            disabled={minting}
            className="btn-ghost flex items-center gap-2 text-[11px]"
          >
            {minting ? <><Spinner size={12} /><span>MINTING…</span></> : <span>＋ FAUCET {faucetAmount} USDC</span>}
          </button>
        </BalanceCard>

        <BalanceCard label="CONFIDENTIAL BALANCE" symbol="cUSDC" accent="teal">
          {cusdcBalance === null ? (
            <>
              <div
                className="font-display text-[34px] leading-none text-teal/40 mb-4 select-none tracking-widest"
                aria-label="hidden encrypted balance"
              >
                ●●●●●
              </div>
              <button
                onClick={() => { void reveal(); }}
                disabled={revealing || !fheReady}
                className="btn-ghost flex items-center gap-2 text-[11px]"
                title={!fheReady ? "FHE relayer initializing…" : undefined}
              >
                {revealing
                  ? <><Spinner size={12} /><span>DECRYPTING…</span></>
                  : <span>⬡ REVEAL (sign)</span>}
              </button>
            </>
          ) : (
            <>
              <div className="font-display text-[34px] leading-none text-teal mb-4">
                {fmtUsdc(cusdcBalance)}
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => { void reveal(); }} disabled={revealing}
                  className="font-mono text-[10px] text-ink-dim hover:text-teal tracking-wider transition-colors">
                  ↻ REFRESH
                </button>
                <span className="font-mono text-[9px] text-ink-dim">decrypted client-side · visible only to you</span>
              </div>
            </>
          )}
          {revealError && <p className="font-mono text-[10px] text-crimson mt-2">{revealError}</p>}
        </BalanceCard>
      </div>

      {/* Converter */}
      <div className="bg-surface border border-wire mt-4">
        {/* Tabs */}
        <div className="grid grid-cols-2">
          {(["wrap", "unwrap"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setAmount(""); setActionErr(null); }}
              className={`font-mono text-[11px] tracking-widest py-3 border-b-2 transition-all ${
                tab === t
                  ? "border-gold text-gold bg-gold-faint"
                  : "border-transparent text-ink-dim hover:text-ink-secondary"
              }`}
            >
              {t === "wrap" ? "WRAP  USDC → cUSDC" : "UNWRAP  cUSDC → USDC"}
            </button>
          ))}
        </div>

        <div className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <input
              type="number" min="0" step="any" placeholder="0.00"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setActionErr(null); }}
              disabled={busy}
              className="input-field flex-1"
            />
            <button
              onClick={() => { if (tab === "wrap" && usdcBalance) setAmount(usdcBalance); }}
              disabled={busy || tab === "unwrap"}
              className="btn-ghost text-[10px] px-3 py-2 disabled:opacity-40"
              title={tab === "unwrap" ? "Reveal your cUSDC balance to use MAX" : undefined}
            >
              MAX
            </button>
          </div>

          <button
            onClick={handleAction}
            disabled={busy || !amount || Number(amount) <= 0 || (tab === "unwrap" && !fheReady) || !!blocked}
            className="btn-gold w-full flex items-center justify-center gap-2"
          >
            {busy
              ? <><Spinner size={14} /><span>{tab === "wrap" ? "WRAPPING" : "UNWRAPPING"}</span></>
              : <span>{tab === "wrap" ? "WRAP TO cUSDC" : "UNWRAP TO USDC"}</span>}
          </button>

          {tab === "unwrap" && (
            <p className="font-mono text-[9px] text-ink-dim mt-3 leading-relaxed">
              Two-phase withdrawal: phase 1 burns encrypted cUSDC; phase 2 finalizes after the KMS
              decrypts the amount and releases USDC. Both steps are signed automatically.
            </p>
          )}
          {actionErr && <p className="font-mono text-[10px] text-crimson mt-3">{actionErr}</p>}
        </div>
      </div>

      {/* Token addresses */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-wire mt-4">
        {[
          { label: "USDC (UNDERLYING)", addr: USDC_TOKEN },
          { label: "cUSDC (WRAPPER)",   addr: CUSDC_TOKEN },
        ].map(({ label, addr }) => (
          <a
            key={addr}
            href={`https://sepolia.etherscan.io/address/${addr}`}
            target="_blank" rel="noopener noreferrer"
            className="bg-surface px-4 py-3 group"
          >
            <div className="data-label mb-1">{label}</div>
            <div className="addr-display group-hover:text-gold transition-colors">{addr}</div>
          </a>
        ))}
      </div>

      {/* Protocol stats */}
      <ProtocolStats markets={markets ?? []} />

      <div className="mt-8 text-center">
        <Link to="/" className="font-mono text-[10px] text-ink-dim hover:text-gold tracking-widest transition-colors">
          ← BACK TO EPOCHS
        </Link>
      </div>
    </motion.div>
  );
}
