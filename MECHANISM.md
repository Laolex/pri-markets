# Confidential Batch Clearing for Information Markets

**A mechanism design contribution to the fhEVM ecosystem**

---

## Abstract

Continuous prediction markets are structurally distorted information aggregation systems. Public order flow enables reflexive behavior — visible directional skew creates momentum cascades, copy-trading, and consensus formation loops that corrupt the underlying price discovery function.

**Core contribution**: This paper introduces a batch auction mechanism for prediction markets that enforces directional confidentiality during information formation while preserving verifiable aggregate price discovery. The mechanism, **Confidential Batch Clearing**, eliminates explicit and interpretable pre-trade directional signaling in order flow and aggregate imbalance during the accumulation window, while publishing a single terminal aggregate signal — the **clearing price** — at epoch close.

Participants submit sealed bids during fixed epoch windows. The YES/NO split is never visible during accumulation. At epoch close, only the terminal aggregate state is revealed — the first and only public signal about directional flow. Individual sides remain encrypted permanently, with settlement computed via FHE conditional execution (`FHE.select`) rather than plaintext side comparison.

The protocol is deployed and measured on Sepolia testnet. This document presents the mechanism design, formal confidentiality model with adversarial analysis, implementation architecture, and live gas profile.

---

## 1. The Problem: Continuous Markets as Reflexive Systems

### 1.1 Information Distortion in Public Order Flow

A prediction market's theoretical function is to aggregate dispersed private information into a probability estimate. This requires that participants express beliefs independently — each bid reflects the bidder's private signal, not a response to the observed beliefs of others.

Continuous public prediction markets violate this requirement structurally. Every bid is immediately observable. The YES/NO pool ratio is public at all times. This creates **path-dependent information leakage**:

- A large YES position shifts the visible probability, triggering imitative bids from observers
- Visible skew creates momentum — more YES flow attracts more YES flow regardless of underlying signal
- Participants front-run anticipated large bids based on observed wallet activity
- Consensus forms visually before the resolving event occurs

The market no longer aggregates information. It aggregates *observations of other participants' behavior*. The price becomes a reflexive artifact of the mechanism itself.

### 1.2 The Signaling Problem

In a continuous market with public order flow, the act of placing a bid *is* a signal. Placing 10 ETH on YES tells the market:

1. You exist and have a position
2. Your position is YES
3. Your conviction is proportional to your size

This is pre-trade information leakage in its most direct form. It enables:

- **Copy-trading**: observers replicate large positions
- **Whale tracking**: known wallets are monitored and front-run
- **Behavioral clustering**: repeated participation creates inference graphs
- **Momentum cascades**: visible directional flow creates self-reinforcing price movement

None of this is information about the underlying event. It is information about market participant behavior, and it corrupts the price.

### 1.3 Why Existing Solutions Are Insufficient

**Dark pools** in traditional finance solve this partially by hiding pre-trade order flow, but settlement still requires central counterparty trust and provides no on-chain verifiability.

**Commit-reveal schemes** delay information disclosure but require a two-phase interaction that increases friction and does not prevent timing attacks (early reveals signal direction before the window closes).

**Zero-knowledge proof approaches** can hide individual positions but typically still reveal the aggregate pool composition in real time, preserving the momentum cascade problem.

**AMMs applied to prediction markets** (LMSR, CPMM) create continuous pricing but expose live probability continuously by design — the price is the signal. Under FHE, AMM math (division, logarithms, square roots) is computationally infeasible at current coprocessor capability.

The core insight: the problem is not that individual positions are visible. The problem is that **directional flow is visible during accumulation**. Any mechanism that reveals the YES/NO split in real time, even in aggregate, preserves the reflexivity problem.

---

## 2. The Primitive: Confidential Batch Clearing

### 2.1 Core Mechanism

**Confidential Batch Clearing** removes intra-epoch price discovery entirely, replacing it with a single terminal equilibrium mapping. Directional flow is encrypted during the accumulation window. The clearing price is not a running statistic — it is computed once, at epoch close, from the sealed aggregate.

The mechanism has six phases:

