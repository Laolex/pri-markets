import { useClaim } from "@/hooks/useClaim";
import { useClaimToken } from "@/hooks/useClaimToken";
import { useAppStore } from "@/store/appStore";
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

function EthClaimPanel({ marketId, position, onSuccess }: {
  marketId: number;
  position: PositionView;
  onSuccess?: () => void;
}) {
  const { fheStatus } = useAppStore();
  const { claim, isPending, error } = useClaim(marketId);
  const fheReady = fheStatus === "ready";

  return (
    <div className="space-y-3">
      <div>
        <div className="data-label mb-1">CONFIDENTIAL SETTLEMENT (ETH)</div>
        <p className="font-body text-[13px] text-ink-secondary">
          Payout computed via FHE.select — your YES/NO side is never exposed. Only the ETH amount settles.
        </p>
      </div>
      <button
        onClick={() => claim(position.payoutRequested).then(() => onSuccess?.())}
        disabled={isPending || !fheReady}
        className="btn-gold flex items-center gap-3"
      >
        {isPending ? (
          <><Spinner size={14} /><span>COMPUTING PAYOUT</span></>
        ) : (
          "CLAIM ETH SETTLEMENT"
        )}
      </button>
      {error && <p className="font-mono text-[11px] text-crimson">{error}</p>}
    </div>
  );
}

function TokenClaimPanel({ marketId, onSuccess }: {
  marketId: number;
  onSuccess?: () => void;
}) {
  const { claimToken, isPending, error } = useClaimToken(marketId);

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
        <div>MECHANISM: FHE.select(won, encAmount × totalPool / winPool, 0)</div>
        <div>SETTLEMENT: confidentialTransfer → cUSDC balance updated privately</div>
        <div>SIDE: never decrypted — not even at settlement</div>
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

export function ClaimPanel({ marketId, position, poolRevealed, onSuccess }: ClaimPanelProps) {
  if (!poolRevealed) return null;

  if (position.claimed) return <SettledBadge />;

  return position.isToken
    ? <TokenClaimPanel marketId={marketId} onSuccess={onSuccess} />
    : <EthClaimPanel   marketId={marketId} position={position} onSuccess={onSuccess} />;
}
