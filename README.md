# Confidential Batch Clearing

**Sealed-bid directional discovery for information markets — built on fhEVM**

> No live order flow. No pre-trade signaling. Aggregate-only price discovery.

## Live Demo

**Frontend**: https://confidential-batch-auction.vercel.app *(deploy after setup)*  
**Contract**: [`0xf6Fe1ce7d93d9F92faa8B997F23cB7a324509554`](https://sepolia.etherscan.io/address/0xf6Fe1ce7d93d9F92faa8B997F23cB7a324509554) on Sepolia

## What This Is

Continuous prediction markets leak directional flow continuously. Every bid shifts visible odds, creating reflexive momentum, copy-trading, and consensus formation loops that corrupt price discovery.

Confidential Batch Clearing is a market microstructure primitive that fixes this:

- Bids accumulate during a fixed epoch with encrypted YES/NO sides
- No directional information is visible during accumulation
- At epoch close, **one aggregate clearing price** is revealed
- Individual sides are never decrypted — settlement uses `FHE.select`

See [`MECHANISM.md`](./MECHANISM.md) for the full mechanism design paper.

## Protocol Lifecycle

```
Epoch opens
  ↓
Encrypted bids accumulate (direction sealed, volume public)
  ↓
Epoch closes — no more bids
  ↓
Creator resolves with oracle outcome
  ↓
Aggregate YES / NO volumes revealed (first and only directional signal)
  ↓
Clearing price published (yesPool / totalPool)
  ↓
FHE-gated settlement: FHE.select(won, payout, 0)
  ↓
Individual side remains encrypted forever
```

## Gas Profile (Measured on Sepolia)

| Operation | Gas | Notes |
|---|---|---|
| `placeBet` | ~389k | FHE encrypt + accumulate |
| `requestPoolReveal` | ~122k | makePubliclyDecryptable × 2 |
| `onPoolRevealed` | ~168k | checkSignatures + clearing price |
| `requestPayout` | ~226k | FHE.select branch computation |
| `onPayoutRevealed` | ~108k | checkSignatures + ETH transfer |

## Confidentiality Model

| Layer | During Epoch | After Close |
|---|---|---|
| Directional choice | Encrypted | Never revealed |
| YES / NO split | Encrypted | Public (aggregate only) |
| Clearing price | Hidden | Single reveal |
| Individual payout | Encrypted | Recipient flow only |

Post-settlement, payout visibility permits retroactive directional inference (deterministic with plaintext amounts). This is acceptable for V1 — the reflexivity problem occurs during accumulation, which this design fully solves.

## Stack

- **Contracts**: Solidity 0.8.24, `@fhevm/solidity ^0.11.1`, OpenZeppelin ReentrancyGuard
- **Testing**: Hardhat + `@fhevm/hardhat-plugin`, 18 tests passing
- **Frontend**: React 18, Vite, `@zama-fhe/relayer-sdk ^0.4.1`
- **Network**: Ethereum Sepolia testnet

## Setup

```bash
# Install contract dependencies
npm install

# Run tests
npx hardhat test test/ConfidentialBatchAuction.test.ts

# Deploy to Sepolia (set PRIVATE_KEY, SEPOLIA_RPC_URL via hardhat vars)
npx hardhat vars set PRIVATE_KEY
npx hardhat vars set SEPOLIA_RPC_URL
npx hardhat run scripts/deploy.ts --network sepolia

# Gas measurement (starts local node automatically)
npx hardhat node &
npx hardhat run scripts/measure-epoch.ts --network localhost

# Frontend
cd frontend && npm install && npm run dev
```

## Test Results

```
18 passing (14s)

✓ createMarket creates with correct epoch metadata
✓ placeBet stores position, emits BetPlaced, updates totalEth
✓ placeBet reverts on double-bet (same address)
✓ placeBet reverts on closed epoch
✓ placeBet reverts on resolved market
✓ placeBet reverts below MIN_BET
✓ resolveMarket reverts if not creator
✓ resolveMarket reverts if epoch not closed
✓ resolveMarket sets outcome and resolved flag
✓ requestPoolReveal reverts if not resolved
✓ requestPoolReveal emits PoolRevealRequested with 2 handles
✓ requestPoolReveal reverts if called twice
✓ requestPayout reverts if pool not revealed
✓ requestPayout reverts if no position
✓ clearingPrice is correct in basis points after pool reveal
✓ Full happy path: create → 3 bets → resolve → pool reveal → payout reveal → ETH transfers
✓ Loser receives 0 payout — no side reveal, no revert
✓ onPayoutRevealed reverts on double-claim
```

## Key Design Decisions

**Why not an AMM?** Division and logarithms are computationally infeasible in fhEVM at current coprocessor capability. Batch auctions with FHE.add/select are the correct structure.

**Why plaintext amounts?** Encrypting amounts requires a deposit model with confidential token accounting — a separate system. V1 validates the mechanism thesis without it.

**Why FHE.select for settlement?** The naive approach (`require(revealedSide == outcome)`) decrypts the side in plaintext. `FHE.select(won, payout, 0)` computes the payout entirely inside the coprocessor — the side is never exposed.

## License

MIT
