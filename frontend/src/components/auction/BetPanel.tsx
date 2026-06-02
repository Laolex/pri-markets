import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { motion } from "framer-motion";
import { usePlaceBetToken } from "@/hooks/usePlaceBetToken";
import { useMintUsdc } from "@/hooks/useMintUsdc";
import { usePosition } from "@/hooks/useMarkets";
import { useAppStore } from "@/store/appStore";
import { Spinner } from "@/components/ui/Spinner";
import { SIDE_YES, SIDE_NO, CUSDC_TOKEN, USDC_TOKEN } from "@/types";

interface BetPanelProps {
  marketId:   number;
  onSuccess?: () => void;
}

function SideSelector({ side, onChange, disabled }: {
  side: number;
  onChange: (s: number) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <div className="data-label mb-3">SELECT POSITION</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onChange(SIDE_YES)}
          disabled={disabled}
          className={`py-3.5 font-mono text-[13px] tracking-widest transition-all border ${
            side === SIDE_YES
              ? "bg-teal/10 border-teal text-teal"
              : "bg-transparent border-wire text-ink-dim hover:border-ink-secondary hover:text-ink-secondary"
          }`}
        >
          YES ▲
        </button>
        <button
          onClick={() => onChange(SIDE_NO)}
          disabled={disabled}
          className={`py-3.5 font-mono text-[13px] tracking-widest transition-all border ${
            side === SIDE_NO
              ? "bg-crimson/10 border-crimson text-crimson"
              : "bg-transparent border-wire text-ink-dim hover:border-ink-secondary hover:text-ink-secondary"
          }`}
        >
          NO ▼
        </button>
      </div>
    </div>
  );
}

// ── cUSDC bet panel (token-only V2; supports top-ups) ──────────────────────

export function BetPanel({ marketId, onSuccess }: BetPanelProps) {
  const { isConnected, address } = useAccount();
  const { fheStatus } = useAppStore();
  const { placeBetToken, isPending, error } = usePlaceBetToken();
  const { mintUsdc, refreshBalance, balance, isPending: minting, faucetAmount } = useMintUsdc();
  const { data: position } = usePosition(marketId, address);
  const [side, setSide]     = useState<number>(SIDE_YES);
  const [amount, setAmount] = useState("1");
  const fheReady = fheStatus === "ready";
  const hasPosition = !!position?.exists;
  const lowBalance = balance !== null && Number(balance) < Number(amount || "0");

  useEffect(() => {
    if (isConnected && address) void refreshBalance();
  }, [isConnected, address, refreshBalance]);

  if (!isConnected) {
    return (
      <div className="py-6 text-center">
        <div className="font-mono text-[10px] tracking-widest text-ink-dim mb-2">AUTHENTICATION REQUIRED</div>
        <p className="font-body text-ink-secondary text-[14px]">Connect wallet to place a sealed bid.</p>
      </div>
    );
  }

  async function handleSubmit() {
    await placeBetToken(
      marketId, side, amount,
      USDC_TOKEN  as `0x${string}`,
      CUSDC_TOKEN as `0x${string}`
    );
    onSuccess?.();
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {/* Token badge */}
      <div className="flex items-center gap-2 px-3 py-2 border border-teal/30 bg-teal-faint">
        <span className="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0" />
        <div>
          <div className="font-mono text-[10px] text-teal tracking-widest">cUSDC MARKET — ENCRYPTED AMOUNTS</div>
          <p className="font-mono text-[9px] text-ink-dim mt-0.5">
            Both direction AND amount are encrypted. Settlement is single-step — payout never revealed in plaintext.
          </p>
        </div>
      </div>

      {/* Top-up affordance — you already hold a sealed position in this market */}
      {hasPosition && (
        <div className="flex items-center gap-2 px-3 py-2 border border-gold-dim/40 bg-gold/5">
          <span className="w-1.5 h-1.5 rounded-full bg-gold flex-shrink-0" />
          <p className="font-mono text-[9px] text-ink-dim">
            You already hold a sealed stake here. This bid <span className="text-gold">adds to your position</span> —
            stakes accumulate in your encrypted YES/NO sub-pools, and you may bet either side.
          </p>
        </div>
      )}

      <SideSelector side={side} onChange={setSide} disabled={isPending} />

      <div>
        <div className="data-label mb-2">CAPITAL COMMITMENT (USDC)</div>
        <div className="relative">
          <input
            type="number" step="1" min="0.01"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            disabled={isPending} className="intel-input pr-16" placeholder="1"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-ink-dim">USDC</span>
        </div>
        <p className="font-mono text-[10px] text-ink-dim mt-1.5">
          Amount is encrypted. First bid: approve → wrap → authorize → seal (4 txns); top-ups skip authorize.
        </p>

        {/* Test USDC faucet — USDCMock has an open mint() on Sepolia */}
        <div className="flex items-center justify-between gap-2 mt-2 px-3 py-2 border border-wire bg-black/20">
          <span className="font-mono text-[10px] text-ink-dim">
            Test balance:{" "}
            <span className={lowBalance ? "text-crimson" : "text-ink-secondary"}>
              {balance === null ? "…" : `${Number(balance).toLocaleString()} USDC`}
            </span>
          </span>
          <button
            onClick={() => void mintUsdc()}
            disabled={minting || isPending}
            className="font-mono text-[10px] tracking-widest text-teal border border-teal/40 px-2.5 py-1 hover:bg-teal/10 transition-colors disabled:opacity-50"
          >
            {minting ? "MINTING…" : `+ MINT ${Number(faucetAmount).toLocaleString()} USDC`}
          </button>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={isPending || !fheReady}
        className="btn-gold w-full flex items-center justify-center gap-3"
      >
        {isPending ? (
          <><Spinner size={14} /><span>APPROVING + WRAPPING + SEALING</span></>
        ) : (
          <><span className="text-[15px]">⬡</span><span>{hasPosition ? "ADD TO SEALED POSITION" : "SEAL & SUBMIT cUSDC BID"}</span></>
        )}
      </button>

      {error && <p className="font-mono text-[11px] text-crimson">{error}</p>}

      {!fheReady && (
        <div className="flex items-center gap-2 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-gold-dim animate-pulse-gold" />
          <span className="font-mono text-[10px] text-ink-dim">
            {fheStatus === "initializing" ? "INITIALIZING FHE RELAYER…" : "FHE OFFLINE — CONNECT WALLET"}
          </span>
        </div>
      )}
    </motion.div>
  );
}
