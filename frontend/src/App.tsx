import { BrowserProvider, Contract, ethers, type Eip1193Provider } from "ethers";
import {
  initSDK,
  createInstance,
  SepoliaConfig,
  type FhevmInstance,
} from "@zama-fhe/relayer-sdk/web";
import { useEffect, useRef, useState } from "react";
import ABI from "./abi.json";
import { BATCH_AUCTION_ADDRESS, CHAIN_ID } from "./config";

// ── Constants ────────────────────────────────────────────────────────────────

const SIDE_NO = 0;
const SIDE_YES = 1;
const UNRESOLVED = 255;

const SEPOLIA_ADD_PARAMS = {
  chainId: "0xaa36a7",
  chainName: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "SEP", decimals: 18 },
  rpcUrls: ["https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
} as const;

async function ensureSepolia(eth: Eip1193Provider & { request: any }) {
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_ADD_PARAMS.chainId }] });
  } catch (err: any) {
    if (err?.code === 4902 || err?.code === -32603 || /unrecognized chain/i.test(String(err?.message ?? ""))) {
      await eth.request({ method: "wallet_addEthereumChain", params: [SEPOLIA_ADD_PARAMS] });
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_ADD_PARAMS.chainId }] });
    } else throw err;
  }
}

// ── Types ────────────────────────────────────────────────────────────────────

type EpochStatus = "accumulating" | "closed" | "resolving" | "revealing" | "revealed" | "settling";

type MarketView = {
  id: number;
  creator: string;
  question: string;
  epochStart: number;
  epochEnd: number;
  resolved: boolean;
  outcome: number;
  totalEth: bigint;
  clearingPrice: bigint;
  revealedYesPool: bigint;
  revealedNoPool: bigint;
  poolRevealRequested: boolean;
  poolRevealed: boolean;
  participantCount: number;
  myPos: { amount: bigint; payoutRequested: boolean; claimed: boolean } | null;
  epochStatus: EpochStatus;
};

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtEth(wei: bigint, places = 4) {
  return Number(ethers.formatEther(wei)).toFixed(places);
}

function fmtCountdown(secondsLeft: number) {
  if (secondsLeft <= 0) return "00:00";
  const m = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const s = (secondsLeft % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function shortAddr(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function epochStatus(m: MarketView): EpochStatus {
  const now = Math.floor(Date.now() / 1000);
  if (m.poolRevealed) return "revealed";
  if (m.poolRevealRequested) return "revealing";
  if (m.resolved) return "resolving";
  if (now >= m.epochEnd) return "closed";
  return "accumulating";
}

// ── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg: "#0a0b10",
  surface: "#111318",
  border: "#1e2129",
  accent: "#5865f2",
  yes: "#22c55e",
  no: "#ef4444",
  text: "#e2e8f0",
  muted: "#64748b",
  warn: "#f59e0b",
  sealed: "#334155",
};

const css = {
  page: {
    minHeight: "100vh",
    background: C.bg,
    color: C.text,
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
    padding: "0 0 80px",
  } as React.CSSProperties,

  header: {
    borderBottom: `1px solid ${C.border}`,
    padding: "20px 32px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    position: "sticky" as const,
    top: 0,
    background: `${C.bg}ee`,
    backdropFilter: "blur(12px)",
    zIndex: 10,
  },

  logo: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },

  title: {
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: C.text,
    margin: 0,
  },

  tagline: {
    fontSize: 11,
    color: C.muted,
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    margin: 0,
  },

  btn: (color = C.accent, disabled = false) =>
    ({
      background: disabled ? C.border : color,
      color: disabled ? C.muted : "#fff",
      border: "none",
      borderRadius: 8,
      padding: "8px 16px",
      fontSize: 13,
      fontWeight: 600,
      cursor: disabled ? "not-allowed" : "pointer",
      transition: "opacity 0.15s",
      opacity: disabled ? 0.6 : 1,
      whiteSpace: "nowrap" as const,
    }) as React.CSSProperties,

  main: {
    maxWidth: 860,
    margin: "0 auto",
    padding: "32px 24px",
  },

  section: {
    marginBottom: 32,
  },

  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: C.muted,
    marginBottom: 16,
    paddingBottom: 8,
    borderBottom: `1px solid ${C.border}`,
  },

  card: (highlight = false) =>
    ({
      background: C.surface,
      border: `1px solid ${highlight ? C.accent + "66" : C.border}`,
      borderRadius: 12,
      padding: 20,
      marginBottom: 16,
    }) as React.CSSProperties,

  input: {
    background: "#0d0f14",
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    color: C.text,
    fontSize: 14,
    padding: "8px 12px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box" as const,
  },

  statusBadge: (status: EpochStatus) => {
    const cfg: Record<EpochStatus, [string, string]> = {
      accumulating: [C.yes + "22", C.yes],
      closed:       [C.warn + "22", C.warn],
      resolving:    [C.warn + "22", C.warn],
      revealing:    [C.accent + "22", C.accent],
      revealed:     [C.accent + "22", C.accent],
      settling:     [C.muted + "22", C.muted],
    };
    const [bg, color] = cfg[status] ?? [C.border, C.muted];
    return {
      background: bg,
      color,
      border: `1px solid ${color}44`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.08em",
      textTransform: "uppercase" as const,
    } as React.CSSProperties;
  },
};

