import { ethers, fhevm } from "hardhat";
import { expect } from "chai";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const SIDE_NO   = 0;
const SIDE_YES  = 1;
const ONE_HOUR  = 3600;

// 1 USDC = 1_000_000 raw units (6 decimals)
const TEN_USDC   = 10_000_000n;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function mockPublicDecrypt(handles: string[]) {
  return fhevm.publicDecrypt(handles);
}

/** Encrypt side (uint8) + amount (uint64) in one proof batch for the CBA contract. */
async function encryptBet(contractAddress: string, signerAddress: string, side: number, amountRaw: bigint) {
  const enc = await fhevm
    .createEncryptedInput(contractAddress, signerAddress)
    .add8(BigInt(side))
    .add64(amountRaw)
    .encrypt();
  return {
    encSide:    enc.handles[0] as `0x${string}`,
    encAmount:  enc.handles[1] as `0x${string}`,
    inputProof: enc.inputProof as `0x${string}`,
  };
}

/** Place an encrypted bet on behalf of a signer (token-only V2). */
async function placeBetFor(signer: any, cba: any, marketId: bigint, side: number, amountRaw: bigint) {
  const addr = await cba.getAddress();
  const { encSide, encAmount, inputProof } = await encryptBet(addr, signer.address, side, amountRaw);
  return cba.connect(signer).placeBet(marketId, encSide, encAmount, inputProof);
}

/** Request and submit the pool reveal (Pattern 3). */
async function doPoolReveal(cba: any, marketId: bigint) {
  await cba.requestPoolReveal(marketId);
  const [yesHandle, noHandle] = await cba.getEncPools(marketId);
  const proof = await mockPublicDecrypt([yesHandle, noHandle]);
  return cba.onPoolRevealed(marketId, [yesHandle, noHandle], proof.abiEncodedClearValues, proof.decryptionProof);
}

