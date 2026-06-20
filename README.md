# Pri-Markets

<p align="center">
  <a href="https://pri-markets.vercel.app"><img src="https://img.shields.io/badge/▶_Live_Demo-00C853?style=for-the-badge&logoColor=white" alt="Live Demo"/></a>
  <img src="https://img.shields.io/badge/FHE_Market_Primitive-7aa2f7?style=for-the-badge" alt="category"/>
  <img src="https://img.shields.io/badge/License-MIT-bb9af7?style=for-the-badge" alt="MIT"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Solidity_0.8.24-363636?style=flat-square&logo=solidity&logoColor=white"/>
  <img src="https://img.shields.io/badge/fhEVM_(Zama)-FFD200?style=flat-square&logoColor=black"/>
  <img src="https://img.shields.io/badge/Hardhat-FFF100?style=flat-square&logo=hardhat&logoColor=black"/>
  <img src="https://img.shields.io/badge/React_18_+_Vite-61DAFB?style=flat-square&logo=react&logoColor=black"/>
  <img src="https://img.shields.io/badge/Sepolia-627EEA?style=flat-square&logo=ethereum&logoColor=white"/>
</p>

**Sealed-bid directional discovery for information markets — built on fhEVM**

> No live order flow. No pre-trade signaling. Aggregate-only price discovery. Both **side and amount** encrypted end-to-end.

## Live Demo

