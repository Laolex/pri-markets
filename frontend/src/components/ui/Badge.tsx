import type { ReactNode } from "react";

type Variant = "gold" | "teal" | "crimson" | "dim" | "active";

const variants: Record<Variant, string> = {
  gold:    "bg-gold-faint text-gold border-gold-border",
  teal:    "bg-teal-faint text-teal border-teal-dim/40",
  crimson: "bg-crimson/10 text-crimson border-crimson/30",
  dim:     "bg-surface text-ink-secondary border-wire",
  active:  "bg-gold text-void border-gold",
};

export function Badge({ children, variant = "dim" }: { children: ReactNode; variant?: Variant }) {
  if (variant === "active") {
    return (
      <span className="relative inline-flex items-center gap-1.5 status-pill border bg-gold text-void border-gold">
        {/* Animated live indicator */}
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-void animate-ring-expand opacity-60" />
          <span className="absolute inline-flex h-full w-full rounded-full bg-void animate-ring-expand-2 opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-void" />
        </span>
        {children}
      </span>
    );
  }

  return (
    <span className={`status-pill border ${variants[variant]}`}>
      {children}
    </span>
  );
}
