// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, euint64, ebool, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

/// @title ConfidentialBatchAuction — sealed-bid directional discovery for information markets
/// @notice Users submit encrypted YES/NO positions during a fixed epoch. ETH amounts are
///         plaintext; only the directional choice is sealed. At epoch close, aggregate YES and NO
///         volumes are revealed as the clearing price. Individual sides are NEVER revealed —
///         payouts are computed on-chain via FHE.select and only the payout amount is decrypted.
///
/// @dev    Resolution paths:
///           Manual: creator calls resolveMarket() — gated to non-oracle markets only.
///           Oracle: anyone calls resolveByOracle() after epochEnd — reads Chainlink feed,
///                   resolves YES if price >= strikePrice, NO otherwise. Fully permissionless.
///
///         requestPoolReveal is also permissionless — any address may trigger the aggregate
///         reveal once the market is resolved.
contract ConfidentialBatchAuction is ZamaEthereumConfig, ReentrancyGuard {
    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    uint8 public constant SIDE_NO = 0;
    uint8 public constant SIDE_YES = 1;
    uint8 public constant UNRESOLVED = 255;
    uint256 public constant MIN_BET = 0.001 ether;

    // ──────────────────────────────────────────────────────────────────────
    // Data structures
    // ──────────────────────────────────────────────────────────────────────

    struct Market {
        address creator;
        string question;
        uint64 epochStart;
        uint64 epochEnd;
        bool resolved;
        uint8 outcome;            // SIDE_YES, SIDE_NO, or UNRESOLVED
        uint256 totalEth;         // plaintext total ETH deposited (wei)
        euint64 yesPool;          // encrypted: accumulated gwei committed to YES
        euint64 noPool;           // encrypted: accumulated gwei committed to NO
        uint256 revealedYesPool;  // plaintext (wei), set after Pattern 3 reveal
        uint256 revealedNoPool;   // plaintext (wei), set after Pattern 3 reveal
        uint256 clearingPrice;    // basis points (0–10000): yesPool/(yesPool+noPool)*10000
        bool poolRevealRequested;
        bool poolRevealed;
        // Oracle resolution (optional — address(0) = creator-only manual resolution)
        address priceFeed;        // Chainlink AggregatorV3Interface
        int256 strikePrice;       // Feed native units (8 dec USD: $3000 = 300000000000)
        bool useOracle;
    }

    struct Position {
        euint8 side;        // encrypted: 0=NO, 1=YES; never publicly revealed
        uint256 amount;     // plaintext ETH bet (wei)
        euint64 encPayout;  // encrypted payout (gwei), set in requestPayout via FHE.select
        bool payoutRequested;
        bool claimed;
    }

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────

    Market[] private markets;
    mapping(uint256 => mapping(address => Position)) private positions;

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    event MarketCreated(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd);
    event MarketCreatedWithOracle(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address priceFeed, int256 strikePrice);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event MarketResolvedByOracle(uint256 indexed marketId, uint8 outcome, int256 price, int256 strikePrice);
    event PoolRevealRequested(uint256 indexed marketId, bytes32[2] handles);
    event PoolRevealed(uint256 indexed marketId, uint256 yesPool, uint256 noPool, uint256 clearingPrice);
    event PayoutRequested(uint256 indexed marketId, address indexed bettor, bytes32 handle);
    event PayoutClaimed(uint256 indexed marketId, address indexed bettor, uint256 payout);

    // ──────────────────────────────────────────────────────────────────────
    // Market lifecycle
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Create a manual-resolution epoch (creator resolves after close).
    function createMarket(
        string calldata question,
        uint64 epochDuration
    ) external returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(epochDuration >= 60, "Epoch too short");
        marketId = _initMarket(question, epochDuration);
        emit MarketCreated(marketId, msg.sender, question, markets[marketId].epochStart, markets[marketId].epochEnd);
    }

    /// @notice Create a permissionless oracle-resolved epoch.
    /// @param priceFeed  Chainlink AggregatorV3 address (e.g. ETH/USD on Sepolia)
    /// @param strikePrice Resolution threshold in feed native units (8 dec for USD pairs,
    ///                    so $3000 = 300000000000). YES if price >= strikePrice at epoch close.
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

        emit MarketCreatedWithOracle(marketId, msg.sender, question, m.epochStart, m.epochEnd, priceFeed, strikePrice);
    }

    function _initMarket(string calldata question, uint64 epochDuration) internal returns (uint256 marketId) {
        marketId = markets.length;
        markets.push();
        Market storage m = markets[marketId];
        m.creator    = msg.sender;
        m.question   = question;
        m.epochStart = uint64(block.timestamp);
        m.epochEnd   = uint64(block.timestamp) + epochDuration;
        m.outcome    = UNRESOLVED;

        euint64 zeroYes = FHE.asEuint64(0);
        FHE.allowThis(zeroYes);
        m.yesPool = zeroYes;

        euint64 zeroNo = FHE.asEuint64(0);
        FHE.allowThis(zeroNo);
        m.noPool = zeroNo;
    }

    /// @notice Submit a sealed bid during the epoch.
    function placeBet(
        uint256 marketId,
        bytes32 encSide,
        bytes calldata inputProof
    ) external payable nonReentrant {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(msg.value >= MIN_BET, "Below minimum bet");
        require(!m.resolved, "Market resolved");
        require(block.timestamp < m.epochEnd, "Epoch closed");
        require(positions[marketId][msg.sender].amount == 0, "Already bet");

        uint64 amtGwei = uint64(msg.value / 1e9);
        require(amtGwei > 0, "Amount rounds to zero gwei");

        euint8 side = FHE.fromExternal(externalEuint8.wrap(encSide), inputProof);
        FHE.allowThis(side);
        FHE.allow(side, msg.sender);

        ebool isYes = FHE.eq(side, FHE.asEuint8(SIDE_YES));
        euint64 fullAmt = FHE.asEuint64(amtGwei);
        euint64 zeroAmt = FHE.asEuint64(0);
        euint64 yesContrib = FHE.select(isYes, fullAmt, zeroAmt);
        euint64 noContrib  = FHE.select(FHE.not(isYes), fullAmt, zeroAmt);

        euint64 newYesPool = FHE.add(m.yesPool, yesContrib);
        FHE.allowThis(newYesPool);
        m.yesPool = newYesPool;

        euint64 newNoPool = FHE.add(m.noPool, noContrib);
        FHE.allowThis(newNoPool);
        m.noPool = newNoPool;

        m.totalEth += msg.value;

        Position storage pos = positions[marketId][msg.sender];
        pos.side   = side;
        pos.amount = msg.value;

        emit BetPlaced(marketId, msg.sender, msg.value);
    }

    /// @notice Manually resolve a non-oracle epoch. Only the creator can call.
    ///         Oracle markets must use resolveByOracle() instead.
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

    /// @notice Permissionless oracle resolution. Anyone may call after epochEnd.
    ///         Reads the Chainlink feed and resolves YES if price >= strikePrice.
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

    /// @notice Mark both encrypted pool totals as publicly decryptable.
    ///         Permissionless — any address may trigger the reveal after resolution.
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

    /// @notice Relayer callback — verifies signed cleartexts for the two pool handles.
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

        uint256 yesGwei;
        uint256 noGwei;
        assembly {
            yesGwei := calldataload(add(cleartexts.offset, 0))
            noGwei  := calldataload(add(cleartexts.offset, 32))
        }
        m.revealedYesPool = yesGwei * 1e9;
        m.revealedNoPool  = noGwei  * 1e9;

        uint256 totalPool = m.revealedYesPool + m.revealedNoPool;
        m.clearingPrice = totalPool > 0 ? (m.revealedYesPool * 10000) / totalPool : 0;
        m.poolRevealed = true;

        emit PoolRevealed(marketId, m.revealedYesPool, m.revealedNoPool, m.clearingPrice);
    }

    /// @notice Compute a bettor's FHE-gated payout without ever revealing their side.
    function requestPayout(uint256 marketId) external {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.poolRevealed, "Pool not revealed");

        Position storage pos = positions[marketId][msg.sender];
        require(pos.amount > 0, "No position");
        require(!pos.payoutRequested, "Already requested");

        uint256 winPool = m.outcome == SIDE_YES ? m.revealedYesPool : m.revealedNoPool;
        uint64 fullPayoutGwei = winPool > 0
            ? uint64((pos.amount * m.totalEth) / winPool / 1e9)
            : 0;

        ebool won = FHE.eq(pos.side, FHE.asEuint8(m.outcome));
        euint64 encPayout = FHE.select(won, FHE.asEuint64(fullPayoutGwei), FHE.asEuint64(0));
        FHE.allowThis(encPayout);
        FHE.allow(encPayout, msg.sender);
        FHE.makePubliclyDecryptable(encPayout);

        pos.encPayout       = encPayout;
        pos.payoutRequested = true;

        emit PayoutRequested(marketId, msg.sender, FHE.toBytes32(encPayout));
    }

    /// @notice Relayer callback — verifies signed cleartext for the payout handle and
    ///         transfers ETH to the bettor.
    function onPayoutRevealed(
        uint256 marketId,
        address bettor,
        bytes32[] calldata handlesList,
        bytes calldata cleartexts,
        bytes calldata decryptionProof
    ) external nonReentrant {
        require(marketId < markets.length, "Bad market");
        Position storage pos = positions[marketId][bettor];
        require(pos.payoutRequested, "Payout not requested");
        require(!pos.claimed, "Already claimed");
        require(handlesList.length == 1, "Need 1 handle");
        require(cleartexts.length == 32, "Bad cleartext length");

        require(handlesList[0] == FHE.toBytes32(pos.encPayout), "Payout handle mismatch");
        FHE.checkSignatures(handlesList, cleartexts, decryptionProof);

        uint256 payoutGwei;
        assembly {
            payoutGwei := calldataload(cleartexts.offset)
        }
        uint256 payout = payoutGwei * 1e9;
        pos.claimed = true;

        if (payout > 0) {
            (bool ok, ) = bettor.call{value: payout}("");
            require(ok, "ETH transfer failed");
        }

        emit PayoutClaimed(marketId, bettor, payout);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────────────────────────────────

    function marketCount() external view returns (uint256) {
        return markets.length;
    }

    function getMarket(uint256 marketId)
        external
        view
        returns (
            address creator,
            string memory question,
            uint64 epochStart,
            uint64 epochEnd,
            bool resolved,
            uint8 outcome,
            uint256 totalEth,
            uint256 revealedYesPool,
            uint256 revealedNoPool,
            uint256 clearingPrice,
            bool poolRevealRequested,
            bool poolRevealed,
            address priceFeed,
            int256 strikePrice,
            bool useOracle
        )
    {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        return (
            m.creator,
            m.question,
            m.epochStart,
            m.epochEnd,
            m.resolved,
            m.outcome,
            m.totalEth,
            m.revealedYesPool,
            m.revealedNoPool,
            m.clearingPrice,
            m.poolRevealRequested,
            m.poolRevealed,
            m.priceFeed,
            m.strikePrice,
            m.useOracle
        );
    }

    function getPosition(uint256 marketId, address bettor)
        external
        view
        returns (uint256 amount, bool payoutRequested, bool claimed)
    {
        Position storage pos = positions[marketId][bettor];
        return (pos.amount, pos.payoutRequested, pos.claimed);
    }

    function getEncSide(uint256 marketId, address bettor) external view returns (euint8) {
        return positions[marketId][bettor].side;
    }

    function getEncPools(uint256 marketId) external view returns (euint64 yesPool, euint64 noPool) {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        return (m.yesPool, m.noPool);
    }

    function getEncPayout(uint256 marketId, address bettor) external view returns (euint64) {
        return positions[marketId][bettor].encPayout;
    }
}
