import { motion } from "framer-motion";

const rows = [
  { layer: "Bid direction (YES/NO)",  during: "SEALED",         after: "NEVER REVEALED",  seal: true,  revealed: false },
  { layer: "Total ETH volume",        during: "PUBLIC",         after: "PUBLIC",           seal: false, revealed: true  },
  { layer: "Participant count",       during: "PUBLIC",         after: "PUBLIC",           seal: false, revealed: true  },
  { layer: "YES / NO pool split",     during: "SEALED",         after: "SINGLE REVEAL",    seal: true,  revealed: true  },
  { layer: "Clearing price",          during: "—",              after: "AT EPOCH CLOSE",   seal: false, revealed: true  },
  { layer: "Individual payout",       during: "SEALED",         after: "RECIPIENT ONLY",   seal: true,  revealed: false },
];

export function PrivacyBoundary() {
  return (
    <div className="bg-surface border border-wire overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-wire flex items-center justify-between">
        <span className="section-header">Information Topology</span>
        <span className="font-mono text-[9px] text-ink-dim tracking-widest">
          CONFIDENTIALITY MODEL v1
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-3 border-b border-wire bg-base/50">
        {["Information Layer", "During Epoch", "After Close"].map((h, i) => (
          <div key={h} className={`px-5 py-2 data-label ${i > 0 ? "border-l border-wire" : ""}`}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div>
        {rows.map((r, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className={`grid grid-cols-3 ${i < rows.length - 1 ? "border-b border-wire/50" : ""} hover:bg-panel/40 transition-colors group`}
          >
            <div className="px-5 py-3.5 font-body text-[13px] text-ink-secondary group-hover:text-ink-primary transition-colors">
              {r.layer}
            </div>
            <div className={`px-5 py-3.5 border-l border-wire/50 font-mono text-[10px] tracking-wider font-medium flex items-center gap-2 ${
              r.during === "SEALED" ? "text-gold" :
              r.during === "PUBLIC" ? "text-ink-secondary" :
              "text-ink-dim"
            }`}>
              {r.during === "SEALED" && (
                <span className="inline-flex w-1.5 h-1.5 rounded-full bg-gold animate-pulse-gold flex-shrink-0" />
              )}
              {r.during}
            </div>
            <div className={`px-5 py-3.5 border-l border-wire/50 font-mono text-[10px] tracking-wider font-medium flex items-center gap-2 ${
              r.after === "NEVER REVEALED"  ? "text-ink-dim" :
              r.after === "RECIPIENT ONLY"  ? "text-teal" :
              r.after.includes("REVEAL") || r.after === "PUBLIC" ? "text-teal" :
              r.after === "AT EPOCH CLOSE"  ? "text-gold" :
              "text-ink-secondary"
            }`}>
              {r.after}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
