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
    encSide:    ethers.hexlify(enc.handles[0]) as `0x${string}`,
    encAmount:  ethers.hexlify(enc.handles[1]) as `0x${string}`,
    inputProof: ethers.hexlify(enc.inputProof) as `0x${string}`,
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
  // feeBps defaults to 0 so existing payout assertions are exact; fee tests pass 200.
  async function deployHarness(feeBps = 0): Promise<{ harness: any; mockToken: any }> {
    const MockFactory = await ethers.getContractFactory("MockConfidentialUSDC");
    const mockToken   = await MockFactory.deploy();
    await mockToken.waitForDeployment();

    const HarnessFactory = await ethers.getContractFactory("CBATokenTestHarness");
    const harness: any   = await HarnessFactory.deploy(await mockToken.getAddress());
    await harness.waitForDeployment();
    if (feeBps !== 200) await harness.connect(owner).setProtocolFee(feeBps); // constructor default is 200
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

  // ── 14. claim — large pools route through the Q13 ratio path ──────────────
  it("claim: large pools (winPool·distributable > 2^64) still pay out correctly", async function () {
    const { harness, mockToken } = await deployHarness();
    const marketId = await createMarket(harness, 60);

    // 5,000 USDC per side → winPool·distributable = 5e9·1e10 raw² > 2^64, which
    // wrapped the old single-mul payout. The Q13 ratio fallback keeps it exact here.
    const USDC = 1_000_000n;
    await mockToken.depositFor(alice.address, 3_000n * USDC);
    await mockToken.depositFor(carol.address, 2_000n * USDC);
    await mockToken.depositFor(bob.address,   5_000n * USDC);

    await placeBetFor(alice, harness, marketId, SIDE_YES, 3_000n * USDC);
    await placeBetFor(carol, harness, marketId, SIDE_YES, 2_000n * USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  5_000n * USDC);

    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    // YES wins: alice 3000·(10000/5000) = 6000, carol 2000·2 = 4000, bob 0
    expect(await doClaim(harness, mockToken, marketId, alice)).to.equal(6_000n * USDC);
    expect(await doClaim(harness, mockToken, marketId, carol)).to.equal(4_000n * USDC);
    expect(await doClaim(harness, mockToken, marketId, bob)).to.equal(0n);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Protocol fee + treasury sweep + payout visibility
  // ──────────────────────────────────────────────────────────────────────────

  async function decryptHandle(handle: string): Promise<bigint> {
    if (handle === ethers.ZeroHash) return 0n;
    const res = await mockPublicDecrypt([handle]);
    const [v] = ethers.AbiCoder.defaultAbiCoder().decode(["uint64"], res.abiEncodedClearValues);
    return v as bigint;
  }

  it("fee: winner payout is reduced by the protocol fee; getFeeInfo is correct", async function () {
    const { harness, mockToken } = await deployHarness(200); // 2%
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);

    const fi = await harness.getFeeInfo(marketId);
    expect(fi.feeBps).to.equal(200);
    expect(fi.feeAmount).to.equal(400_000n);        // 2% of 20 USDC
    expect(fi.distributable).to.equal(19_600_000n); // 19.6 USDC
    expect(fi.feesSwept).to.be.false;

    // alice wins the whole YES pool: 10 * 19.6 / 10 = 19.6 USDC (was 20 before fee)
    expect(await doClaim(harness, mockToken, marketId, alice)).to.equal(19_600_000n);
  });

  it("sweepFees: treasury receives exactly the protocol fee after settlement; idempotent", async function () {
    const { harness, mockToken } = await deployHarness(200);
    await harness.connect(owner).setTreasury(carol.address); // isolate the treasury balance
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);
    await doClaim(harness, mockToken, marketId, alice); // winner takes 19.6, leaving the 0.4 fee

    await expect(harness.connect(bob).sweepFees(marketId))
      .to.emit(harness, "FeesSwept").withArgs(marketId, carol.address, 400_000n, false);
    expect(await decryptHandle(await mockToken.lastReceivedHandle(carol.address))).to.equal(400_000n);

    expect((await harness.getFeeInfo(marketId)).feesSwept).to.be.true;
    await expect(harness.sweepFees(marketId)).to.be.revertedWith("Already swept");
  });

  it("sweepFees: no winners → the entire stranded pot goes to treasury", async function () {
    const { harness, mockToken } = await deployHarness(200);
    await harness.connect(owner).setTreasury(carol.address);
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_YES, TEN_USDC); // both YES
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_NO);  // NO wins → noPool = 0, no winners
    await doPoolReveal(harness, marketId);

    expect(await doClaim(harness, mockToken, marketId, alice)).to.equal(0n); // loser claims 0

    await expect(harness.connect(alice).sweepFees(marketId))
      .to.emit(harness, "FeesSwept").withArgs(marketId, carol.address, 20_000_000n, true);
    expect(await decryptHandle(await mockToken.lastReceivedHandle(carol.address))).to.equal(20_000_000n);
  });

  it("payout visibility: claimer can decrypt their own payout via getEncPayout", async function () {
    const { harness, mockToken } = await deployHarness(200);
    const marketId = await createMarket(harness, 60);
    await mockToken.depositFor(alice.address, TEN_USDC);
    await mockToken.depositFor(bob.address,   TEN_USDC);
    await placeBetFor(alice, harness, marketId, SIDE_YES, TEN_USDC);
    await placeBetFor(bob,   harness, marketId, SIDE_NO,  TEN_USDC);
    await closeEpoch();
    await harness.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(harness, marketId);
    await harness.connect(alice).claim(marketId);

    // getEncPayout returns the same handle that was paid out — the UI decrypts it as "you won X"
    const payoutHandle = await harness.getEncPayout(marketId, alice.address);
    expect(payoutHandle).to.equal(await mockToken.lastReceivedHandle(alice.address));
    expect(await decryptHandle(payoutHandle)).to.equal(19_600_000n); // 19.6 USDC after 2% fee
  });

  it("admin: setProtocolFee/setTreasury are owner-gated and bounded", async function () {
    const { harness } = await deployHarness(200);
    await expect(harness.connect(alice).setProtocolFee(100))
      .to.be.revertedWithCustomError(harness, "OwnableUnauthorizedAccount");
    await expect(harness.connect(owner).setProtocolFee(1001)).to.be.revertedWith("Fee too high");
    await harness.connect(owner).setProtocolFee(100);
    expect(await harness.protocolFeeBps()).to.equal(100);

    await expect(harness.connect(alice).setTreasury(alice.address))
      .to.be.revertedWithCustomError(harness, "OwnableUnauthorizedAccount");
    await expect(harness.connect(owner).setTreasury(ethers.ZeroAddress)).to.be.revertedWith("Zero treasury");
    await harness.connect(owner).setTreasury(carol.address);
    expect(await harness.treasury()).to.equal(carol.address);
  });

  it("sweepFees reverts before reveal", async function () {
    const { harness } = await deployHarness(200);
    const marketId = await createMarket(harness, 60);
    await expect(harness.sweepFees(marketId)).to.be.revertedWith("Pool not revealed");
  });
});
