import { useClaimToken } from "@/hooks/useClaimToken";
import { Spinner } from "@/components/ui/Spinner";
import type { PositionView } from "@/types";

interface ClaimPanelProps {
  marketId:     number;
  position:     PositionView;
  poolRevealed: boolean;
  onSuccess?:   () => void;
}

function SettledBadge() {
  return (
    <div className="flex items-center gap-3 p-4 border border-teal/30 bg-teal-faint">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M3 8l4 4 6-6" stroke="#2EC4B6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <div className="font-mono text-[11px] text-teal tracking-wider">SETTLEMENT COMPLETE</div>
        <div className="font-body text-[12px] text-ink-secondary mt-0.5">
          Your directional choice was never revealed on-chain.
        </div>
      </div>
    </div>
  );
}

export function ClaimPanel({ marketId, position, poolRevealed, onSuccess }: ClaimPanelProps) {
  const { claimToken, isPending, error } = useClaimToken(marketId);

  if (!poolRevealed) return null;
  if (position.claimed) return <SettledBadge />;

  return (
    <div className="space-y-3">
      <div>
        <div className="data-label mb-1">CONFIDENTIAL SETTLEMENT (cUSDC)</div>
        <p className="font-body text-[13px] text-ink-secondary">
          Single-step FHE settlement. Payout computed entirely inside the coprocessor —
          your side and payout amount are never written to plaintext storage.
        </p>
      </div>
      <div className="px-4 py-3 border border-teal/20 bg-teal-faint font-mono text-[9px] text-teal space-y-1">
        <div>MECHANISM: payout = winningStake × totalPool / winPool (coprocessor)</div>
        <div>SETTLEMENT: confidentialTransfer → cUSDC balance updated privately</div>
        <div>SIDE: never decrypted — settlement reads your winning sub-pool directly</div>
      </div>
      <button
        onClick={() => claimToken().then(() => onSuccess?.())}
        disabled={isPending}
        className="btn-gold flex items-center gap-3"
      >
        {isPending ? (
          <><Spinner size={14} /><span>SETTLING cUSDC</span></>
        ) : (
          <><span className="text-[15px]">⬡</span><span>CLAIM cUSDC SETTLEMENT</span></>
        )}
      </button>
      {error && <p className="font-mono text-[11px] text-crimson">{error}</p>}
    </div>
  );
}