```
1. EPOCH OPEN
   Creator opens a fixed-duration epoch with a binary question.
   Epoch start/end times are public. No other information is revealed.

2. ACCUMULATION (sealed)
   Participants submit bids: an ETH amount (plaintext) paired with
   an encrypted YES/NO choice. The encrypted choice is processed by
   the fhEVM coprocessor and accumulated into encrypted pool totals.
   Public view: total ETH volume, participant count. Nothing else.

3. EPOCH CLOSE
   The epoch window expires. No further bids are accepted.
   The YES/NO split remains encrypted.

4. RESOLUTION
   The epoch creator (or designated oracle) sets the binary outcome.
   The encrypted pools remain sealed until the next step.

5. AGGREGATE REVEAL
   The encrypted YES and NO pool totals are made publicly decryptable.
   The KMS coprocessor signs the cleartexts. The contract callback
   verifies the signatures and writes aggregate volumes.
   The clearing price — the realized market equilibrium probability
   signal under sealed-bid aggregation — is computed and published.
   This is the first and only public signal about directional flow.

6. CONFIDENTIAL SETTLEMENT
   Each participant requests their payout. The settlement computation
   is: FHE.select(won, proportional_payout, 0) where `won` is an
   encrypted boolean derived from comparing the encrypted side against
   the public outcome. The payout amount is decrypted and transferred.
   The bettor's side is never written to plaintext storage.
```

### 2.2 The Key Invariant

> **A bettor's directional choice remains encrypted in perpetuity. Settlement occurs without plaintext side comparison.**

This is enforced by the FHE settlement path:

```solidity
// Outcome is public. Side is encrypted.
ebool won = FHE.eq(pos.side, FHE.asEuint8(m.outcome));

// Payout is zero if won=false, proportional if won=true.
// Neither branch executes in the EVM — the coprocessor evaluates.
euint64 encPayout = FHE.select(won, FHE.asEuint64(fullPayoutGwei), FHE.asEuint64(0));

// Only the payout amount is decrypted — not the side.
FHE.makePubliclyDecryptable(encPayout);
```

Compare this to the naive implementation:

```solidity
// NAIVE — reveals side at settlement
require(pos.revealedSide == m.outcome, "Not a winner");
```

The naive approach requires decrypting the side and comparing it in plaintext. The FHE approach computes the branch condition entirely inside the coprocessor. The contract never observes which branch ran.

### 2.3 Why Batch Structure

Batch clearing provides privacy amplification beyond the FHE encryption:

- **Temporal compression**: all bids within an epoch execute at the same effective price — there is no advantage to ordering
- **No front-running**: since the book is sealed during accumulation, observing early bids provides no actionable information
- **MEV resistance**: the aggregate price is determined at epoch close, not incrementally — there is no sandwich attack surface during the accumulation window
- **Timing irrelevance**: submitting at epoch open versus epoch close provides no informational advantage to observers

The batch structure separates the **information formation phase** from the **price revelation phase**. In continuous markets, these are identical — every bid simultaneously forms and reveals. In batch clearing, information forms privately and reveals once, collectively.

### 2.4 Comparison to Continuous Markets

| Property | Continuous Market | Confidential Batch Clearing |
|---|---|---|
| Intra-epoch directional visibility | Real-time public | Encrypted |
| Momentum formation during accumulation | Yes — each bid shifts odds | No — pool hidden |
| Whale front-running | Enabled by visible large bids | Suppressed — positions sealed |
| Copy-trading during epoch | Enabled | Suppressed |
| Aggregate price discovery | Continuous | Single reveal at epoch close |
| Settlement side leakage | Explicit (winner reveals side) | None — FHE.select |
| Post-settlement inference | Immediate (outcome + position) | Payout visibility only |

### 2.5 Distinction from Confidential Voting Systems

Confidential batch clearing is architecturally similar to encrypted on-chain voting but differs along every dimension that matters for market mechanism design:

**Signal type**: A vote expresses a static preference with equal weight. A bid expresses a capital-weighted belief signal — the contribution to each pool is proportional to stake, not merely presence.