// ── Privacy Boundary Table ────────────────────────────────────────────────────

function PrivacyBoundary() {
  const rows = [
    { stage: "Individual bid direction", during: "🔐 Encrypted", after: "Never revealed" },
    { stage: "Total ETH volume",         during: "✓ Public",    after: "✓ Public" },
    { stage: "Participant count",         during: "✓ Public",    after: "✓ Public" },
    { stage: "YES / NO split",           during: "🔐 Hidden",   after: "✓ Revealed at close" },
    { stage: "Clearing price",           during: "—",            after: "✓ Single reveal" },
    { stage: "Individual payout",        during: "🔐 Encrypted", after: "✓ Recipient only" },
  ];

  return (
    <div style={{ ...css.card(), overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: C.muted }}>
            <th style={{ textAlign: "left", padding: "6px 12px 10px 0", fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Layer</th>
            <th style={{ textAlign: "left", padding: "6px 12px 10px",   fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>During epoch</th>
            <th style={{ textAlign: "left", padding: "6px 0 10px 12px", fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>After close</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <td style={{ padding: "8px 12px 8px 0", color: C.muted }}>{r.stage}</td>
              <td style={{ padding: "8px 12px", color: r.during.startsWith("🔐") ? C.warn : C.yes }}>{r.during}</td>
              <td style={{ padding: "8px 0 8px 12px", color: r.after === "Never revealed" ? C.no : r.after.startsWith("✓") ? C.yes : C.muted }}>{r.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Epoch Visualizer ─────────────────────────────────────────────────────────

function EpochVisualizerRow({ step, active, done }: { step: string; active: boolean; done: boolean }) {
  const color = done ? C.yes : active ? C.accent : C.sealed;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", color }}>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: color,
        boxShadow: active ? `0 0 8px ${C.accent}` : "none",
        flexShrink: 0,
        transition: "all 0.4s",
      }} />
      <span style={{ fontSize: 13, fontWeight: active ? 600 : 400 }}>{step}</span>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function BatchAuctionApp() {
  const [account, setAccount] = useState<string | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [fhevmInst, setFhevmInst] = useState<FhevmInstance | null>(null);
  const [markets, setMarkets] = useState<MarketView[]>([]);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Create market form
  const [newQ, setNewQ] = useState("Will ETH close above $3000 this epoch?");
  const [epochMins, setEpochMins] = useState("5");

  // Bet form state per market (marketId → amount)
  const [betAmounts, setBetAmounts] = useState<Record<number, string>>({});
  const [selectedSide, setSelectedSide] = useState<Record<number, number>>({});

  const [tick, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Countdown ticker
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  // ── Wallet + FHE init ───────────────────────────────────────────────────────

  const connect = async () => {
    const eth = (window as any).ethereum;
    if (!eth) { setStatus("MetaMask not found"); return; }
    setBusy(true);
    setStatus("Connecting…");
    try {
      await ensureSepolia(eth);
      const provider = new BrowserProvider(eth);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAccount(addr);

      let inst: FhevmInstance | null = null;
      setStatus("Initializing FHE relayer…");
      try {
        await initSDK();
        inst = (await Promise.race([
          createInstance({ ...SepoliaConfig, network: eth, relayerUrl: `${window.location.origin}/api/zama-relay` }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 60_000)),
        ])) as FhevmInstance;
      } catch {
        try { inst = await createInstance({ ...SepoliaConfig, network: eth }); } catch { /* offline */ }
      }
      setFhevmInst(inst);

      const c = new Contract(BATCH_AUCTION_ADDRESS, ABI, signer);
      setContract(c);
      setStatus(inst ? "FHE online" : "Wallet connected (FHE offline — read-only)");
      await loadMarkets(c, addr);
    } catch (e: any) {
      setStatus("Connect failed: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadMarkets = async (c: Contract, addr: string) => {
    try {
      const n = Number(await c.marketCount());
      const out: MarketView[] = [];
      for (let i = 0; i < n; i++) {
        const m = await c.getMarket(i);
        let myPos = null;
        try {
          const pos = await c.getPosition(i, addr);
          if (pos.amount > 0n) {
            myPos = { amount: pos.amount, payoutRequested: pos.payoutRequested, claimed: pos.claimed };
          }
        } catch { /* no position */ }

        const view: MarketView = {
          id: i,
          creator: m.creator,
          question: m.question,
          epochStart: Number(m.epochStart),
          epochEnd: Number(m.epochEnd),
          resolved: m.resolved,
          outcome: Number(m.outcome),
          totalEth: m.totalEth,
          clearingPrice: m.clearingPrice,
          revealedYesPool: m.revealedYesPool,
          revealedNoPool: m.revealedNoPool,
          poolRevealRequested: m.poolRevealRequested,
          poolRevealed: m.poolRevealed,
          participantCount: 0, // not on-chain; derived from events in a real indexer
          myPos,
          epochStatus: "accumulating",
        };
        view.epochStatus = epochStatus(view);
        out.push(view);
      }
      setMarkets(out);
    } catch (e: any) {
      console.error("loadMarkets", e);
    }
  };

  const refresh = () => { if (contract && account) loadMarkets(contract, account); };

  // ── Actions ─────────────────────────────────────────────────────────────────

  const withBusy = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(label + "…");
    try {
      await fn();
      setStatus("Done");
      refresh();
    } catch (e: any) {
      setStatus("Error: " + (e?.shortMessage ?? e?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };

  const onCreateMarket = () => withBusy("Creating market", async () => {
    const tx = await contract!.createMarket(newQ, BigInt(Math.max(60, Number(epochMins) * 60)));
    await tx.wait();
  });

  const onPlaceBet = (marketId: number, side: number) => withBusy("Encrypting and submitting bid", async () => {
    if (!fhevmInst) throw new Error("FHE relayer offline");
    const amount = betAmounts[marketId] ?? "0.01";
    const buf = fhevmInst.createEncryptedInput(BATCH_AUCTION_ADDRESS, account!);
    buf.add8(BigInt(side));
    const enc = await buf.encrypt();
    const tx = await contract!.placeBet(
      marketId,
      enc.handles[0],
      enc.inputProof,
      { value: ethers.parseEther(amount) },
    );
    await tx.wait();
  });

  const onResolve = (marketId: number, outcome: number) => withBusy("Resolving market", async () => {
    const tx = await contract!.resolveMarket(marketId, outcome);
    await tx.wait();
  });

  const onRevealPools = (m: MarketView) => withBusy("Revealing aggregate pools", async () => {
    if (!fhevmInst) throw new Error("FHE relayer offline");
    if (!m.poolRevealRequested) {
      const tx1 = await contract!.requestPoolReveal(m.id);
      await tx1.wait();
    }
    const [yesHandle, noHandle] = await contract!.getEncPools(m.id);
    setStatus("Requesting KMS signatures…");
    const result = await fhevmInst.publicDecrypt([yesHandle, noHandle]);
    const tx2 = await contract!.onPoolRevealed(
      m.id,
      [yesHandle, noHandle],
      result.abiEncodedClearValues,
      result.decryptionProof,
    );
    await tx2.wait();
  });

  const onClaimPayout = (m: MarketView) => withBusy("Claiming payout via FHE", async () => {
    if (!fhevmInst) throw new Error("FHE relayer offline");
    if (!m.myPos?.payoutRequested) {
      const tx1 = await contract!.requestPayout(m.id);
      await tx1.wait();
    }
    const encPayout = await contract!.getEncPayout(m.id, account!);
    setStatus("Requesting KMS signature for payout…");
    const result = await fhevmInst.publicDecrypt([encPayout]);
    const tx2 = await contract!.onPayoutRevealed(
      m.id,
      account!,
      [encPayout],
      result.abiEncodedClearValues,
      result.decryptionProof,
    );
    await tx2.wait();
  });

  // ── Market card ─────────────────────────────────────────────────────────────

  function MarketCard({ m }: { m: MarketView }) {
    const now = Math.floor(Date.now() / 1000);
    const secsLeft = Math.max(0, m.epochEnd - now);
    const isCreator = account?.toLowerCase() === m.creator.toLowerCase();
    const status = m.epochStatus;
    const hasPos = !!m.myPos && m.myPos.amount > 0n;
    const amount = betAmounts[m.id] ?? "0.01";
    const side = selectedSide[m.id] ?? SIDE_YES;

    const yesPct = m.poolRevealed && m.revealedYesPool + m.revealedNoPool > 0n
      ? Number((m.revealedYesPool * 10000n) / (m.revealedYesPool + m.revealedNoPool)) / 100
      : null;

    const clearingPct = m.poolRevealed ? (Number(m.clearingPrice) / 100).toFixed(2) + "%" : null;

    const stepDone = (s: EpochStatus) => {
      const order: EpochStatus[] = ["accumulating", "closed", "resolving", "revealing", "revealed", "settling"];
      return order.indexOf(status) > order.indexOf(s);
    };
    const stepActive = (s: EpochStatus) => status === s;

    return (
      <div style={css.card(hasPos)}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>
              Market #{m.id} · {shortAddr(m.creator)}
            </div>
            <strong style={{ fontSize: 15, lineHeight: 1.4 }}>{m.question}</strong>
          </div>
          <span style={css.statusBadge(status)}>{status}</span>
        </div>

        {/* Epoch timeline */}
        <div style={{
          background: "#0d0f14",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {status === "accumulating" ? "Epoch closes in" : "Epoch closed"}
            </div>
            <div style={{
              fontSize: status === "accumulating" ? 28 : 18,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              fontFamily: "monospace",
              color: status === "accumulating" ? C.text : C.muted,
            }}>
              {status === "accumulating" ? fmtCountdown(secsLeft) : new Date(m.epochEnd * 1000).toLocaleTimeString()}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total volume</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.text }}>{fmtEth(m.totalEth)} ETH</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {status === "accumulating" ? "Direction sealed ·" : ""} Directional flow hidden
            </div>
          </div>
        </div>

        {/* Lifecycle steps */}
        <div style={{ marginBottom: 16, padding: "8px 0", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
          <EpochVisualizerRow step="Epoch accumulating (sealed)" active={stepActive("accumulating")} done={stepDone("accumulating")} />
          <EpochVisualizerRow step="Epoch closed" active={stepActive("closed")} done={stepDone("closed")} />
          <EpochVisualizerRow step="Market resolved" active={stepActive("resolving")} done={stepDone("resolving")} />
          <EpochVisualizerRow step="Aggregate pool reveal" active={stepActive("revealing")} done={stepDone("revealing") || status === "revealed"} />
          <EpochVisualizerRow step="Clearing price published" active={status === "revealed"} done={stepDone("revealed")} />
          <EpochVisualizerRow step="Confidential settlement" active={status === "settling"} done={false} />
        </div>

        {/* Pool reveal — shown only after reveal */}
        {m.poolRevealed && yesPct !== null && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              marginBottom: 6,
              color: C.muted,
            }}>
              <span style={{ color: C.yes }}>YES {fmtEth(m.revealedYesPool)} ETH ({yesPct.toFixed(1)}%)</span>
              <span style={{ color: C.accent, fontWeight: 700 }}>Clearing price: {clearingPct}</span>
              <span style={{ color: C.no }}>NO {fmtEth(m.revealedNoPool)} ETH ({(100 - yesPct).toFixed(1)}%)</span>
            </div>
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${yesPct}%`, background: C.yes, transition: "width 0.8s ease" }} />
              <div style={{ flex: 1, background: C.no, transition: "width 0.8s ease" }} />
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 6, textAlign: "center" }}>
              ↑ First and only directional signal — emitted at epoch close
            </div>
          </div>
        )}

        {/* Active epoch: bid submission */}
        {status === "accumulating" && !hasPos && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                style={{
                  ...css.btn(side === SIDE_YES ? C.yes : C.border, busy),
                  padding: "8px 20px",
                  fontSize: 14,
                }}
                disabled={busy}
                onClick={() => setSelectedSide((p) => ({ ...p, [m.id]: SIDE_YES }))}
              >
                YES
              </button>
              <button
                style={{
                  ...css.btn(side === SIDE_NO ? C.no : C.border, busy),
                  padding: "8px 20px",
                  fontSize: 14,
                }}
                disabled={busy}
                onClick={() => setSelectedSide((p) => ({ ...p, [m.id]: SIDE_NO }))}
              >
                NO
              </button>
            </div>
            <input
              type="number"
              step="0.001"
              min="0.001"
              placeholder="ETH"
              value={amount}
              onChange={(e) => setBetAmounts((p) => ({ ...p, [m.id]: e.target.value }))}
              style={{ ...css.input, width: 90 }}
            />
            <button
              style={css.btn(C.accent, busy || !fhevmInst)}
              disabled={busy || !fhevmInst}
              onClick={() => onPlaceBet(m.id, side)}
            >
              🔐 Submit Encrypted Bid
            </button>
          </div>
        )}

        {status === "accumulating" && hasPos && (
          <div style={{ fontSize: 13, color: C.muted, padding: "8px 0" }}>
            Bid submitted · {fmtEth(m.myPos!.amount)} ETH · <span style={{ color: C.accent }}>direction sealed</span>
          </div>
        )}

        {/* Closed epoch: creator resolves */}
        {status === "closed" && isCreator && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: C.muted, marginRight: 4 }}>Resolve as:</span>
            <button style={css.btn(C.yes, busy)} disabled={busy} onClick={() => onResolve(m.id, SIDE_YES)}>YES wins</button>
            <button style={css.btn(C.no, busy)} disabled={busy} onClick={() => onResolve(m.id, SIDE_NO)}>NO wins</button>
          </div>
        )}

        {/* Resolved: request pool reveal */}
        {(status === "resolving" || status === "revealing") && isCreator && !m.poolRevealed && (
          <button style={css.btn(C.accent, busy || !fhevmInst)} disabled={busy || !fhevmInst} onClick={() => onRevealPools(m)}>
            Reveal Aggregate Pools
          </button>
        )}

        {/* Revealed + has position: claim */}
        {m.poolRevealed && hasPos && !m.myPos!.claimed && (
          <button style={css.btn(C.accent, busy || !fhevmInst)} disabled={busy || !fhevmInst} onClick={() => onClaimPayout(m)}>
            Claim Payout (FHE-gated)
          </button>
        )}

        {m.poolRevealed && hasPos && m.myPos!.claimed && (
          <div style={{ fontSize: 13, color: C.yes, padding: "4px 0" }}>
            ✓ Payout claimed — side never revealed on-chain
          </div>
        )}

        {/* Outcome badge */}
        {m.resolved && m.outcome !== UNRESOLVED && (
          <div style={{ marginTop: 8, fontSize: 13, color: C.muted }}>
            Outcome: <strong style={{ color: m.outcome === SIDE_YES ? C.yes : C.no }}>
              {m.outcome === SIDE_YES ? "YES" : "NO"}
            </strong>
          </div>
        )}
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={css.page}>
      {/* Header */}
      <div style={css.header}>
        <div style={css.logo}>
          <p style={css.title}>Confidential Batch Clearing</p>
          <p style={css.tagline}>Sealed-bid directional discovery · No pre-trade signaling · fhEVM</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {status && <span style={{ fontSize: 12, color: C.muted, maxWidth: 300, textAlign: "right" }}>{status}</span>}
          {account
            ? <button style={css.btn(C.border, busy)} disabled={busy} onClick={refresh}>{shortAddr(account)} · Refresh</button>
            : <button style={css.btn(C.accent, busy)} disabled={busy} onClick={connect}>Connect Wallet</button>
          }
        </div>
      </div>

      <div style={css.main}>

        {/* Mechanism intro */}
        {!account && (
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, lineHeight: 1.3 }}>
              Confidential batch-clearing infrastructure<br />for information markets.
            </div>
            <div style={{ fontSize: 14, color: C.muted, lineHeight: 1.7, maxWidth: 580, marginBottom: 24 }}>
              Traditional prediction markets leak directional flow continuously — creating reflexive momentum,
              copy-trading, and pre-trade signaling. This protocol batches sealed bids and reveals only the
              aggregate clearing price at epoch close. No live order flow. No visible consensus formation.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, maxWidth: 580, marginBottom: 24 }}>
              {[
                ["No live order flow", "Directional intent accumulates privately"],
                ["Aggregate-only reveal", "YES/NO split published once, at close"],
                ["FHE settlement", "Payout computed without revealing your side"],
              ].map(([title, desc]) => (
                <div key={title} style={{ ...css.card(), padding: "14px 16px" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.5 }}>{desc}</div>
                </div>
              ))}
            </div>
            <button style={css.btn(C.accent)} onClick={connect}>Connect to Sepolia Testnet</button>
          </div>
        )}

        {/* Privacy boundary table */}
        {account && (
          <div style={css.section}>
            <div style={css.sectionTitle}>Information Topology</div>
            <PrivacyBoundary />
          </div>
        )}

        {/* Create market */}
        {account && (
          <div style={css.section}>
            <div style={css.sectionTitle}>Create Epoch</div>
            <div style={css.card()}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Question</div>
                  <input
                    style={css.input}
                    value={newQ}
                    onChange={(e) => setNewQ(e.target.value)}
                    placeholder="Will ETH close above $3000 this epoch?"
                  />
                </div>
                <div style={{ width: 100 }}>
                  <div style={{ fontSize: 12, color: C.muted, marginBottom: 6 }}>Duration (min)</div>
                  <input
                    style={css.input}
                    type="number"
                    min="1"
                    max="60"
                    value={epochMins}
                    onChange={(e) => setEpochMins(e.target.value)}
                  />
                </div>
                <button style={css.btn(C.accent, busy)} disabled={busy} onClick={onCreateMarket}>
                  Open Epoch
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Live epochs */}
        {account && markets.length > 0 && (
          <div style={css.section}>
            <div style={css.sectionTitle}>Epochs · {markets.length} total</div>
            {[...markets].reverse().map((m) => (
              <MarketCard key={m.id} m={m} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {account && markets.length === 0 && (
          <div style={{ ...css.card(), textAlign: "center", padding: 40, color: C.muted }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>↑</div>
            No epochs yet. Create one above to start accumulating sealed bids.
          </div>
        )}

        {/* Gas profile */}
        {account && (
          <div style={css.section}>
            <div style={css.sectionTitle}>Live Gas Profile · Sepolia Measurement</div>
            <div style={css.card()}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ color: C.muted }}>
                    <th style={{ textAlign: "left", padding: "4px 16px 8px 0", borderBottom: `1px solid ${C.border}` }}>Operation</th>
                    <th style={{ textAlign: "right", padding: "4px 0 8px", borderBottom: `1px solid ${C.border}` }}>Gas</th>
                    <th style={{ textAlign: "right", padding: "4px 0 8px 16px", borderBottom: `1px solid ${C.border}` }}>@ 10 gwei</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["placeBet (FHE encrypt + accumulate)", "~389k", "~$0.80"],
                    ["resolveMarket", "~33k", "~$0.07"],
                    ["requestPoolReveal", "~122k", "~$0.25"],
                    ["onPoolRevealed (aggregate + clearing price)", "~168k", "~$0.35"],
                    ["requestPayout (FHE.select branch)", "~226k", "~$0.47"],
                    ["onPayoutRevealed (ETH transfer)", "~108k", "~$0.22"],
                  ].map(([op, gas, cost], i, arr) => (
                    <tr key={op} style={{ borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <td style={{ padding: "7px 16px 7px 0", color: C.text }}>{op}</td>
                      <td style={{ padding: "7px 8px", textAlign: "right", color: C.accent }}>{gas}</td>
                      <td style={{ padding: "7px 0 7px 16px", textAlign: "right", color: C.muted }}>{cost}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 12, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                Measured on Sepolia testnet · 3-bettor epoch · Hardhat mock coprocessor
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ fontSize: 12, color: C.muted, textAlign: "center", marginTop: 40, lineHeight: 1.8 }}>
          Contract: <a href={`https://sepolia.etherscan.io/address/${BATCH_AUCTION_ADDRESS}`}
            target="_blank" rel="noopener"
            style={{ color: C.accent, textDecoration: "none" }}>{BATCH_AUCTION_ADDRESS}</a>
          <br />
          No directional information leaks during price formation.
          Residual inference occurs only post-settlement through payout observation.
        </div>
      </div>
    </div>
  );
}
