import { useState } from "react";
import { useAccount } from "wagmi";
import { motion } from "framer-motion";
import { usePlaceBet } from "@/hooks/usePlaceBet";
import { usePlaceBetToken } from "@/hooks/usePlaceBetToken";
import { useAppStore } from "@/store/appStore";
import { Spinner } from "@/components/ui/Spinner";
import { SIDE_YES, SIDE_NO, CUSDC_TOKEN, USDC_TOKEN } from "@/types";

interface BetPanelProps {
  marketId:       number;
  isTokenMarket?: boolean;
  onSuccess?:     () => void;
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

// ── ETH bet panel ──────────────────────────────────────────────────────────

function EthBetPanel({ marketId, onSuccess }: { marketId: number; onSuccess?: () => void }) {
  const { fheStatus } = useAppStore();
  const { placeBet, isPending } = usePlaceBet();
  const [side, setSide]     = useState<number>(SIDE_YES);
  const [amount, setAmount] = useState("0.01");
  const fheReady = fheStatus === "ready";

  async function handleSubmit() {
    await placeBet(marketId, side, amount);
    onSuccess?.();
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      <SideSelector side={side} onChange={setSide} disabled={isPending} />

      <div>
        <div className="data-label mb-2">CAPITAL COMMITMENT (ETH)</div>
        <div className="relative">
          <input
            type="number" step="0.001" min="0.001"
            value={amount} onChange={(e) => setAmount(e.target.value)}
            disabled={isPending} className="intel-input pr-12" placeholder="0.01"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-ink-dim">ETH</span>
        </div>
        <p className="font-mono text-[10px] text-ink-dim mt-1.5">
          Side is encrypted. Only commitment amount is public.
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={isPending || !fheReady}
        className="btn-gold w-full flex items-center justify-center gap-3"
      >
        {isPending ? (
          <><Spinner size={14} /><span>ENCRYPTING + SUBMITTING</span></>
        ) : (
          <><span className="text-[15px]">⬡</span><span>SEAL & SUBMIT BID</span></>
        )}
      </button>

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

// ── cUSDC token bet panel ─────────────────────────────────────────────────

function TokenBetPanel({ marketId, onSuccess }: { marketId: number; onSuccess?: () => void }) {
  const { fheStatus } = useAppStore();
  const { placeBetToken, isPending, error } = usePlaceBetToken();
  const [side, setSide]     = useState<number>(SIDE_YES);
  const [amount, setAmount] = useState("1");
  const fheReady = fheStatus === "ready";

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
          Amount is encrypted. Three transactions: USDC approve → wrap → sealed bid.
        </p>
      </div>

      <button
        onClick={handleSubmit}
        disabled={isPending || !fheReady}
        className="btn-gold w-full flex items-center justify-center gap-3"
      >
        {isPending ? (
          <><Spinner size={14} /><span>APPROVING + WRAPPING + SEALING</span></>
        ) : (
          <><span className="text-[15px]">⬡</span><span>SEAL & SUBMIT cUSDC BID</span></>
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

// ── Exported component ────────────────────────────────────────────────────

export function BetPanel({ marketId, isTokenMarket = false, onSuccess }: BetPanelProps) {
  const { isConnected } = useAccount();

  if (!isConnected) {
    return (
      <div className="py-6 text-center">
        <div className="font-mono text-[10px] tracking-widest text-ink-dim mb-2">AUTHENTICATION REQUIRED</div>
        <p className="font-body text-ink-secondary text-[14px]">Connect wallet to place a sealed bid.</p>
      </div>
    );
  }

  return isTokenMarket
    ? <TokenBetPanel marketId={marketId} onSuccess={onSuccess} />
    : <EthBetPanel   marketId={marketId} onSuccess={onSuccess} />;
}