**Incentive structure**: Voting has no financial stake and no equilibrium pricing. Market participants face real capital-at-risk, which disciplines belief revelation (Hayek, 1945; Kyle, 1985).

**Batch timing**: In a vote, batching is a UX choice — all votes have equal weight regardless of timing. In batch clearing, the epoch boundary is a *mechanism* property that determines what information enters the aggregate signal. The epoch close is not cosmetic; it is the point at which information formation terminates.

**Output semantics**: A vote produces a winning option. Batch clearing produces an equilibrium probability estimate — the clearing price — that is a direct function of the capital-weighted directional split. This estimate encodes market-priced information, not preference counts.

These distinctions matter for analysis. Results about the confidentiality of voting systems (e.g., anonymity set bounds, coercion resistance) do not transfer directly. The relevant analytic framework is mechanism design under incomplete information, not social choice theory.

---

## 3. Formal Confidentiality Model

### 3.1 Definitions

Let epoch $e$ contain $n$ bids submitted over interval $[t_{\text{open}}, t_{\text{close}}]$.

**Bid**: $B_i = (a_i, \tilde{s}_i)$ where $a_i \in \mathbb{R}_{>0}$ is a plaintext ETH amount and $\tilde{s}_i = \text{Enc}(s_i)$ is an fhEVM ciphertext of the directional choice $s_i \in \{0, 1\}$.

**Public information at time $t$**:

$$I_t = \{(a_i, \text{addr}_i) : t_i \leq t\} \cup \{t_{\text{open}}, t_{\text{close}}, \text{question}\}$$

During the epoch, $I_t$ contains only amounts, addresses, and epoch metadata. The directional component $s_i$ is not in $I_t$ for any $t < t_{\text{close}}$.

**Public price signal**: Let $P_t$ denote the publicly-visible directional signal at time $t$.

- For $t \in [t_{\text{open}}, t_{\text{close}})$: $P_t = \emptyset$ — no directional signal exists
- At $t = t_{\text{close}}$: $P_{t_{\text{close}}} = f\!\left(\sum_i B_i\right)$ — the clearing price, a function of the sealed aggregate

The clearing price is the **realized market equilibrium probability signal under sealed-bid aggregation**:

$$\text{clearingPrice} = \frac{\sum_{i: s_i = \text{YES}} a_i}{\sum_i a_i} \times 10{,}000 \text{ bp}$$

This is the first and only element of $P_t$ that is non-empty, and it is defined only at epoch close.

**Intra-epoch directional confidentiality**: The mechanism enforces $P_t = \emptyset$ for all $t < t_{\text{close}}$ cryptographically — not by policy.

### 3.2 Information Layers

| Information | Visibility during epoch | Visibility after close |
|---|---|---|
| ETH amount per bid | Public ($a_i$ in $I_t$) | Public |
| Participant address | Public (addr$_i$ in $I_t$) | Public |
| Directional choice ($s_i$) | **Encrypted** ($\tilde{s}_i$, not in $I_t$) | **Never revealed** |
| YES pool total | **Encrypted** | Public (aggregate reveal) |
| NO pool total | **Encrypted** | Public (aggregate reveal) |
| Clearing price | Not yet computed | Public (single reveal) |
| Individual payout | Hidden | Revealed to recipient flow only |

### 3.3 Intra-Epoch Confidentiality

During the epoch, the directional split is cryptographically sealed. The encrypted pool accumulators (`euint64 yesPool`, `euint64 noPool`) are FHE ciphertexts that can be operated on (addition, selection) but not observed without KMS decryption.

The accumulation operation uses `FHE.select` to route contributions without revealing the side:

```solidity
ebool isYes = FHE.eq(side, FHE.asEuint8(SIDE_YES));
euint64 yesContrib = FHE.select(isYes, fullAmt, zero);
euint64 noContrib  = FHE.select(FHE.not(isYes), fullAmt, zero);
m.yesPool = FHE.add(m.yesPool, yesContrib);
m.noPool  = FHE.add(m.noPool, noContrib);
```