/** Call claim and return the decrypted payout (raw token units) via the mock's public handle. */
async function doClaim(cba: any, mock: any, marketId: bigint, bettor: any): Promise<bigint> {
  await cba.connect(bettor).claim(marketId);
  const handle = await mock.lastReceivedHandle(bettor.address);
  if (handle === ethers.ZeroHash) return 0n;
  const result = await mockPublicDecrypt([handle]);
  const [payoutRaw] = ethers.AbiCoder.defaultAbiCoder().decode(["uint64"], result.abiEncodedClearValues);
  return payoutRaw as bigint;
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite — token-only V2 (cUSDC / ERC-7984)
// ──────────────────────────────────────────────────────────────────────────────

describe("ConfidentialBatchAuction V2 — token-only, sub-pools, top-ups", function () {
  let alice: any, bob: any, carol: any, owner: any;

  before(async function () {
    await fhevm.initializeCLIApi();
  });

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
  });

  /** Deploy a harness whose _tokenAddress() points at a fresh mock cUSDC. */
  async function deployHarness(): Promise<{ harness: any; mockToken: any }> {
    const MockFactory = await ethers.getContractFactory("MockConfidentialUSDC");
    const mockToken   = await MockFactory.deploy();
    await mockToken.waitForDeployment();

    const HarnessFactory = await ethers.getContractFactory("CBATokenTestHarness");
    const harness        = await HarnessFactory.deploy(await mockToken.getAddress());
    await harness.waitForDeployment();
    return { harness, mockToken };
  }

  async function createMarket(harness: any, durationSeconds = ONE_HOUR): Promise<bigint> {
    const tx = await harness.connect(owner).createMarket("Will ETH close above $3000?", BigInt(durationSeconds));
    const r  = await tx.wait();
    const ev = r.logs
      .map((l: any) => { try { return harness.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "MarketCreated");
    return BigInt(ev.args.marketId);
  }

  async function closeEpoch(seconds = 120) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  // ── 1. createMarket metadata ──────────────────────────────────────────────
  it("createMarket sets token address and zero counters", async function () {
    const { harness } = await deployHarness();
    const marketId = await createMarket(harness);
    const m = await harness.getMarket(marketId);
    expect(m.token.toLowerCase()).to.not.equal("0x0000000000000000000000000000000000000000");
    expect(m.resolved).to.be.false;
    expect(m.betCount).to.equal(0n);
    expect(m.bettorCount).to.equal(0n);
  });

  // ── 2. placeBet happy path ────────────────────────────────────────────────
  it("placeBet stores position, emits BetPlaced(topUp=false), increments bettorCount", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness);

    await mockToken.depositFor(alice.address, TEN_USDC);
    const tx = await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    const r  = await tx.wait();

    const ev = r.logs
      .map((l: any) => { try { return harness.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "BetPlaced");
    expect(ev).to.not.be.null;
    expect(ev.args.bettor).to.equal(alice.address);
    expect(ev.args.topUp).to.be.false;

    const pos = await harness.getPosition(marketId, alice.address);
    expect(pos.exists).to.be.true;
    expect(pos.claimed).to.be.false;

    const m = await harness.getMarket(marketId);
    expect(m.betCount).to.equal(1n);
    expect(m.bettorCount).to.equal(1n);
  });

  // ── 3. TOP-UP (the V2 headline) — same address bets twice, stakes accumulate ──
  it("top-up: an address can bet again; betCount grows, bettorCount stays, payout reflects the sum", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);

    // alice deposits 20, bets 10 YES then tops up 10 YES → 20 YES total. bob bets 10 NO.
    await mockToken.depositFor(alice.address, TEN_USDC * 2n);
    await mockToken.depositFor(bob.address,   TEN_USDC);

    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    const topUpTx = await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    const topUpR  = await topUpTx.wait();
    const ev = topUpR.logs
      .map((l: any) => { try { return harness.interface.parseLog(l); } catch { return null; } })
      .find((e: any) => e?.name === "BetPlaced");
    expect(ev.args.topUp).to.be.true; // second bet flagged as a top-up

    await placeBetFor(bob, harness, marketId, SIDE_NO, TEN_USDC);

    const m0 = await harness.getMarket(marketId);
    expect(m0.betCount).to.equal(3n);    // 3 total bids
    expect(m0.bettorCount).to.equal(2n); // 2 unique addresses

    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    const m = await harness.getMarket(marketId);
    expect(m.revealedYesPool).to.equal(TEN_USDC * 2n); // alice's accumulated 20
    expect(m.revealedNoPool).to.equal(TEN_USDC);        // bob's 10

    // alice's winning stake is the full 20 → payout = 20 * 30 / 20 = 30 USDC
    const alicePayout = await doClaim(harness, mockToken, marketId, alice);
    expect(alicePayout).to.equal(TEN_USDC * 3n);
  });

  // ── 4. mixed-side hedge — one address on both sides, only winning stake pays ──
  it("mixed-side: a hedged bettor is paid only on the winning sub-pool", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);

    // alice: 10 YES + 5 NO (hedge). bob: 10 NO. Resolve YES.
    // pools: YES=10, NO=15, total=25, win=10. alice winStake=10 → 10*25/10 = 25 USDC.
    await mockToken.depositFor(alice.address, TEN_USDC + TEN_USDC / 2n);
    await mockToken.depositFor(bob.address,   TEN_USDC);

    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_NO,  TEN_USDC / 2n);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);

    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    const m = await harness.getMarket(marketId);
    expect(m.revealedYesPool).to.equal(TEN_USDC);
    expect(m.revealedNoPool).to.equal(TEN_USDC + TEN_USDC / 2n);

    const alicePayout = await doClaim(harness, mockToken, marketId, alice);
    expect(alicePayout).to.equal(25_000_000n); // 25 USDC, paid only on her YES stake
  });

  // ── 5. placeBet reverts on closed epoch ───────────────────────────────────
  it("placeBet reverts on closed epoch", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await closeEpoch();
    await mockToken.depositFor(alice.address, TEN_USDC);
    await expect(placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC)).to.be.revertedWith("Epoch closed");
  });

  // ── 6. placeBet reverts on resolved market ────────────────────────────────
  it("placeBet reverts on resolved market", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await expect(placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC)).to.be.revertedWith("Market resolved");
  });

  // ── 7. pool reveal stores raw USDC units ──────────────────────────────────
  it("pool reveal stores raw USDC units and correct clearing price", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);

    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    const m = await harness.getMarket(marketId);
    expect(m.revealedYesPool).to.equal(TEN_USDC);
    expect(m.revealedNoPool).to.equal(TEN_USDC);
    expect(Number(m.clearingPrice)).to.equal(5000); // 50% YES
  });

  // ── 8. claim — winner receives proportional payout ────────────────────────
  it("claim: winner receives proportional payout", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);

    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    const alicePayout = await doClaim(harness, mockToken, marketId, alice);
    expect(alicePayout).to.equal(TEN_USDC * 2n); // 10 * (20/10) = 20 USDC

    const pos = await harness.getPosition(marketId, alice.address);
    expect(pos.claimed).to.be.true;
  });

  // ── 9. claim — loser receives 0 without side reveal ───────────────────────
  it("claim: loser receives 0 payout without side being revealed", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);

    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    const bobPayout = await doClaim(harness, mockToken, marketId, bob);
    expect(bobPayout).to.equal(0n);
    expect((await harness.getPosition(marketId, bob.address)).claimed).to.be.true;
  });

  // ── 10. claim reverts if pool not revealed ────────────────────────────────
  it("claim reverts if pool not revealed", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await expect(harness.connect(alice).claim(marketId)).to.be.revertedWith("Pool not revealed");
  });

  // ── 11. claim reverts if no position ──────────────────────────────────────
  it("claim reverts if no position", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);
    await expect(harness.connect(bob).claim(marketId)).to.be.revertedWith("No position");
  });

  // ── 12. claim reverts on double-claim ─────────────────────────────────────
  it("claim reverts on double-claim", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    await harness.connect(alice).claim(marketId);
    await expect(harness.connect(alice).claim(marketId)).to.be.revertedWith("Already claimed");
  });

  // ── 13. Full happy path: 3 bettors ────────────────────────────────────────
  it("Full happy path: 3 bettors → resolve → pool reveal → correct payouts", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);

    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await mockToken.depositFor(carol.address, TEN_USDC);

    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);
    await placeBetFor(carol, harness, marketId, SIDE_YES, TEN_USDC);

    expect((await harness.getMarket(marketId)).bettorCount).to.equal(3n);

    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    const m = await harness.getMarket(marketId);
    expect(m.poolRevealed).to.be.true;
    expect(m.revealedYesPool).to.equal(TEN_USDC * 2n); // 20 USDC
    expect(m.revealedNoPool).to.equal(TEN_USDC);        // 10 USDC
    expect(Number(m.clearingPrice)).to.equal(6666);     // 20/30

    // alice & carol each: 10 * 30/20 = 15 USDC; bob: 0
    expect(await doClaim(harness, mockToken, marketId, alice)).to.equal(15_000_000n);
    expect(await doClaim(harness, mockToken, marketId, carol)).to.equal(15_000_000n);
    expect(await doClaim(harness, mockToken, marketId, bob)).to.equal(0n);

    expect((await harness.getPosition(marketId, alice.address)).claimed).to.be.true;
    expect((await harness.getPosition(marketId, carol.address)).claimed).to.be.true;
    expect((await harness.getPosition(marketId, bob.address)).claimed).to.be.true;
  });
});
