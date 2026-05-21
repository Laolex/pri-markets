import { ethers, fhevm } from "hardhat";
import { expect } from "chai";

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const SIDE_NO = 0;
const SIDE_YES = 1;
const UNRESOLVED = 255;
const MIN_BET = ethers.parseEther("0.001");
const ONE_HOUR = 3600;

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Call fhevm.publicDecrypt on a set of handles and return the result ready
 * for a Pattern 3 contract callback. The hardhat mock KMSVerifier validates
 * decryptionProof — passing "0x" triggers EmptyDecryptionProof(). Using
 * fhevm.publicDecrypt generates a properly signed mock proof.
 */
async function mockPublicDecrypt(
  handles: string[],
): Promise<{ abiEncodedClearValues: string; decryptionProof: string }> {
  const result = await fhevm.publicDecrypt(handles);
  return {
    abiEncodedClearValues: result.abiEncodedClearValues,
    decryptionProof: result.decryptionProof,
  };
}

/** Place an encrypted bet on behalf of a signer. */
async function placeBetFor(
  signer: any,
  contract: any,
  marketId: bigint,
  side: number,
  amount: string,
) {
  const enc = await fhevm
    .createEncryptedInput(await contract.getAddress(), signer.address)
    .add8(BigInt(side))
    .encrypt();
  return contract
    .connect(signer)
    .placeBet(marketId, enc.handles[0], enc.inputProof, {
      value: ethers.parseEther(amount),
    });
}

/** Request and submit the pool reveal (Pattern 3). */
async function doPoolReveal(contract: any, marketId: bigint) {
  await contract.requestPoolReveal(marketId);
  const [yesHandle, noHandle] = await contract.getEncPools(marketId);
  const proof = await mockPublicDecrypt([yesHandle, noHandle]);
  return contract.onPoolRevealed(
    marketId,
    [yesHandle, noHandle],
    proof.abiEncodedClearValues,
    proof.decryptionProof,
  );
}