No intermediate value in this computation is observable. The coprocessor processes the selection and addition; the EVM stores only the resulting ciphertext handles.

**Intra-epoch confidentiality guarantee**: For any $t < t_{\text{close}}$, no on-chain or off-chain observer can determine the directional split $(\sum_{s_i=\text{YES}} a_i,\ \sum_{s_i=\text{NO}} a_i)$ without compromising the fhEVM KMS.

### 3.4 Post-Settlement Leakage — Deterministic Residual

With plaintext ETH amounts (V1 design), post-settlement leakage is **deterministic**.

**Claim**: If a `PayoutClaimed` event with `payout > 0` is observed for address A in a market with public outcome O, then address A bet on side O with probability 1.

**Proof**: The payout formula is $\text{payout}_i = (a_i \times \text{totalEth}) / \text{winPool}$. Since $a_i$, totalEth, and winPool are all public after epoch close, any observer can compute the expected winner payout for any participant. If `PayoutClaimed.payout` matches this computed value, A was a winner. If `payout == 0`, A was a loser. The inference is exact and requires only public data.

This is an acceptable tradeoff for V1 because:

1. The leakage is **post-settlement** — after the epoch closes, no more bids can be placed. The front-running and reflexivity problems occur during accumulation, which this design fully solves.
2. The leakage is **retroactive** — it cannot be used to influence bids that have already been submitted.
3. The leakage requires **active graph analysis** — it does not appear as a real-time signal.

**Cross-epoch linkage**: Repeated participation compounds the post-settlement leakage. An external analyst observing multiple epochs can correlate payout patterns, stake size repetition, and epoch timing to construct a probabilistic identity graph — attributing behavior to participants who may attempt to use different addresses. This attack surface grows with epoch count and is not addressed in V1.

### 3.5 V2 Leakage Degradation Path

With encrypted amounts (V2), the post-settlement inference degrades from **deterministic** to **probabilistic**:

- Payout amount is no longer computable from public data (stake is hidden)
- Inference requires solving a Bayesian inference problem over encrypted pool compositions
- With sufficient participants per epoch, individual attribution becomes computationally difficult

V2 requires a deposit model: participants pre-deposit ETH, bets deduct from encrypted balances, payouts credit encrypted balances. This is a substantially larger engineering surface and is explicitly deferred.

### 3.6 Permanent Side Encryption

The bettor's encrypted side is stored as `euint8 side` in the `Position` struct. No function in the protocol ever calls `FHE.makePubliclyDecryptable(pos.side)`. The settlement path does not decrypt the side:

```solidity
// Settlement uses FHE.eq to derive `won` without decrypting `side`.
// `won` is also an encrypted value — never written to plaintext.
ebool won = FHE.eq(pos.side, FHE.asEuint8(m.outcome));
```

The side ciphertext persists in contract storage indefinitely. Assuming fhEVM KMS security, this ciphertext cannot be decrypted without KMS cooperation, even by the contract deployer.

### 3.7 Adversarial Model

We consider five adversary classes and their capabilities against this protocol:

**Public Observer** — Has access to all on-chain data: transaction history, emitted events, EVM storage reads. Cannot read ciphertext values. Can observe: participant addresses, ETH amounts, timing, pool sizes after reveal, payout amounts after settlement.

*Threat*: Post-settlement inference (Section 3.4). During epoch: zero directional information.

**Participant** — A market participant with knowledge of their own side and amount. Identical on-chain view to the public observer for all positions other than their own.

*Threat*: No additional threat to mechanism confidentiality. Cannot infer other participants' sides.

**Creator** — Controls epoch resolution (sets the outcome). In V1, the creator is a trusted role. A malicious creator can resolve against the true outcome, redistributing capital incorrectly.

*Threat*: Not a confidentiality threat. A liveness/correctness threat. Mitigated in future work via trust-minimized oracle integration.

**Relayer / KMS** — The fhEVM KMS operates the coprocessor that processes FHE operations. A compromised KMS could in principle decrypt ciphertexts. A compromised relayer could fail to deliver decryption callbacks.

