// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, euint64, ebool, externalEuint8, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/// @dev Minimal interface for ERC-7984 confidential token (cUSDC on Sepolia).
///      CBA decodes encAmount via FHE.fromExternal in its own context (one inputProof tied to the
///      CBA address) and passes the verified euint64 handle to the token — no second proof needed.
interface IConfidentialUSDC {
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64);
    function confidentialTransfer(address to, euint64 encryptedAmount) external;
}

/// @title ConfidentialBatchAuction V2 — sealed-bid directional discovery (token-only)
/// @notice Continuous prediction markets leak directional flow; this seals direction (and amount)
///         during the epoch and reveals only one aggregate clearing price at close.
///
/// @dev    V2 changes vs V1:
///           • Token-only (cUSDC / ERC-7984). The plaintext-ETH path is removed — amount and side
///             are both encrypted end-to-end, so nothing leaks even after settlement.
///           • Top-ups: an address may bet multiple times. Each position keeps two encrypted
///             sub-pools (yesStake / noStake) that accumulate across bets, so mixed-side and
///             repeated betting are first-class. The one-bet-per-address cap is gone.
///           • Settlement reads the winning sub-pool directly — no FHE.eq/FHE.select on the side
///             (a losing-only bettor's winning stake is already 0), which also lowers claim HCU.
contract ConfidentialBatchAuction is ZamaEthereumConfig, ReentrancyGuard, Ownable {
    // ── Constants ──────────────────────────────────────────────────────────
    uint8   public constant SIDE_NO    = 0;
    uint8   public constant SIDE_YES   = 1;
    uint8   public constant UNRESOLVED = 255;

    // Official Zama cUSDC (Mock) on Sepolia — ERC7984ERC20Wrapper wrapping USDC.
    address public constant CUSDC_TOKEN = 0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639;

    // ── Protocol economics ───────────────────────────────────────────────────
    uint16  public constant MAX_FEE_BPS = 1000;   // hard cap: 10%
    uint16  public protocolFeeBps;                // fee on each market's pool, in basis points
    address public treasury;                      // receives protocol fees + no-winner pots

    /// @dev Token address for markets. Virtual so the test harness can inject a mock.
    function _tokenAddress() internal view virtual returns (address) {
        return CUSDC_TOKEN;
    }

    /// @param treasury_ fee recipient; falls back to the deployer if zero.
    constructor(address treasury_) Ownable(msg.sender) {
        treasury       = treasury_ == address(0) ? msg.sender : treasury_;
        protocolFeeBps = 200; // 2% default — owner-adjustable up to MAX_FEE_BPS
    }

    // ── Admin (owner) ──────────────────────────────────────────────────────────
    function setProtocolFee(uint16 bps) external onlyOwner {
        require(bps <= MAX_FEE_BPS, "Fee too high");
        protocolFeeBps = bps;
        emit ProtocolFeeUpdated(bps);
    }

    function setTreasury(address t) external onlyOwner {
        require(t != address(0), "Zero treasury");
        treasury = t;
        emit TreasuryUpdated(t);
    }

    // ── Data structures ────────────────────────────────────────────────────
    struct Market {
        address creator;
        string  question;
        uint64  epochStart;
        uint64  epochEnd;
        bool    resolved;
        uint8   outcome;              // SIDE_YES, SIDE_NO, or UNRESOLVED
        euint64 yesPool;              // encrypted accumulator (raw token units)
        euint64 noPool;
        uint256 revealedYesPool;      // plaintext, set after Pattern-3 reveal
        uint256 revealedNoPool;
        uint256 clearingPrice;        // basis points 0–10000
        bool    poolRevealRequested;
        bool    poolRevealed;
        // Oracle resolution (optional)
        address priceFeed;
        int256  strikePrice;
        bool    useOracle;
        address token;                // ERC-7984 token address
        uint256 betCount;             // total bids placed (counts top-ups)
        uint256 bettorCount;          // unique addresses
        // Fee accounting (plaintext, set at reveal)
        uint256 feeAmount;            // protocol fee skimmed from the pool
        uint256 distributable;        // totalPool − feeAmount; what winners split
        bool    feesSwept;            // treasury sweep done
    }

    /// @dev Per-position encrypted sub-pools. The side is never stored in plaintext; bets are routed
    ///      by the encrypted side into yesStake/noStake at submission. Settlement uses only the
    ///      winning sub-pool, so the side is never compared in plaintext.
    struct Position {
        bool    exists;
        euint64 yesStake;
        euint64 noStake;
        bool    claimed;
        euint64 payout;     // encrypted payout, set at claim; claimer-decryptable
    }

    // ── State ──────────────────────────────────────────────────────────────
    Market[] private markets;
    mapping(uint256 => mapping(address => Position)) private positions;

    // ── Events ─────────────────────────────────────────────────────────────
    event MarketCreated(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address token);
    event MarketCreatedWithOracle(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address token, address priceFeed, int256 strikePrice);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, bool topUp);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event MarketResolvedByOracle(uint256 indexed marketId, uint8 outcome, int256 price, int256 strikePrice);
    event PoolRevealRequested(uint256 indexed marketId, bytes32[2] handles);
    event PoolRevealed(uint256 indexed marketId, uint256 yesPool, uint256 noPool, uint256 clearingPrice);
    event PayoutClaimed(uint256 indexed marketId, address indexed bettor);
    event FeesSwept(uint256 indexed marketId, address indexed treasury, uint256 amount, bool noWinners);
    event ProtocolFeeUpdated(uint16 bps);
    event TreasuryUpdated(address treasury);

    // ── Market lifecycle ─────────────────────────────────────────────────────
    function createMarket(
        string calldata question,
        uint64 epochDuration
    ) external returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(epochDuration >= 60, "Epoch too short");
        marketId = _initMarket(question, epochDuration);
        Market storage m = markets[marketId];
        emit MarketCreated(marketId, msg.sender, question, m.epochStart, m.epochEnd, m.token);
    }

    function createMarketWithOracle(
        string calldata question,
        uint64 epochDuration,
        address priceFeed,
        int256 strikePrice
    ) external returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(epochDuration >= 60, "Epoch too short");
        require(priceFeed != address(0), "Invalid feed address");
        require(strikePrice > 0, "Strike price must be positive");
        marketId = _initMarket(question, epochDuration);
        Market storage m = markets[marketId];
        m.priceFeed   = priceFeed;
        m.strikePrice = strikePrice;
        m.useOracle   = true;
        emit MarketCreatedWithOracle(marketId, msg.sender, question, m.epochStart, m.epochEnd, m.token, priceFeed, strikePrice);
    }

    function _initMarket(
        string calldata question,
        uint64 epochDuration
    ) internal returns (uint256 marketId) {
        marketId = markets.length;
        markets.push();
        Market storage m = markets[marketId];
        m.creator     = msg.sender;
        m.question    = question;
        m.epochStart  = uint64(block.timestamp);
        m.epochEnd    = uint64(block.timestamp) + epochDuration;
        m.outcome     = UNRESOLVED;
        m.token       = _tokenAddress();

        euint64 zeroYes = FHE.asEuint64(0);
        FHE.allowThis(zeroYes);
        m.yesPool = zeroYes;

        euint64 zeroNo = FHE.asEuint64(0);
        FHE.allowThis(zeroNo);
        m.noPool = zeroNo;
    }

    // ── Bid submission (cUSDC / ERC-7984) ────────────────────────────────────
    /// @notice Place a sealed bid using cUSDC. Both direction AND amount are encrypted. Callable
    ///         multiple times per address — each call tops up the caller's encrypted sub-pools.
    ///         A single inputProof covers both encSide (uint8) and encAmount (uint64):
    ///         createEncryptedInput(contract, user).add8(side).add64(amount).encrypt()
    function placeBet(
        uint256 marketId,
        bytes32 encSide,
        bytes32 encAmount,
        bytes calldata inputProof
    ) external nonReentrant {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(!m.resolved, "Market resolved");
        require(block.timestamp < m.epochEnd, "Epoch closed");

        // Decode both handles in CBA context — one inputProof covers both.
        euint8  side = FHE.fromExternal(externalEuint8.wrap(encSide),   inputProof);
        euint64 amt  = FHE.fromExternal(externalEuint64.wrap(encAmount), inputProof);
        FHE.allowThis(side);
        FHE.allowThis(amt);

        // Pull the encrypted amount in. No second proof — handle already verified above.
        FHE.allowTransient(amt, m.token);
        euint64 received = IConfidentialUSDC(m.token).confidentialTransferFrom(msg.sender, address(this), amt);
        FHE.allowThis(received);

        // Route by encrypted side into YES / NO contributions.
        ebool   isYes      = FHE.eq(side, FHE.asEuint8(SIDE_YES));
        euint64 zeroAmt    = FHE.asEuint64(0);
        euint64 yesContrib = FHE.select(isYes, received, zeroAmt);
        euint64 noContrib  = FHE.select(FHE.not(isYes), received, zeroAmt);

        // Market pools.
        euint64 newYesPool = FHE.add(m.yesPool, yesContrib);
        FHE.allowThis(newYesPool);
        m.yesPool = newYesPool;
        euint64 newNoPool = FHE.add(m.noPool, noContrib);
        FHE.allowThis(newNoPool);
        m.noPool = newNoPool;

        // Per-position sub-pools (accumulate across top-ups).
        Position storage pos = positions[marketId][msg.sender];
        bool topUp = pos.exists;
        if (!pos.exists) {
            euint64 z1 = FHE.asEuint64(0); FHE.allowThis(z1); pos.yesStake = z1;
            euint64 z2 = FHE.asEuint64(0); FHE.allowThis(z2); pos.noStake  = z2;
            pos.exists = true;
            m.bettorCount++;
        }
        euint64 newYesStake = FHE.add(pos.yesStake, yesContrib);
        FHE.allowThis(newYesStake);
        FHE.allow(newYesStake, msg.sender);
        pos.yesStake = newYesStake;
        euint64 newNoStake = FHE.add(pos.noStake, noContrib);
        FHE.allowThis(newNoStake);
        FHE.allow(newNoStake, msg.sender);
        pos.noStake = newNoStake;

        m.betCount++;
        emit BetPlaced(marketId, msg.sender, topUp);
    }

    // ── Resolution ────────────────────────────────────────────────────────────
    function resolveMarket(uint256 marketId, uint8 outcome) external {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(msg.sender == m.creator, "Not creator");
        require(!m.useOracle, "Oracle market: use resolveByOracle");
        require(block.timestamp >= m.epochEnd, "Epoch not closed");
        require(!m.resolved, "Already resolved");
        require(outcome == SIDE_YES || outcome == SIDE_NO, "Invalid outcome");
        m.resolved = true;
        m.outcome  = outcome;
        emit MarketResolved(marketId, outcome);
    }

    function resolveByOracle(uint256 marketId) external {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.useOracle, "Not an oracle market");
        require(block.timestamp >= m.epochEnd, "Epoch not closed");
        require(!m.resolved, "Already resolved");

        (, int256 price,, uint256 updatedAt,) = AggregatorV3Interface(m.priceFeed).latestRoundData();
        require(block.timestamp - updatedAt <= 3600, "Stale oracle");
        uint8 outcome = price >= m.strikePrice ? SIDE_YES : SIDE_NO;
        m.resolved = true;
        m.outcome  = outcome;
        emit MarketResolved(marketId, outcome);
        emit MarketResolvedByOracle(marketId, outcome, price, m.strikePrice);
    }

    // ── Pool reveal — Pattern 3 ───────────────────────────────────────────────
    function requestPoolReveal(uint256 marketId) external {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.resolved, "Not resolved");
        require(!m.poolRevealRequested, "Already requested");

        FHE.makePubliclyDecryptable(m.yesPool);
        FHE.makePubliclyDecryptable(m.noPool);
        m.poolRevealRequested = true;

        bytes32[2] memory handles;
        handles[0] = FHE.toBytes32(m.yesPool);
        handles[1] = FHE.toBytes32(m.noPool);
        emit PoolRevealRequested(marketId, handles);
    }

    function onPoolRevealed(
        uint256 marketId,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.poolRevealRequested, "No pending reveal");
        require(!m.poolRevealed, "Already revealed");
        require(handlesList.length == 2, "Need 2 handles");
        require(cleartexts.length == 64, "Bad cleartext length");

        require(handlesList[0] == FHE.toBytes32(m.yesPool), "yesPool handle mismatch");
        require(handlesList[1] == FHE.toBytes32(m.noPool),  "noPool handle mismatch");

        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        uint256 yesRaw;
        uint256 noRaw;
        assembly {
            yesRaw := calldataload(add(cleartexts.offset, 0))
            noRaw  := calldataload(add(cleartexts.offset, 32))
        }

        // Token pools are raw token units (6 decimals for USDC) — store as-is.
        m.revealedYesPool = yesRaw;
        m.revealedNoPool  = noRaw;

        uint256 totalPool = m.revealedYesPool + m.revealedNoPool;
        m.clearingPrice   = totalPool > 0 ? (m.revealedYesPool * 10000) / totalPool : 0;

        // Skim the protocol fee now that pools are plaintext. Winners split `distributable`;
        // the fee (and, when there are no winners, the whole pot) is later swept to the treasury.
        m.feeAmount     = (totalPool * protocolFeeBps) / 10000;
        m.distributable = totalPool - m.feeAmount;

        m.poolRevealed    = true;

        emit PoolRevealed(marketId, m.revealedYesPool, m.revealedNoPool, m.clearingPrice);
    }

    // ── Settlement (single-step, no KMS callback) ─────────────────────────────
    /// @notice Claim cUSDC payout in one tx. Payout is computed entirely in the coprocessor:
    ///           payout = winningStake * distributable / winPool
    ///         where `distributable` is the pool after the protocol fee. Never reveals side or
    ///         amount. A bettor with no winning stake claims 0 (the encrypted stake is already 0).
    ///         The encrypted payout is stored and made decryptable by the claimer, so the UI can
    ///         show them exactly how much they won — without anyone else seeing it.
    function claim(uint256 marketId) external nonReentrant {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.poolRevealed, "Pool not revealed");

        Position storage pos = positions[marketId][msg.sender];
        require(pos.exists, "No position");
        require(!pos.claimed, "Already claimed");

        uint256 winPool = m.outcome == SIDE_YES ? m.revealedYesPool : m.revealedNoPool;
        require(winPool <= type(uint64).max, "Pool overflow");

        // The caller's stake on the winning side (encrypted). Losing-only bettors have 0 here.
        euint64 winStake = m.outcome == SIDE_YES ? pos.yesStake : pos.noStake;

        // Winners split the after-fee pool: payout = winStake · distributable / winPool.
        // euint64 multiplication wraps silently mod 2^64, so the exact product is only safe
        // while winPool · distributable fits in 64 bits (winStake ≤ winPool bounds the product).
        // Larger pools route through a Q13 fixed-point ratio instead: winStake · ratioQ13 ≤
        // distributable · 2^13, which the guard keeps under 2^64. Precision cost of that path
        // is < winStake / 8192 (≤ 0.013% of the stake). winPool == 0 (no winners) → payout 0;
        // the whole pot is swept to the treasury via sweepFees instead.
        euint64 encPayout;
        if (winPool == 0) {
            encPayout = FHE.asEuint64(0);
        } else if (m.distributable <= type(uint64).max / winPool) {
            encPayout = FHE.div(FHE.mul(winStake, uint64(m.distributable)), uint64(winPool));
        } else {
            require(m.distributable <= type(uint64).max >> 13, "Pool overflow");
            uint256 ratioQ13 = (m.distributable << 13) / winPool;
            encPayout = FHE.shr(FHE.mul(winStake, uint64(ratioQ13)), 13);
        }

        pos.claimed = true;

        // Persist + authorize the claimer to decrypt their own payout ("you won X cUSDC").
        FHE.allowThis(encPayout);
        FHE.allow(encPayout, msg.sender);
        pos.payout = encPayout;

        FHE.allowTransient(encPayout, m.token);
        IConfidentialUSDC(m.token).confidentialTransfer(msg.sender, encPayout);

        emit PayoutClaimed(marketId, msg.sender);
    }

    /// @notice Sweep the protocol fee (and, when there are no winners, the entire stranded pot)
    ///         to the treasury. Permissionless — funds always go to `treasury`. Idempotent.
    function sweepFees(uint256 marketId) external nonReentrant {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.poolRevealed, "Pool not revealed");
        require(!m.feesSwept, "Already swept");

        uint256 winPool   = m.outcome == SIDE_YES ? m.revealedYesPool : m.revealedNoPool;
        uint256 totalPool = m.revealedYesPool + m.revealedNoPool;
        require(totalPool <= type(uint64).max, "Pool overflow");

        // Winners claim `distributable`, leaving exactly `feeAmount`. With no winners nobody can
        // claim, so the whole pot is the sweep.
        bool    noWinners   = winPool == 0;
        uint256 sweepAmount = noWinners ? totalPool : m.feeAmount;

        m.feesSwept = true;
        if (sweepAmount > 0) {
            euint64 encSweep = FHE.asEuint64(uint64(sweepAmount));
            FHE.allowTransient(encSweep, m.token);
            IConfidentialUSDC(m.token).confidentialTransfer(treasury, encSweep);
        }

        emit FeesSwept(marketId, treasury, sweepAmount, noWinners);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function getMarket(uint256 marketId)
        external view
        returns (
            address creator,
            string memory question,
            uint64  epochStart,
            uint64  epochEnd,
            bool    resolved,
            uint8   outcome,
            uint256 revealedYesPool,
            uint256 revealedNoPool,
            uint256 clearingPrice,
            bool    poolRevealRequested,
            bool    poolRevealed,
            address priceFeed,
            int256  strikePrice,
            bool    useOracle,
            address token,
            uint256 betCount,
            uint256 bettorCount
        )
    {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        return (
            m.creator, m.question, m.epochStart, m.epochEnd, m.resolved, m.outcome,
            m.revealedYesPool, m.revealedNoPool, m.clearingPrice,
            m.poolRevealRequested, m.poolRevealed,
            m.priceFeed, m.strikePrice, m.useOracle, m.token, m.betCount, m.bettorCount
        );
    }

    function getPosition(uint256 marketId, address bettor)
        external view
        returns (bool exists, bool claimed)
    {
        Position storage pos = positions[marketId][bettor];
        return (pos.exists, pos.claimed);
    }

    function getEncStakes(uint256 marketId, address bettor)
        external view
        returns (euint64 yesStake, euint64 noStake)
    {
        Position storage pos = positions[marketId][bettor];
        return (pos.yesStake, pos.noStake);
    }

    function getEncPools(uint256 marketId) external view returns (euint64 yesPool, euint64 noPool) {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        return (m.yesPool, m.noPool);
    }

    /// @notice The claimer's encrypted payout handle (set at claim). Only the claimer has ACL to
    ///         decrypt it via the relayer — the UI uses this to show "you won X cUSDC".
    function getEncPayout(uint256 marketId, address bettor) external view returns (euint64 payout) {
        return positions[marketId][bettor].payout;
    }

    /// @notice Plaintext fee accounting for a revealed market.
    function getFeeInfo(uint256 marketId)
        external view
        returns (uint16 feeBps, uint256 feeAmount, uint256 distributable, bool feesSwept)
    {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        return (protocolFeeBps, m.feeAmount, m.distributable, m.feesSwept);
    }
}
