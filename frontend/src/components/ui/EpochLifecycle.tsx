import { motion } from "framer-motion";
import type { EpochStatus } from "@/types";

const STEPS: { label: string; sub: string; status: EpochStatus }[] = [
  { label: "ACCUMULATING",       sub: "Sealed capital flowing in",         status: "accumulating" },
  { label: "EPOCH CLOSED",       sub: "No new bids accepted",              status: "closed" },
  { label: "RESOLVED",           sub: "Outcome committed on-chain",        status: "resolving" },
  { label: "AGGREGATE REVEAL",   sub: "YES / NO split decrypted once",     status: "revealing" },
  { label: "CLEARING · SETTLE",  sub: "Price live · claim payouts",        status: "revealed" },
];

const ORDER: EpochStatus[] = ["accumulating", "closed", "resolving", "revealing", "revealed"];

function stepState(current: EpochStatus, step: EpochStatus) {
  const ci = ORDER.indexOf(current);
  const si = ORDER.indexOf(step);
  if (ci > si) return "done";
  if (ci === si) return "active";
  return "pending";
}

function HexDot({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <div className="hex-step w-6 h-6 bg-teal/20 border border-teal/60 flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M2 5l2.5 2.5 4-4" stroke="#2EC4B6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (state === "active") {
    return (
      <div className="relative flex-shrink-0 w-6 h-6 flex items-center justify-center">
        <span className="absolute w-4 h-4 rounded-full bg-gold/20 animate-ring-expand" />
        <span className="absolute w-4 h-4 rounded-full bg-gold/15 animate-ring-expand-2" />
        <div className="hex-step w-6 h-6 bg-gold/15 border border-gold/70 flex-shrink-0 relative z-10">
          <div className="w-2 h-2 rounded-full bg-gold animate-pulse-gold" />
        </div>
      </div>
    );
  }
  return (
    <div className="hex-step w-6 h-6 bg-surface border border-wire/60 flex-shrink-0">
      <div className="w-1.5 h-1.5 rounded-full bg-ink-dim/40" />
    </div>
  );
}

export function EpochLifecycle({ status }: { status: EpochStatus }) {
  const currentIdx = ORDER.indexOf(status);

  return (
    <div className="px-5 py-4">
      <div className="relative">
        {/* Vertical connector track */}
        <div
          className="absolute left-[11px] top-3 bottom-3 w-px bg-wire"
          aria-hidden="true"
        />
        {/* Filled portion */}
        {currentIdx > 0 && (
          <motion.div
            className="absolute left-[11px] top-3 w-px timeline-line-done"
            initial={{ height: 0 }}
            animate={{ height: `${Math.min(currentIdx / (STEPS.length - 1), 1) * 100}%` }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden="true"
          />
        )}

        <div className="space-y-1">
          {STEPS.map(({ label, sub, status: s }, i) => {
            const state = stepState(status, s);
            const delay = i * 0.06;

            return (
              <motion.div
                key={s}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className={`flex items-start gap-4 px-1 py-2.5 rounded-sm transition-colors relative ${
                  state === "active" ? "bg-gold/[0.03]" : ""
                }`}
              >
                <HexDot state={state} />

                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-[11px] tracking-widest ${
                      state === "active"  ? "text-gold" :
                      state === "done"    ? "text-teal" :
                      "text-ink-dim"
                    }`}>
                      {label}
                    </span>
                    {state === "done" && (
                      <span className="font-mono text-[9px] text-teal/60 tracking-wider">COMPLETE</span>
                    )}
                    {state === "active" && (
                      <span className="font-mono text-[9px] text-gold/70 tracking-wider animate-pulse-gold">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className={`font-body text-[12px] mt-0.5 ${
                    state === "active" ? "text-ink-secondary" : "text-ink-dim"
                  }`}>
                    {sub}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