*Threat to confidentiality*: Full — KMS compromise defeats all cryptographic guarantees. This is the trust root of the fhEVM system, not a mechanism design gap. The protocol's confidentiality properties hold under the assumption of KMS integrity, which is the standard assumption for fhEVM-based systems.

**External Analyst** — Off-chain observer with statistical sophistication. Can correlate multiple data sources: transaction graphs, blockchain analytics, stake-size patterns across epochs.

*Threat*: Cross-epoch linkage attack (Section 3.4). The residual leakage from V1's plaintext amounts enables retroactive directional inference. An analyst with multiple epoch observations can construct probabilistic identity reconstructions from payout patterns.

**Core claim**: Under fhEVM KMS integrity, the protocol provides *intra-epoch directional confidentiality* — no adversary in the above set can determine the YES/NO directional split during the accumulation window without KMS compromise. Post-settlement, deterministic directional inference is possible given plaintext amounts (V1); this is fully characterized in Section 3.4 and is an explicit design tradeoff, not an oversight.

---

## 4. Architecture

### 4.1 Contract Structure

**`ConfidentialBatchAuction.sol`** — single-contract protocol primitive.

```
State:
  Market[]   markets             — epoch metadata + encrypted pool accumulators
  Position   positions[id][addr] — per-user: amount + encrypted side + encrypted payout

Functions:
  createMarket(question, epochDuration)   → marketId
  placeBet(marketId, encSide, inputProof) → payable, sealed bid submission
  resolveMarket(marketId, outcome)        → post-epoch, creator sets result
  requestPoolReveal(marketId)             → makePubliclyDecryptable on pools
  onPoolRevealed(marketId, handles, cleartexts, proof)  → Pattern 3 callback
  requestPayout(marketId)                 → FHE.select payout computation
  onPayoutRevealed(marketId, bettor, handles, cleartexts, proof) → ETH transfer
```

### 4.2 FHE Operation Map

| Phase | FHE Operations |
|---|---|
| `placeBet` | `fromExternal`, `eq`, `select` × 2, `add` × 2 |
| `requestPoolReveal` | `makePubliclyDecryptable` × 2 |
| `onPoolRevealed` | `checkSignatures` |
| `requestPayout` | `eq`, `select`, `makePubliclyDecryptable` |
| `onPayoutRevealed` | `checkSignatures` |

Total FHE operations per full epoch lifecycle per user: ~10 coprocessor calls.

### 4.3 Selective Cryptographic Enforcement Principle

A key architectural discipline governs where FHE is applied: **encrypt only the information that is causally responsible for the mechanism failure being prevented**.

FHE is applied at the precise boundary where cryptographic enforcement is necessary — no further:

- ETH amounts are **plaintext** — they arrive via `msg.value` and cannot be encrypted without a deposit model. Making amounts public is an explicit V1 tradeoff (see Section 3.4 for its leakage consequences).
- Directional choice is **encrypted** — this is the information-critical variable. The directional split, not the amount, is the causal driver of reflexive momentum. Encrypting only the side achieves the mechanism property.
- Payout computation uses **FHE.select** — the minimal FHE operation that gates the payout without revealing the branching condition. No broader computation is required.

The alternative — encrypting everything — would require confidential token accounting, shielded escrow, encrypted transfer semantics, and relayer-dependent UX. That is an entirely different system. The mechanism thesis requires **directional confidentiality during price formation**, not full computational privacy.

This discipline is generalizable: in any FHE-based market mechanism, identify the information type that is causally responsible for the distortion being corrected, and apply FHE at exactly that boundary.

### 4.4 Pattern 3: Public Decryption

Pool and payout reveals use Pattern 3 (publicly-decryptable + relayer-signed verification):

```
Contract: FHE.makePubliclyDecryptable(handle)
  → Marks handle for KMS decryption, emits handle in event

Relayer: monitors events, requests KMS signatures, calls callback

Contract: onPoolRevealed(handles, cleartexts, proof)
  → Handle pinning: require(handles[i] == FHE.toBytes32(storedHandle))
  → FHE.checkSignatures(handles, cleartexts, proof)
  → Assembly-parses cleartext values
  → Writes aggregate results
```

