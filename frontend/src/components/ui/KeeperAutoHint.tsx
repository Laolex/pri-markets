// The protocol keeper (server-side) auto-resolves oracle epochs and reveals pools shortly
// after each epoch closes. These on-page actions are permissionless fallbacks, so we frame
// them as "the keeper usually handles this" rather than implying the user must act — while
// still leaving the manual control available if the keeper is slow or offline.
export function KeeperAutoHint({ action }: { action: string }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2 border border-teal/25 bg-teal-faint">
      <span className="w-1.5 h-1.5 rounded-full bg-teal flex-shrink-0 mt-1 animate-pulse-gold" />
      <p className="font-mono text-[9px] leading-relaxed text-ink-dim">
        <span className="text-teal tracking-widest">⬡ KEEPER ACTIVE</span> — the protocol keeper
        auto-runs this within ~30s of epoch close. You can also{" "}
        <span className="text-ink-secondary">{action}</span> manually below if it hasn't completed yet.
      </p>
    </div>
  );
}
