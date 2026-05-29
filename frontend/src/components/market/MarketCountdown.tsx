import { useEffect, useRef, useState } from "react";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

function Cell({ value, label, urgent }: { value: string; label: string; urgent: boolean }) {
  const prev = useRef(value);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (prev.current !== value) {
      setFlipping(true);
      const t = setTimeout(() => setFlipping(false), 120);
      prev.current = value;
      return () => clearTimeout(t);
    }
  }, [value]);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`countdown-cell px-1 ${urgent ? "border-gold/50 shadow-glow-gold-sm" : ""}`}>
        <span
          className={`font-display text-2xl leading-none tabular-nums select-none
            ${urgent ? "text-gold" : "text-ink-primary"}
            ${flipping ? "animate-count-flip" : ""}`}
        >
          {value}
        </span>
      </div>
      <span className="font-mono text-[8px] tracking-widest text-ink-dim uppercase">{label}</span>
    </div>
  );
}

export function MarketCountdown({ epochEnd }: { epochEnd: number }) {
  const [secs, setSecs] = useState(() => Math.max(0, epochEnd - Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const id = setInterval(() => {
      setSecs(Math.max(0, epochEnd - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [epochEnd]);

  if (secs === 0) {
    return (
      <div className="font-mono text-[13px] tracking-widest text-ink-dim uppercase">
        CLOSED
      </div>
    );
  }

  const urgent = secs < 300;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;

  return (
    <div className="flex items-end gap-1.5">
      {h > 0 && <Cell value={pad(h)} label="HRS" urgent={urgent} />}
      <Cell value={pad(m)} label="MIN" urgent={urgent} />
      <Cell value={pad(s)} label="SEC" urgent={urgent} />
    </div>
  );
}