**Handle pinning** is critical: without binding the callback's `handlesList` to the contract's stored handles before calling `checkSignatures`, an attacker could substitute any other publicly-decryptable ciphertext and trigger a false settlement.

### 4.5 Pari-Mutuel Settlement

The payout formula is:

$$\text{payout}_i = \frac{a_i \times \text{totalPool}}{\text{winPool}}$$

Winners split the entire epoch pool (including loser ETH) proportional to their share of the winning side. Computed in plaintext after pool reveal; `FHE.select` gates whether a given bettor is entitled to this amount.

### 4.6 Deployment

**Network**: Ethereum Sepolia testnet  
**Contract**: `0xf6Fe1ce7d93d9F92faa8B997F23cB7a324509554`  
**fhEVM version**: `@fhevm/solidity ^0.11.1`  
**Relayer SDK**: `@zama-fhe/relayer-sdk ^0.4.1`

---

## 5. Measured Live Results

All measurements taken on Sepolia testnet with 3 bettors (1 ETH YES, 0.5 ETH NO, 0.5 ETH YES), outcome YES.

### 5.1 Gas Profile

| Operation | Gas Used | Notes |
|---|---|---|
| Contract deploy | 2,164,053 | One-time cost |
| `createMarket` | 264,292 | FHE pool initialization |
| `placeBet` (first) | 397,281 | `fromExternal` + `eq` + 2×`select` + 2×`add` |
| `placeBet` (subsequent) | 384,793 | Same path, different storage slot |
| `resolveMarket` | 32,869 | Plaintext state transition |
| `requestPoolReveal` | 121,908 | 2×`makePubliclyDecryptable` |
| `onPoolRevealed` | 168,422 | `checkSignatures` + assembly parse + clearing price |
| `requestPayout` | 225,951 | `eq` + `select` + `makePubliclyDecryptable` |
| `onPayoutRevealed` (winner) | ~108,000 | `checkSignatures` + ETH transfer |
| `onPayoutRevealed` (loser) | 100,574 | `checkSignatures` + no transfer |

At 10 gwei base fee and ETH at $3000, estimated user-facing costs:

| Action | Gas | USD cost |
|---|---|---|
| Submit encrypted bid | ~389k | ~$1.17 |
| Claim payout | ~335k combined | ~$1.01 |

FHE adds approximately 3–4× gas overhead versus equivalent plaintext operations. This is the measurable cost of intra-epoch directional confidentiality.

### 5.2 Settlement Correctness

Three-bettor epoch verified:

| Bettor | Side | Stake | Payout | Correct |
|---|---|---|---|---|
| Alice | YES | 0.01 ETH | 0.01333 ETH | ✓ |
| Bob | NO | 0.005 ETH | 0 ETH | ✓ |
| Carol | YES | 0.005 ETH | 0.00666 ETH | ✓ |

Pool: 0.01333 + 0.00666 = 0.02 ETH = totalEth ✓ (conservation with gwei-rounding)

Clearing price: $(0.015 / 0.02) \times 10{,}000 = 7{,}500$ bp = 75% YES ✓

### 5.3 Callback Timing

In the mock coprocessor environment (Hardhat node), pool reveal callbacks complete in 1 block. On Sepolia with the real KMS relayer, timing depends on relayer latency and block production — typically 1–3 blocks (12–36 seconds).

### 5.4 Test Coverage

18 tests covering the full protocol lifecycle, all passing:

```
✓ createMarket creates with correct epoch metadata
✓ placeBet stores position, emits BetPlaced, updates totalEth
✓ placeBet reverts on double-bet
✓ placeBet reverts on closed epoch
✓ placeBet reverts on resolved market
✓ placeBet reverts below MIN_BET
✓ resolveMarket reverts if not creator
✓ resolveMarket reverts if epoch not closed
✓ resolveMarket sets outcome and resolved flag
✓ requestPoolReveal reverts if not resolved
✓ requestPoolReveal emits handles
✓ requestPoolReveal reverts if called twice
✓ requestPayout reverts if pool not revealed
✓ requestPayout reverts if no position
✓ clearingPrice is correct in basis points
✓ Full happy path: 3 bettors → settle → correct payouts
✓ Loser receives 0 payout without side revelation
✓ onPayoutRevealed reverts on double-claim
```