/** Request and submit a payout reveal (Pattern 3). Returns the payout in wei. */
async function doPayoutReveal(
  contract: any,
  marketId: bigint,
  bettor: any,
): Promise<bigint> {
  await contract.connect(bettor).requestPayout(marketId);
  const encPayoutHandle = await contract.getEncPayout(marketId, bettor.address);
  const proof = await mockPublicDecrypt([encPayoutHandle]);
  const tx = await contract.onPayoutRevealed(
    marketId,
    bettor.address,
    [encPayoutHandle],
    proof.abiEncodedClearValues,
    proof.decryptionProof,
  );
  const receipt = await tx.wait();
  const ev = receipt.logs
    .map((l: any) => {
      try {
        return contract.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e: any) => e && e.name === "PayoutClaimed");
  return ev ? BigInt(ev.args.payout) : 0n;
}

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("ConfidentialBatchAuction", function () {
  let contract: any;
  let owner: any, alice: any, bob: any, carol: any;

  before(async function () {
    await fhevm.initializeCLIApi();
  });

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ConfidentialBatchAuction");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  // ── Scoped helpers ───────────────────────────────────────────────────────

  async function createMarket(durationSeconds = ONE_HOUR): Promise<bigint> {
    const tx = await contract
      .connect(owner)
      .createMarket("Will BTC close above $100k on Dec 31?", BigInt(durationSeconds));
    await tx.wait();
    return 0n;
  }

  async function timeTravel(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  // ── 1. createMarket ──────────────────────────────────────────────────────

  it("createMarket creates with correct epoch metadata", async function () {
    const marketId = await createMarket();
    const m = await contract.getMarket(marketId);

    expect(m.creator).to.equal(owner.address);
    expect(m.question).to.equal("Will BTC close above $100k on Dec 31?");
    expect(m.resolved).to.be.false;
    expect(Number(m.outcome)).to.equal(UNRESOLVED);
    expect(m.totalEth).to.equal(0n);
    expect(m.clearingPrice).to.equal(0n);
    expect(m.poolRevealRequested).to.be.false;
    expect(m.poolRevealed).to.be.false;

    const block = await ethers.provider.getBlock("latest");
    expect(Number(m.epochStart)).to.be.closeTo(block!.timestamp, 5);
    expect(Number(m.epochEnd)).to.be.closeTo(block!.timestamp + ONE_HOUR, 5);
  });

  // ── 2. placeBet — happy path ─────────────────────────────────────────────

  it("placeBet stores position, emits BetPlaced, updates totalEth", async function () {
    const marketId = await createMarket();
    const betAmount = "0.01";

    const tx = await placeBetFor(alice, contract, marketId, SIDE_YES, betAmount);
    const receipt = await tx.wait();

    const ev = receipt.logs
      .map((l: any) => {
        try {
          return contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "BetPlaced");
    expect(ev).to.not.be.null;
    expect(ev.args.bettor).to.equal(alice.address);
    expect(ev.args.amount).to.equal(ethers.parseEther(betAmount));

    const pos = await contract.getPosition(marketId, alice.address);
    expect(pos.amount).to.equal(ethers.parseEther(betAmount));
    expect(pos.payoutRequested).to.be.false;
    expect(pos.claimed).to.be.false;

    const m = await contract.getMarket(marketId);
    expect(m.totalEth).to.equal(ethers.parseEther(betAmount));
  });

  // ── 3. placeBet — double-bet reverts ─────────────────────────────────────

  it("placeBet reverts on double-bet (same address)", async function () {
    const marketId = await createMarket();
    await placeBetFor(alice, contract, marketId, SIDE_YES, "0.01");
    await expect(
      placeBetFor(alice, contract, marketId, SIDE_NO, "0.01"),
    ).to.be.revertedWith("Already bet");
  });

  // ── 4. placeBet — epoch closed ───────────────────────────────────────────

  it("placeBet reverts on closed epoch", async function () {
    const marketId = await createMarket(60);
    await timeTravel(120);
    await expect(
      placeBetFor(alice, contract, marketId, SIDE_YES, "0.01"),
    ).to.be.revertedWith("Epoch closed");
  });

  // ── 5. placeBet — resolved market ────────────────────────────────────────

  it("placeBet reverts on resolved market", async function () {
    const marketId = await createMarket(60);
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await expect(
      placeBetFor(alice, contract, marketId, SIDE_YES, "0.01"),
    ).to.be.revertedWith("Market resolved");
  });

  // ── 6. placeBet — below minimum ──────────────────────────────────────────

  it("placeBet reverts below MIN_BET", async function () {
    const marketId = await createMarket();
    const enc = await fhevm
      .createEncryptedInput(await contract.getAddress(), alice.address)
      .add8(BigInt(SIDE_YES))
      .encrypt();
    await expect(
      contract.connect(alice).placeBet(marketId, enc.handles[0], enc.inputProof, {
        value: ethers.parseEther("0.0005"),
      }),
    ).to.be.revertedWith("Below minimum bet");
  });

  // ── 7. resolveMarket — not creator ──────────────────────────────────────

  it("resolveMarket reverts if not creator", async function () {
    const marketId = await createMarket(60);
    await timeTravel(120);
    await expect(
      contract.connect(alice).resolveMarket(marketId, SIDE_YES),
    ).to.be.revertedWith("Not creator");
  });

  // ── 8. resolveMarket — epoch not closed ──────────────────────────────────

  it("resolveMarket reverts if epoch not closed", async function () {
    const marketId = await createMarket();
    await expect(
      contract.connect(owner).resolveMarket(marketId, SIDE_YES),
    ).to.be.revertedWith("Epoch not closed");
  });

  // ── 9. resolveMarket — sets flags ────────────────────────────────────────

  it("resolveMarket sets outcome and resolved flag", async function () {
    const marketId = await createMarket(60);
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);

    const m = await contract.getMarket(marketId);
    expect(m.resolved).to.be.true;
    expect(Number(m.outcome)).to.equal(SIDE_YES);
  });

  // ── 10. requestPoolReveal — not resolved ─────────────────────────────────

  it("requestPoolReveal reverts if not resolved", async function () {
    const marketId = await createMarket();
    await expect(contract.requestPoolReveal(marketId)).to.be.revertedWith(
      "Not resolved",
    );
  });

  // ── 11. requestPoolReveal — emits handles ────────────────────────────────

  it("requestPoolReveal emits PoolRevealRequested with 2 handles", async function () {
    const marketId = await createMarket(60);
    await placeBetFor(alice, contract, marketId, SIDE_YES, "0.01");
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);

    const tx = await contract.requestPoolReveal(marketId);
    const receipt = await tx.wait();

    const ev = receipt.logs
      .map((l: any) => {
        try {
          return contract.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((e: any) => e && e.name === "PoolRevealRequested");
    expect(ev).to.not.be.null;
    expect(ev.args.handles).to.have.lengthOf(2);
    expect(ev.args.handles[0]).to.match(/^0x[0-9a-f]{64}$/i);
    expect(ev.args.handles[1]).to.match(/^0x[0-9a-f]{64}$/i);
  });

  // ── 12. requestPoolReveal — double request reverts ───────────────────────

  it("requestPoolReveal reverts if called twice", async function () {
    const marketId = await createMarket(60);
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await contract.requestPoolReveal(marketId);
    await expect(contract.requestPoolReveal(marketId)).to.be.revertedWith(
      "Already requested",
    );
  });

  // ── 13. requestPayout — pool not revealed ────────────────────────────────

  it("requestPayout reverts if pool not revealed", async function () {
    const marketId = await createMarket(60);
    await placeBetFor(alice, contract, marketId, SIDE_YES, "0.01");
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await expect(
      contract.connect(alice).requestPayout(marketId),
    ).to.be.revertedWith("Pool not revealed");
  });

  // ── 14. requestPayout — no position ──────────────────────────────────────

  it("requestPayout reverts if no position", async function () {
    const marketId = await createMarket(60);
    // pool reveal requires at least one bet so the mock coprocessor
    // returns a valid 64-byte cleartext; alice never bets
    await placeBetFor(owner, contract, marketId, SIDE_YES, "0.01");
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(contract, marketId);
    await expect(
      contract.connect(alice).requestPayout(marketId),
    ).to.be.revertedWith("No position");
  });

  // ── 15. clearingPrice is correct after pool reveal ────────────────────────

  it("clearingPrice is correct in basis points after pool reveal", async function () {
    // alice: 1 ETH YES, bob: 1 ETH NO, carol: 1 ETH YES
    // yesPool = 2 ETH, noPool = 1 ETH → clearingPrice = 2/3 * 10000 = 6666
    const marketId = await createMarket(60);
    await placeBetFor(alice, contract, marketId, SIDE_YES, "1");
    await placeBetFor(bob, contract, marketId, SIDE_NO, "1");
    await placeBetFor(carol, contract, marketId, SIDE_YES, "1");
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(contract, marketId);

    const m = await contract.getMarket(marketId);
    expect(m.revealedYesPool).to.equal(ethers.parseEther("2"));
    expect(m.revealedNoPool).to.equal(ethers.parseEther("1"));
    expect(Number(m.clearingPrice)).to.equal(6666); // floor(2/3 * 10000)
  });

  // ── 16. Full happy path ───────────────────────────────────────────────────

  it("Full happy path: create → 3 bets → resolve → pool reveal → payout reveal → ETH transfers", async function () {
    // alice: 1 ETH YES, bob: 1 ETH NO, carol: 1 ETH YES
    // outcome YES → alice and carol win, bob gets 0
    // totalEth = 3 ETH, winPool = 2 ETH
    // alice payout = (1 * 3) / 2 = 1.5 ETH → 1500000000 gwei → 1.5e18 wei
    // carol payout = (1 * 3) / 2 = 1.5 ETH (same)
    // bob   payout = 0

    const marketId = await createMarket(60);
    await placeBetFor(alice, contract, marketId, SIDE_YES, "1");
    await placeBetFor(bob, contract, marketId, SIDE_NO, "1");
    await placeBetFor(carol, contract, marketId, SIDE_YES, "1");

    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(contract, marketId);

    const m = await contract.getMarket(marketId);
    expect(m.poolRevealed).to.be.true;
    expect(m.revealedYesPool).to.equal(ethers.parseEther("2"));
    expect(m.revealedNoPool).to.equal(ethers.parseEther("1"));

    // alice claims — should receive 1.5 ETH
    const aliceBefore = await ethers.provider.getBalance(alice.address);
    const alicePayout = await doPayoutReveal(contract, marketId, alice);
    const aliceAfter = await ethers.provider.getBalance(alice.address);
    expect(alicePayout).to.equal(ethers.parseEther("1.5"));
    // net gain ≈ 1.5 ETH minus gas costs; check at least 1.4 ETH gained
    expect(aliceAfter - aliceBefore).to.be.gt(ethers.parseEther("1.4"));

    // carol claims — same payout
    const carolPayout = await doPayoutReveal(contract, marketId, carol);
    expect(carolPayout).to.equal(ethers.parseEther("1.5"));

    // verify positions are marked claimed
    const alicePos = await contract.getPosition(marketId, alice.address);
    const carolPos = await contract.getPosition(marketId, carol.address);
    expect(alicePos.claimed).to.be.true;
    expect(carolPos.claimed).to.be.true;
  });

  // ── 17. Loser receives 0 payout without side being revealed ──────────────

  it("Loser receives 0 payout — no side reveal, no revert", async function () {
    // bob bets NO, outcome is YES → bob's encrypted payout = FHE.select(false, X, 0) = 0
    // Side is never revealed — only the 0-wei payout is decrypted
    const marketId = await createMarket(60);
    await placeBetFor(alice, contract, marketId, SIDE_YES, "1");
    await placeBetFor(bob, contract, marketId, SIDE_NO, "1");

    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(contract, marketId);

    const bobBefore = await ethers.provider.getBalance(bob.address);
    const bobPayout = await doPayoutReveal(contract, marketId, bob);
    expect(bobPayout).to.equal(0n);

    // bob's position is still marked claimed (idempotent)
    const bobPos = await contract.getPosition(marketId, bob.address);
    expect(bobPos.claimed).to.be.true;

    // bob's ETH balance decreased (gas only — no payout)
    const bobAfter = await ethers.provider.getBalance(bob.address);
    expect(bobAfter).to.be.lt(bobBefore);
  });

  // ── 18. Claimed positions cannot be re-claimed ────────────────────────────

  it("onPayoutRevealed reverts on double-claim", async function () {
    const marketId = await createMarket(60);
    await placeBetFor(alice, contract, marketId, SIDE_YES, "1");
    await timeTravel(120);
    await contract.connect(owner).resolveMarket(marketId, SIDE_YES);
    await doPoolReveal(contract, marketId);

    await contract.connect(alice).requestPayout(marketId);
    const encPayout = await contract.getEncPayout(marketId, alice.address);
    const proof = await mockPublicDecrypt([encPayout]);

    // First claim succeeds
    await contract.onPayoutRevealed(
      marketId,
      alice.address,
      [encPayout],
      proof.abiEncodedClearValues,
      proof.decryptionProof,
    );

    // Second claim reverts
    await expect(
      contract.onPayoutRevealed(
        marketId,
        alice.address,
        [encPayout],
        proof.abiEncodedClearValues,
        proof.decryptionProof,
      ),
    ).to.be.revertedWith("Already claimed");
  });
});