| | |
|---|---|
| **Frontend** | https://pri-markets.vercel.app |
| **Contract** | [`0xF00573FbBE32264ac14442BDC39512845D0d41C1`](https://sepolia.etherscan.io/address/0xF00573FbBE32264ac14442BDC39512845D0d41C1) — `ConfidentialBatchAuction` V2 (token-only, fee + treasury) on **Sepolia** |
| **Collateral** | cUSDC (ERC-7984) — official Zama mock `0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639`, wraps mock USDC `0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF` |

The deployed contract, the wired frontend, and an always-on keeper are all V2. Connect a Sepolia wallet, mint test USDC from the in-app faucet, and place a sealed bid — the keeper resolves and reveals epochs automatically.

## What This Is

Continuous prediction markets leak directional flow continuously. Every bid shifts visible odds, creating reflexive momentum, copy-trading, and consensus-formation loops that corrupt price discovery.

Pri-Markets is a confidential market-microstructure primitive that fixes this:

- Bids accumulate during a fixed epoch with **encrypted YES/NO sides and encrypted amounts**
- No directional information is visible during accumulation
- At epoch close, **one aggregate clearing price** is revealed
- Individual sides are never decrypted — settlement reads the winning encrypted sub-pool directly

### Fully-confidential collateral (cUSDC / ERC-7984)

Collateral is the confidential token **cUSDC** (ERC-7984). Both **side and amount** are encrypted
end-to-end: a bet is `createEncryptedInput().add8(side).add64(amount)`, pools accumulate in the
coprocessor, and payout is computed with `FHE.mul`/`FHE.div` and moved via `confidentialTransfer` —
**never** touching plaintext storage or events. Nothing leaks, even after settlement.

```ts
// frontend/src/lib/fhe/encrypt.ts — one input proof covers BOTH side and amount
const buf = fhevmInst.createEncryptedInput(contractAddress, userAddress);
buf.add8(BigInt(side));   // 0 = NO, 1 = YES   (encrypted)
buf.add64(amountRaw);     // cUSDC amount      (encrypted)
const enc = await buf.encrypt();
// → enc.handles[0] = side, enc.handles[1] = amount, enc.inputProof (shared)
```

### Protocol fee & treasury

At pool reveal the contract skims a **protocol fee** (default **2%** / 200 bps, owner-adjustable up to a
hard-capped `MAX_FEE_BPS = 10%`). Winners split `distributable = totalPool − feeAmount`; the fee — and,
when a market has **no winners**, the entire stranded pot — is swept to the `treasury` via a
permissionless, idempotent `sweepFees()`. The clearing price is stored in basis points (0–10000).

## Architecture

```
┌──────────────────────────┐      reads / writes      ┌─────────────────────────────┐
│  Frontend (React + Vite) │ ───────────────────────▶ │  ConfidentialBatchAuction   │
│  RainbowKit · wagmi/viem │                          │  (fhEVM, Sepolia)           │
│  @zama-fhe/relayer-sdk    │ ◀─── encrypted I/O ─────  │  cUSDC (ERC-7984) collateral│
└───────────┬──────────────┘                          └──────────────┬──────────────┘
            │ encrypt / decrypt                                       │ events
            ▼                                                         ▼
┌──────────────────────────┐                          ┌─────────────────────────────┐
│  /api/zama-relay (edge)   │ ──▶ relayer.testnet      │  Keeper (Node, systemd)     │
│  per-path proxy → /v2,    │     .zama.org/v2          │  auto-resolve (oracle) +    │
│  CORS + binary-safe       │     (KMS pub/user decrypt)│  auto pool-reveal, resumable│
└──────────────────────────┘                          └─────────────────────────────┘
```

Three components, one repo:

- **`contracts/`** — `ConfidentialBatchAuction.sol` (V2) + ERC-7984/USDC mocks. Hardhat + `@fhevm/hardhat-plugin`.
- **`keeper/`** — a Node/ethers service that polls every 30 s, **auto-resolves** oracle epochs (`resolveByOracle`) and **auto-reveals** pools (`requestPoolReveal` → public-decrypt → `onPoolRevealed`), with resumable on-disk state and demo-slot refresh. Ships as a `systemd` unit (`keeper/deploy/cba-keeper.service`).
- **`frontend/`** — the React dApp (deployed on Vercel).

## Protocol Lifecycle

```
Epoch opens
  ↓
Encrypted bids accumulate (direction sealed, amount sealed, bid/bettor counts public)
  ↓
Epoch closes — no more bids
  ↓
Market resolves — permissionless Chainlink oracle (resolveByOracle, anyone)
                  or creator (resolveMarket, non-oracle markets only)        ← keeper does this
  ↓
Pool reveal — aggregate YES / NO volumes decrypted via KMS (onPoolRevealed)  ← keeper does this
  ↓
Protocol fee skimmed (default 2%); clearing price published (yesPool / totalPool, bps)
  ↓
Single-tx settlement: payout = winningStake * distributable / winPool, in the coprocessor
  ↓
sweepFees() → fee (and any no-winner pot) to treasury · individual side & amount stay encrypted forever
```

The resolve and pool-reveal steps are **permissionless** and the keeper performs them automatically
within ~30 s of epoch close; the in-app buttons are manual fallbacks (see [Frontend](#frontend)).

## Keeper

`keeper/` is an autonomous settler so demo epochs progress without manual clicks:

- **Poll loop** — every 30 s it sweeps markets; oracle epochs past close are resolved via
  `resolveByOracle`, and resolved-but-unrevealed pools are decrypted (KMS public-decrypt) and posted
  with `onPoolRevealed`.
- **Resumable** — progress is persisted to disk and back-filled from the V2 deploy block, so a restart
  never double-acts or loses place.
- **Resilient** — retry-with-backoff on RPC errors and a public-node RPC fallback.
- **Ops** — runs as `cba-keeper.service`; needs a funded Sepolia keeper wallet (gas for resolve /
  reveal txns) and a Sepolia RPC. An **Alchemy** RPC is recommended — the keeper's batched
  `eth_getLogs` back-fill trips Infura's free-tier rate limit.

```bash
cd keeper && npm install
cp .env.example .env     # KEEPER_PRIVATE_KEY, SEPOLIA_RPC_URL
npm run build && npm run start:prod
```

## Frontend

React 18 + Vite + TypeScript, wagmi v2 / viem, RainbowKit, and `@zama-fhe/relayer-sdk` — fully wired
to the V2 token-only contract.

- **Sealed bidding** — pick YES/NO + amount; the client encrypts both (`add8(side).add64(amount)`),
  then runs approve → wrap USDC→cUSDC → authorize operator → `placeBet`, mining each dependent step.
- **Top-ups & hedging** — bet again on either side; per-position encrypted sub-pools accumulate.
- **Aggregate reveal & private payout** — see the revealed YES/NO split + clearing price (in **cUSDC**);
  winners decrypt their **own** payout client-side via the relayer `userDecrypt` (EIP-712 grant).
- **Test USDC faucet** — one-click mint of mock USDC on Sepolia.

Engineering details:

- **Relayer proxy** — `frontend/api/zama-relay.js` (Vercel Edge) forwards the SDK to
  `relayer.testnet.zama.org/v2`, normalizing paths to the `/v2` protocol and preserving binary
  payloads + CORS, so the browser never talks to the relayer cross-origin.
- **Cross-origin isolation** — `frontend/vercel.json` sets COOP `same-origin` + COEP `require-corp`
  + a CSP tuned so the FHE WASM worker loads (required for `SharedArrayBuffer`).
- **Keeper-aware UX** — the resolve/reveal panels show a "keeper handles this automatically" hint and
  expose the manual action only as a fallback.
- **Resilience** — a shared `getErrMsg` surfaces terse wallet/relayer errors; FHE init is
  timeout-guarded with a one-click **retry**; the bet button blocks on insufficient/empty balance.
- **WalletConnect is opt-in & format-validated** — `VITE_WALLETCONNECT_PROJECT_ID` is only used if it's
  a real 32-hex Reown id (a bad value would otherwise half-initialize a connector and throw
  `connector.getChainId is not a function` on the first write). Without it, injected/MetaMask/Rabby
  still work and the UI shows a "WalletConnect disabled" hint.
- **Lazy-loaded** — routes are code-split and the heavy Zama SDK is dynamically imported, keeping the
  initial bundle ~1 MB instead of ~1.9 MB.

## Cost Profile

A confidential contract has **two** independent budgets: on-chain **EVM gas** (every explorer shows
it) and per-transaction **HCU** — the off-chain coprocessor compute budget that is capped per tx and
that **no block explorer or `hardhat-gas-reporter` measures**. Blow the HCU cap and the tx is mined
but the decryption/compute silently fails. Both are reported below.

### HCU Cost Profile — `ConfidentialBatchAuction` (V2)

_Generated by [fhe-gas-profiler](https://github.com/Laolex/fhe-gas-profiler) · @fhevm/solidity 0.11.1 · mock-utils 0.4.2 · solc 0.8.28 · report confidence **LOW**._

| Function | txHCU | ownHCU | Confidence | Why |
|---|--:|--:|:--|:--|
| `claim` | 1,080,032 | 1,080,032 | LOW | unresolved edge: confidentialTransfer() |
| `placeBet` | 813,130 | 813,130 | LOW | unresolved edge: confidentialTransferFrom() |
| `_initMarket` | 64 | 64 | HIGH | straight-line |
| `requestPoolReveal` | 0 | 0 | HIGH | straight-line |
| `onPoolRevealed` | 0 | 0 | HIGH | straight-line |

> **txHCU** is the per-transaction Homomorphic Complexity Unit cost — the off-chain coprocessor budget
> (capped per tx), invisible to `hardhat-gas-reporter` and every block explorer. **Confidence** is the
> minimum of three axes (semantic · control-flow · graph-completeness); the **Why** column names the
> binding one. `claim` / `placeBet` read **LOW** because they call the external ERC-7984
> `confidentialTransfer` / `confidentialTransferFrom`, whose FHE ops bill against the **same per-tx HCU
> budget** but whose bodies are outside this contract — so `txHCU` is an explicit *lower bound*, not a
> silent under-count. Both are ~4–5% of the ~20M per-tx cap.

**V1 → V2 delta (the profiler as V2's instrument):** top-up support added two per-position sub-pool
`FHE.add`s, moving a bet **489,066 → 813,130 HCU** (+324k); the simpler settlement removed an
`FHE.eq`+`FHE.select`, *cutting* claim **1,190,096 → 1,080,032 HCU** (−110k). Reproduce against the
build-info with `node scripts/profile-external.mjs <build-info> contracts/ConfidentialBatchAuction.sol ConfidentialBatchAuction`.

## Confidentiality Model

| Layer | During Epoch | After Close |
|---|---|---|
| Directional choice | Encrypted | Never revealed |
| Bet amount | Encrypted | Never revealed |
| YES / NO split | Encrypted | Public (aggregate only) |
| Clearing price | Hidden | Single reveal |
| Individual payout | Encrypted | Recipient flow only |

Because amount and side are both encrypted end-to-end (cUSDC / ERC-7984) and payout moves via
`confidentialTransfer`, **nothing leaks even after settlement** — there is no retroactive directional
inference. The reflexivity problem — which occurs *during accumulation* — is fully solved.

```solidity
// contracts/ConfidentialBatchAuction.sol — payout computed in the coprocessor; the side is never read
euint64 winStake = m.outcome == SIDE_YES ? pos.yesStake : pos.noStake; // 0 for losing-only bettors
euint64 encPayout = winPool > 0
    ? FHE.div(FHE.mul(winStake, uint64(m.distributable)), uint64(winPool))  // share of after-fee pool
    : FHE.asEuint64(0);
FHE.allow(encPayout, msg.sender);                       // only the claimer can decrypt their amount
IConfidentialUSDC(m.token).confidentialTransfer(msg.sender, encPayout);
```

## V2 design (token-only, fee + treasury)

V1 also shipped a plaintext-ETH path for the simplest onramp; because `msg.value` is public on-chain
that path leaked bet amounts. V2 is what's deployed and removes it:

- **Token-only.** The plaintext-ETH path is gone; the privacy leak it carried is gone with it.
- **Bet top-ups.** An address may bet repeatedly. Each position keeps two encrypted sub-pools
  (`yesStake` / `noStake`) that accumulate across bets, so repeated and **mixed-side** (hedged)
  betting are first-class. The old one-bet-per-address cap is removed.
- **Protocol fee + treasury.** 2% default (≤10% capped), no-winner pots swept to treasury.
- **Cheaper, simpler settlement.** `claim` reads the caller's winning sub-pool directly instead of an
  `FHE.eq`+`FHE.select` on the side — a losing-only bettor's winning stake is already 0.

See [`MECHANISM.md`](./MECHANISM.md) for the full mechanism-design paper.

## Stack

- **Contracts**: Solidity 0.8.24, `@fhevm/solidity ^0.11.1`, OpenZeppelin `Ownable` + `ReentrancyGuard`
- **Testing**: Hardhat + `@fhevm/hardhat-plugin`, **13 tests passing** (token-only V2 suite)
- **Keeper**: Node + ethers + `@zama-fhe/relayer-sdk`, runs as a `systemd` service
- **Frontend**: React 18, Vite, wagmi v2 / viem, RainbowKit, `@zama-fhe/relayer-sdk ^0.4.1`
- **Network**: Ethereum Sepolia testnet · **Hosting**: Vercel

## Setup

### Contracts

```bash
npm install
npx hardhat test test/ConfidentialBatchAuction.token.test.ts

# Deploy to Sepolia (treasury defaults to deployer if omitted)
npx hardhat vars set PRIVATE_KEY
npx hardhat vars set SEPOLIA_RPC_URL
npx hardhat run scripts/deploy.ts --network sepolia

# Seed demo oracle markets
CONTRACT_ADDRESS=0x... npx hardhat run scripts/seed-demo.ts --network sepolia
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # production build (tsc-clean; type-check separately with: npx tsc --noEmit)
```

Environment (`frontend/.env`, all optional):

```bash
VITE_WALLETCONNECT_PROJECT_ID=   # real 32-hex Reown id (cloud.reown.com); invalid/empty → WC disabled, injected wallets still work
VITE_SEPOLIA_RPC_URL=            # optional; defaults to a public Sepolia node
```

### Keeper

See [Keeper](#keeper) above.

## Deployment (Vercel)

The frontend is the deployed app; the Vercel project's **Root Directory is `frontend`** (the repo root
holds the Hardhat package). With that set, both git-linked deploys and CLI deploys build correctly.

```bash
# from the repo root, with the project linked
vercel --prod --yes
```

Set `VITE_WALLETCONNECT_PROJECT_ID` in the Vercel project env (Production) if you want WalletConnect
wallets; otherwise leave it unset. The contract is **not** redeployed for frontend changes.

## Demo Freshness

The live demo is seeded with long-running oracle epochs (ETH/USD, BTC/USD, LINK/USD at varying
strikes) and the keeper refreshes demo slots periodically, so there are always markets in
ACCUMULATING state to bid into — and resolved markets are auto-revealed.

Faucets for Sepolia ETH (gas):
- https://cloud.google.com/application/web3/faucet/ethereum/sepolia
- https://sepolia-faucet.pk910.de/

Test USDC (the bet collateral) is minted in-app via the faucet button.

## Test Results

```
13 passing — token-only V2 (cUSDC / ERC-7984)

✓ createMarket sets token address and zero counters
✓ placeBet stores position, emits BetPlaced(topUp=false), increments bettorCount
✓ top-up: an address can bet again; betCount grows, bettorCount stays, payout reflects the sum
✓ mixed-side: a hedged bettor is paid only on the winning sub-pool
✓ placeBet reverts on closed epoch
✓ placeBet reverts on resolved market
✓ pool reveal stores raw USDC units and correct clearing price
✓ claim: winner receives proportional payout
✓ claim: loser receives 0 payout without side being revealed
✓ claim reverts if pool not revealed
✓ claim reverts if no position
✓ claim reverts on double-claim
✓ Full happy path: 3 bettors → resolve → pool reveal → correct payouts
```

## Key Design Decisions

**Why not an AMM?** Division and logarithms are computationally infeasible in fhEVM at current
coprocessor capability. Batch auctions with `FHE.add`/`FHE.select` are the correct structure.

**Why token-only?** Native ETH can't be private — `msg.value` is public on-chain, so the V1 ETH path
always leaked bet amounts. cUSDC (ERC-7984) encrypts the amount end-to-end, so V2 drops ETH entirely
and the contract leaks nothing.

**Why per-position encrypted sub-pools?** They make top-ups and mixed-side betting first-class without
storing a plaintext side, and they *simplify* settlement: `claim` reads the caller's winning sub-pool
directly — a losing-only bettor's winning stake is already 0 — so no `FHE.eq`/`FHE.select` on the side
is needed. The side is never exposed and claim costs less HCU than the V1 `select`-based path.

**Why a keeper?** Resolve and pool-reveal are permissionless but require gas + a KMS round-trip; a
keeper makes the demo self-driving while the on-page buttons remain as a trustless fallback.

## License

MIT