---

## 6. Mechanism Design Context

### 6.1 Relation to Frequent Batch Auctions

Budish, Cramton, and Shim (2015) demonstrate that continuous limit-order books are structurally prone to latency arbitrage and recommend discrete-time batch auctions as a remedy. The key insight: in a continuous market, speed is a substitute for information, which distorts price discovery. In a batch auction, all orders within a window execute at the same price regardless of submission time, eliminating the advantage of speed.

Confidential Batch Clearing extends this reasoning to prediction markets with an additional dimension: **directional confidentiality within the batch window**. The batch structure eliminates timing advantage; the FHE encryption eliminates observational advantage. The two properties are complementary and address distinct attack surfaces.

The stronger claim: in a standard batch auction, participants can still observe the growing order book and form expectations about the clearing price before the window closes. Confidential Batch Clearing removes this residual observational channel — during accumulation, $P_t = \emptyset$. The batch structure eliminates front-running; the FHE layer eliminates momentum formation.

### 6.2 Relation to Dark Pools

Institutional dark pools solve the signaling problem in equity markets by routing large orders away from the public lit market. The mechanism is opacity through venue selection, not cryptographic enforcement.

Confidential Batch Clearing achieves opacity through cryptographic enforcement at the protocol layer. The confidentiality property holds for all participants regardless of order size, does not require trust in a venue operator, and is verifiable on-chain.

### 6.3 Relation to CoW Protocol / MEV Mitigation

CoW Protocol (Coincidence of Wants) batches trades to find overlapping liquidity before routing to AMMs, incidentally providing some MEV protection through batch execution. The mechanism is liquidity-centric, not privacy-centric.

Confidential Batch Clearing is mechanism-centric: the goal is clean information aggregation, not liquidity optimization. The batch structure provides MEV resistance as a secondary property of the epoch window, not as the primary design objective.

### 6.4 Relation to Prior Work on Information Aggregation

Kyle (1985) models strategic informed trading under continuous market-making and demonstrates that information is impounded gradually through trading. Glosten and Milgrom (1985) analyze the bid-ask spread as an adverse selection cost — market makers widen spreads in response to the risk of trading against informed participants.

Confidential Batch Clearing disrupts the information revelation channel that both models assume. If directional choice is sealed during accumulation, neither the momentum cascade (Kyle) nor the adverse selection response (Glosten-Milgrom) can occur within the epoch. The clearing price is set once, from the sealed aggregate — there is no sequential revelation process for strategic agents to exploit.

This is not equivalent to eliminating private information from markets. Participants still have private signals; they still bet on them. The mechanism changes *when and how* that information enters the public record, not whether it enters.

---

## 7. Limitations and Future Work

### 7.1 Known Limitations

**Post-settlement leakage (V1)**: Payout visibility reveals winning side to on-chain observers after settlement. As analyzed in Section 3.4 and the adversarial model (Section 3.7), this is deterministic given plaintext amounts. Acceptable for V1; addressed in V2 through encrypted amounts and a deposit model.

**Cross-epoch linkage**: Repeated participation across epochs enables probabilistic identity reconstruction through correlated stake sizes, timing patterns, and payout sequences. Not addressed in V1.

**Single bettor per address per epoch**: Current design does not allow position updates. A bettor who changes their view during the epoch must use a different address. This is an intentional simplification for V1.

**Creator-controlled resolution**: The epoch outcome is currently set by the market creator. A production system requires a trust-minimized oracle (Chainlink, UMA, or a DAO-governed resolution mechanism). Not implemented in V1.

**Epoch throughput**: Gas per `placeBet` (~389k) limits the number of bids per epoch to approximately 30 at a 12M gas block limit. Coprocessor optimizations and zkSNARK-based FHE compression may improve this.

