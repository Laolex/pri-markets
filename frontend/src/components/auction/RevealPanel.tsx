import { useRevealPools } from "@/hooks/useReveal";
import { Spinner } from "@/components/ui/Spinner";
import { KeeperAutoHint } from "@/components/ui/KeeperAutoHint";
import { useAppStore } from "@/store/appStore";
import type { MarketView } from "@/types";

interface RevealPanelProps {
  market: MarketView;
  onSuccess?: () => void;
}

export function RevealPanel({ market, onSuccess }: RevealPanelProps) {
  const { fheStatus } = useAppStore();
  const { revealPools, isPending, error } = useRevealPools(market.id);
  const fheReady = fheStatus === "ready";

  if (market.poolRevealed) return null;
  if (market.epochStatus !== "resolving" && market.epochStatus !== "revealing") return null;

  return (
    <div className="space-y-3">
      <div>
        <div className="data-label mb-1">AGGREGATE POOL REVEAL</div>
        <p className="font-body text-[13px] text-ink-secondary">
          Decrypt and publish YES/NO pool composition. Directional split becomes public exactly once.
        </p>
      </div>

      {/* Pool reveal is permissionless and the protocol keeper runs it automatically —
          the manual button is a fallback while the keeper catches up (or if it's offline). */}
      <KeeperAutoHint action="reveal these pools" />

      <button
        onClick={() => revealPools(market.poolRevealRequested).then(() => onSuccess?.()).catch(() => {})}
        disabled={isPending || !fheReady}
        className="btn-gold flex items-center gap-3"
      >
        {isPending ? (
          <>
            <Spinner size={14} />
            <span>DECRYPTING POOLS</span>
          </>
        ) : (
          "DECLASSIFY AGGREGATE POOLS (manual)"
        )}
      </button>
      {error && (
        <p className="font-mono text-[11px] text-crimson">{error}</p>
      )}
    </div>
  );
}
