import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWriteContract, useAccount } from "wagmi";
import { motion } from "framer-motion";
import { useAppStore } from "@/store/appStore";
import { CONTRACT_ADDRESS, CONTRACT_ABI } from "@/lib/contracts/config";
import { Spinner } from "@/components/ui/Spinner";
import { SEPOLIA_FEEDS, toFeedUnits } from "@/types";

type ResolutionMode = "manual" | "oracle";
type CollateralMode = "eth" | "cusdc";

const PRESETS = [
  { q: "Will ETH close above $3000 at epoch end?",   feed: 0, strike: 3000 },
  { q: "Will BTC close above $100,000 at epoch end?", feed: 1, strike: 100000 },
  { q: "Will ETH exceed $4000 this epoch?",           feed: 0, strike: 4000 },
];

export function CreateMarket() {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { setTxStatus } = useAppStore();

  const [mode, setMode]         = useState<ResolutionMode>("oracle");
  const [collateral, setCollateral] = useState<CollateralMode>("eth");
  const [question, setQuestion] = useState("Will ETH close above $3000 at epoch end?");
  const [durationMins, setDurationMins] = useState("5");
  const [feedIndex, setFeedIndex] = useState(0);
  const [strikeHuman, setStrikeHuman] = useState("3000");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFeed = SEPOLIA_FEEDS[feedIndex];

  async function handleCreate() {
    setIsPending(true);
    setError(null);
    try {
      const secs = BigInt(Math.max(60, Number(durationMins) * 60));
      setTxStatus("Initializing epoch…");

      let hash: string;
      if (collateral === "cusdc") {
        if (mode === "oracle") {
          const strike = toFeedUnits(Number(strikeHuman), selectedFeed.decimals);
          hash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: "createTokenMarketWithOracle",
            args: [question, secs, selectedFeed.address as `0x${string}`, strike],
          });
        } else {
          hash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: CONTRACT_ABI,
            functionName: "createTokenMarket",
            args: [question, secs],
          });
        }
      } else if (mode === "oracle") {
        const strike = toFeedUnits(Number(strikeHuman), selectedFeed.decimals);
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "createMarketWithOracle",
          args: [question, secs, selectedFeed.address as `0x${string}`, strike],
        });
      } else {
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: CONTRACT_ABI,
          functionName: "createMarket",
          args: [question, secs],
        });
      }

      setTxStatus(`Epoch initialized: ${hash.slice(0, 10)}…`);
      navigate("/");
    } catch (e: unknown) {
      const msg =
        (e as { shortMessage?: string; message?: string })?.shortMessage ??
        (e as { message?: string })?.message ??
        String(e);
      setError(msg);
      setTxStatus("Error: " + msg);
    } finally {
      setIsPending(false);
    }
  }

  function applyPreset(p: typeof PRESETS[0]) {
    setQuestion(p.q);
    setFeedIndex(p.feed);
    setStrikeHuman(String(p.strike));
    setMode("oracle");
  }

  if (!isConnected) {
    return (
      <div className="bg-surface border border-wire notched-lg p-12 max-w-lg text-center">
        <div className="font-display text-4xl text-wire mb-3">AUTH REQUIRED</div>
        <p className="font-body text-ink-secondary text-[14px]">
          Connect wallet to initialize a new sealed-bid epoch.
        </p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="max-w-lg space-y-5"
    >
      <div>
        <div className="font-mono text-[10px] tracking-widest2 text-ink-dim mb-2">
          CBC / NEW EPOCH
        </div>
        <h2 className="font-display text-3xl tracking-widest text-ink-primary">INITIALIZE EPOCH</h2>
        <p className="font-body text-[13px] text-ink-secondary mt-2">
          Opens a sealed-bid accumulation window. Bids accepted until epoch closes.
        </p>
      </div>

      {/* Collateral toggle */}
      <div>
        <div className="data-label mb-2">COLLATERAL TYPE</div>
        <div className="grid grid-cols-2 gap-px bg-wire">
          {(["eth", "cusdc"] as CollateralMode[]).map((c) => (
            <button
              key={c}
              onClick={() => setCollateral(c)}
              className={`py-3 font-mono text-[11px] tracking-widest uppercase transition-colors ${
                collateral === c
                  ? "bg-gold-faint text-gold border-b-2 border-gold"
                  : "bg-surface text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {c === "eth" ? "◈ ETH (PLAINTEXT AMT)" : "⬡ cUSDC (ENCRYPTED AMT)"}
            </button>
          ))}
        </div>
        {collateral === "cusdc" && (
          <div className="px-4 py-3 border border-gold-border bg-gold-faint text-[12px] font-body text-ink-secondary mt-px">
            Both direction AND amount are encrypted. Single-step settlement — payout never revealed in plaintext. Requires Sepolia cUSDC.
          </div>
        )}
      </div>

      {/* Resolution mode toggle */}
      <div className="grid grid-cols-2 gap-px bg-wire">
        {(["oracle", "manual"] as ResolutionMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`py-3 font-mono text-[11px] tracking-widest uppercase transition-colors ${
              mode === m
                ? "bg-gold-faint text-gold border-b-2 border-gold"
                : "bg-surface text-ink-secondary hover:text-ink-primary"
            }`}
          >
            {m === "oracle" ? "⬡ ORACLE (PERMISSIONLESS)" : "◈ MANUAL (CREATOR)"}
          </button>
        ))}
      </div>

      {/* Mode explanation */}
      <div className={`px-4 py-3 border text-[12px] font-body ${
        mode === "oracle"
          ? "border-teal/30 bg-teal-faint text-ink-secondary"
          : "border-gold-border bg-gold-faint text-ink-secondary"
      }`}>
        {mode === "oracle"
          ? "Anyone can resolve this epoch after close by reading a Chainlink price feed. No creator trust required."
          : "Only the epoch creator can resolve this market after close. Participants trust the creator's honesty."}
      </div>

      {/* Form */}
      <div className="bg-surface border border-wire overflow-hidden">
        <div className="px-5 py-3 border-b border-wire">
          <span className="section-header">EPOCH PARAMETERS</span>
        </div>
        <div className="p-5 space-y-5">

          {/* Question */}
          <div>
            <div className="data-label mb-2">BINARY QUESTION</div>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={2}
              className="intel-input resize-none leading-relaxed"
              placeholder="Will ETH close above $3000 at epoch end?"
            />

            {/* Presets */}
            {mode === "oracle" && (
              <div className="mt-2 flex flex-col gap-1">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => applyPreset(p)}
                    className="text-left font-mono text-[9px] tracking-wider text-ink-dim border border-wire px-3 py-2 hover:border-gold-border hover:text-gold transition-colors"
                  >
                    {p.q}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Oracle config */}
          {mode === "oracle" && (
            <div className="space-y-4 border-t border-wire pt-4">
              <div className="data-label">CHAINLINK PRICE FEED</div>

              <div className="grid grid-cols-2 gap-px bg-wire">
                {SEPOLIA_FEEDS.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => setFeedIndex(i)}
                    className={`px-3 py-2.5 text-left transition-colors ${
                      feedIndex === i
                        ? "bg-gold-faint text-gold"
                        : "bg-surface text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    <div className="font-mono text-[11px] tracking-wider">{f.label}</div>
                    <div className="font-mono text-[9px] text-ink-dim mt-0.5">
                      {f.address.slice(0, 10)}…
                    </div>
                  </button>
                ))}
              </div>

              <div>
                <div className="data-label mb-2">
                  STRIKE PRICE ({selectedFeed.unit}) — YES IF PRICE ≥ THIS
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={strikeHuman}
                    onChange={(e) => setStrikeHuman(e.target.value)}
                    className="intel-input w-40 font-mono"
                    placeholder="3000"
                  />
                  <span className="font-mono text-[11px] text-ink-secondary">
                    {selectedFeed.unit}
                  </span>
                </div>
                <p className="font-mono text-[10px] text-ink-dim mt-1.5">
                  STORED AS {strikeHuman && !isNaN(Number(strikeHuman))
                    ? toFeedUnits(Number(strikeHuman), selectedFeed.decimals).toString()
                    : "—"} (8 dec)
                </p>
              </div>
            </div>
          )}

          {/* Duration */}
          <div className={mode === "oracle" ? "border-t border-wire pt-4" : ""}>
            <div className="data-label mb-2">EPOCH DURATION</div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                max="10080"
                value={durationMins}
                onChange={(e) => setDurationMins(e.target.value)}
                className="intel-input w-28 font-mono"
              />
              <span className="font-mono text-[11px] text-ink-secondary">MINUTES</span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="border border-crimson/40 bg-crimson/5 px-4 py-3">
              <div className="data-label text-crimson mb-1">ERROR</div>
              <p className="font-mono text-[12px] text-crimson/90">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleCreate}
            disabled={isPending || !question.trim()}
            className="btn-gold w-full flex items-center justify-center gap-3"
          >
            {isPending ? (
              <>
                <Spinner size={14} />
                <span>INITIALIZING EPOCH</span>
              </>
            ) : (
              `OPEN ${collateral === "cusdc" ? "cUSDC " : ""}${mode === "oracle" ? "ORACLE" : "MANUAL"} EPOCH`
            )}
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        {(mode === "oracle" ? [
          "Oracle epochs resolve permissionlessly — anyone calls resolveByOracle() after close.",
          "Chainlink feed is read at resolution time, not epoch creation.",
          "If the feed is stale or unavailable, resolution will revert until feed recovers.",
        ] : [
          "Creator must call resolveMarket() after epoch closes.",
          "Creator controls the outcome — participants trust the creator's honesty.",
          "Consider oracle epochs for trustless operation.",
        ]).map((note, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="font-mono text-[10px] text-ink-dim mt-0.5">{String(i + 1).padStart(2, "0")}</span>
            <p className="font-mono text-[10px] text-ink-dim leading-relaxed">{note}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