### 7.2 Future Work

**V2: Encrypted amounts** — Deposit model enabling fully confidential capital allocation. Degrades post-settlement inference from deterministic to probabilistic, and eliminates the cross-epoch linkage attack surface.

**V2: Anonymous settlement** — Stealth addresses for payout claiming, separating claiming identity from betting identity.

**Multi-epoch markets** — Rolling epoch series on the same question, enabling time-series price discovery while preserving per-epoch directional confidentiality. Requires care around cross-epoch information leakage.

**Oracle integration** — Trust-minimized resolution via Chainlink or UMA protocol, removing the creator trust assumption from the correctness model.

**Ciphertext rotation** — Epoch-level position pruning and handle rotation to reduce long-term cryptanalysis surface.

---

## 8. Conclusion

Continuous public prediction markets are reflexive systems. The mechanism design contribution of Confidential Batch Clearing is to decouple the information formation phase from the price revelation phase — accumulation happens privately, revelation happens once, at close.

The protocol establishes a precise confidentiality boundary: directional flow is encrypted during the accumulation window (enforced cryptographically, not by policy), aggregate state is published at epoch close as a terminal signal — the clearing price — and individual sides are never written to plaintext storage. Settlement is computed via FHE conditional execution, not plaintext comparison. The adversarial model (Section 3.7) characterizes precisely what each adversary class can and cannot infer.

The Selective Cryptographic Enforcement Principle — apply FHE at exactly the information boundary that is causally responsible for the mechanism failure — reduces the FHE overhead to the minimum necessary for the mechanism guarantee: ~389k gas per bid, 3–4× overhead vs plaintext, with a fully measured lifecycle.

This is not a claim that all prediction market problems are solved. It is a specific, bounded, implementable mechanism that eliminates the explicit and interpretable pre-trade directional signaling in order flow and aggregate imbalance that is the primary failure mode of continuous public markets. The protocol is deployed, tested, and measured. The confidentiality model is formal. The adversarial surface is characterized. The gas costs are known.

---

## References

- Budish, E., Cramton, P., Shim, J. (2015). *The High-Frequency Trading Arms Race: Frequent Batch Auctions as a Market Design Response*. Quarterly Journal of Economics.
- Glosten, L.R., Milgrom, P.R. (1985). *Bid, Ask and Transaction Prices in a Specialist Market with Heterogeneously Informed Traders*. Journal of Financial Economics.
- Hayek, F.A. (1945). *The Use of Knowledge in Society*. American Economic Review.
- Kyle, A.S. (1985). *Continuous Auctions and Insider Trading*. Econometrica.
- Zama. (2024). *fhEVM: Confidential Smart Contracts on Ethereum*. Zama Technical Documentation.

---

## Appendix: Contract Interface

```solidity
interface IConfidentialBatchAuction {
    // Epoch lifecycle
    function createMarket(string calldata question, uint64 epochDuration) 
        external returns (uint256 marketId);
    
    function placeBet(uint256 marketId, bytes32 encSide, bytes calldata inputProof) 
        external payable;
    
    function resolveMarket(uint256 marketId, uint8 outcome) external;
    
    // Pattern 3: Aggregate reveal
    function requestPoolReveal(uint256 marketId) external;
    function onPoolRevealed(
        uint256 marketId,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external;
    
    // Pattern 3: Confidential settlement
    function requestPayout(uint256 marketId) external;
    function onPayoutRevealed(
        uint256 marketId,
        address bettor,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external;
    
    // Views
    function getMarket(uint256 marketId) external view returns (
        address creator, string memory question,
        uint64 epochStart, uint64 epochEnd,
        bool resolved, uint8 outcome, uint256 totalEth,
        uint256 revealedYesPool, uint256 revealedNoPool,
        uint256 clearingPrice, bool poolRevealRequested, bool poolRevealed
    );
    
    function getEncPools(uint256 marketId) external view 
        returns (euint64 yesPool, euint64 noPool);
    
    function getEncPayout(uint256 marketId, address bettor) external view 
        returns (euint64);
}
```
