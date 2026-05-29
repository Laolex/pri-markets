// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, euint64, ebool, externalEuint8, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
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

/// @dev Minimal interface for ERC-7984 confidential token (cUSDC on Sepolia).
///      confidentialTransferFrom takes an external encrypted amount + proof — the
///      token contract decodes it via FHE.fromExternal internally.
///      confidentialTransfer sends an already-decoded euint64 handle.
interface IConfidentialUSDC {
    function confidentialTransferFrom(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64);

    function confidentialTransfer(
        address to,
        euint64 encryptedAmount
    ) external;
}

/// @title ConfidentialBatchAuction — sealed-bid directional discovery for information markets
/// @notice Two collateral paths:
///           ETH path  — plaintext amount, encrypted side, 2-step settlement via KMS callback.
///           Token path — encrypted amount + side (cUSDC/ERC-7984), single-step settlement
///                        via confidentialTransfer. Side AND payout amount are never revealed.
///
/// @dev    Resolution paths:
///           Manual: creator calls resolveMarket() — gated to non-oracle markets only.
///           Oracle: anyone calls resolveByOracle() after epochEnd — reads Chainlink feed,
///                   resolves YES if price >= strikePrice, NO otherwise. Fully permissionless.
///
///         requestPoolReveal is permissionless — any address may trigger once the market is resolved.
contract ConfidentialBatchAuction is ZamaEthereumConfig, ReentrancyGuard {
    // ──────────────────────────────────────────────────────────────────────
    // Constants
    // ──────────────────────────────────────────────────────────────────────

    uint8   public constant SIDE_NO    = 0;
    uint8   public constant SIDE_YES   = 1;
    uint8   public constant UNRESOLVED = 255;
    uint256 public constant MIN_BET    = 0.001 ether;
    uint256 public constant MIN_TOKEN_BET = 1e4; // 0.01 USDC (6 decimals)

    // Deployed cUSDC on Sepolia — ERC7984ERC20Wrapper wrapping USDC
    address public constant CUSDC_TOKEN = 0xfDBFC62F97A7988515a2684fA427d449fA7a6BAe;

    // ──────────────────────────────────────────────────────────────────────
    // Data structures
    // ──────────────────────────────────────────────────────────────────────

    struct Market {
        address creator;
        string  question;
        uint64  epochStart;
        uint64  epochEnd;
        bool    resolved;
        uint8   outcome;              // SIDE_YES, SIDE_NO, or UNRESOLVED
        uint256 totalEth;             // ETH path: plaintext wei deposited
        euint64 yesPool;              // encrypted accumulator (gwei for ETH, raw units for token)
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
        // Token market
        bool    isTokenMarket;
        address token;                // ERC-7984 token address (or address(0) for ETH markets)
        uint256 participantCount;     // total bids placed (both paths)
    }

    struct Position {
        bool    exists;           // true once any bet is placed
        euint8  side;             // encrypted direction — NEVER publicly revealed
        // ETH path
        uint256 amount;           // plaintext wei (ETH path) or 0 (token path)
        euint64 encPayout;        // set in requestPayout (ETH path)
        bool    payoutRequested;
        // Token path
        euint64 encAmount;        // encrypted token units (token path) or empty (ETH path)
        bool    isToken;
        // Common
        bool    claimed;
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
    event TokenMarketCreated(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address token);
    event TokenMarketCreatedWithOracle(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address token, address priceFeed, int256 strikePrice);
    event BetPlaced(uint256 indexed marketId, address indexed bettor, uint256 amount);
    event TokenBetPlaced(uint256 indexed marketId, address indexed bettor);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event MarketResolvedByOracle(uint256 indexed marketId, uint8 outcome, int256 price, int256 strikePrice);
    event PoolRevealRequested(uint256 indexed marketId, bytes32[2] handles);
    event PoolRevealed(uint256 indexed marketId, uint256 yesPool, uint256 noPool, uint256 clearingPrice);
    event PayoutRequested(uint256 indexed marketId, address indexed bettor, bytes32 handle);
    event PayoutClaimed(uint256 indexed marketId, address indexed bettor, uint256 payout);
    event TokenPayoutClaimed(uint256 indexed marketId, address indexed bettor);

    // ──────────────────────────────────────────────────────────────────────
    // Market lifecycle — ETH markets
    // ──────────────────────────────────────────────────────────────────────

    function createMarket(
        string calldata question,
        uint64 epochDuration
    ) external returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(epochDuration >= 60, "Epoch too short");
        marketId = _initMarket(question, epochDuration, false, address(0));
        emit MarketCreated(marketId, msg.sender, question, markets[marketId].epochStart, markets[marketId].epochEnd);
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
        marketId = _initMarket(question, epochDuration, false, address(0));
        Market storage m = markets[marketId];
        m.priceFeed   = priceFeed;
        m.strikePrice = strikePrice;
        m.useOracle   = true;
        emit MarketCreatedWithOracle(marketId, msg.sender, question, m.epochStart, m.epochEnd, priceFeed, strikePrice);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Market lifecycle — Token markets (cUSDC / ERC-7984)
    // ──────────────────────────────────────────────────────────────────────

    function createTokenMarket(
        string calldata question,
        uint64 epochDuration
    ) external returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(epochDuration >= 60, "Epoch too short");
        marketId = _initMarket(question, epochDuration, true, CUSDC_TOKEN);
        emit TokenMarketCreated(marketId, msg.sender, question, markets[marketId].epochStart, markets[marketId].epochEnd, CUSDC_TOKEN);
    }

    function createTokenMarketWithOracle(
        string calldata question,
        uint64 epochDuration,
        address priceFeed,
        int256 strikePrice
    ) external returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(epochDuration >= 60, "Epoch too short");
        require(priceFeed != address(0), "Invalid feed address");
        require(strikePrice > 0, "Strike price must be positive");
        marketId = _initMarket(question, epochDuration, true, CUSDC_TOKEN);
        Market storage m = markets[marketId];
        m.priceFeed   = priceFeed;
        m.strikePrice = strikePrice;
        m.useOracle   = true;
        emit TokenMarketCreatedWithOracle(marketId, msg.sender, question, m.epochStart, m.epochEnd, CUSDC_TOKEN, priceFeed, strikePrice);
    }

    function _initMarket(
        string calldata question,
        uint64 epochDuration,
        bool isTokenMarket,
        address token
    ) internal returns (uint256 marketId) {
        marketId = markets.length;
        markets.push();
        Market storage m = markets[marketId];
        m.creator        = msg.sender;
        m.question       = question;
        m.epochStart     = uint64(block.timestamp);
        m.epochEnd       = uint64(block.timestamp) + epochDuration;
        m.outcome        = UNRESOLVED;
        m.isTokenMarket  = isTokenMarket;
        m.token          = token;

        euint64 zeroYes = FHE.asEuint64(0);
        FHE.allowThis(zeroYes);
        m.yesPool = zeroYes;

        euint64 zeroNo = FHE.asEuint64(0);
        FHE.allowThis(zeroNo);
        m.noPool = zeroNo;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Bid submission — ETH path
    // ──────────────────────────────────────────────────────────────────────

    function placeBet(
        uint256 marketId,
        bytes32 encSide,
        bytes calldata inputProof
    ) external payable nonReentrant {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(!m.isTokenMarket, "Token market: use placeBetToken");
        require(msg.value >= MIN_BET, "Below minimum bet");
        require(!m.resolved, "Market resolved");
        require(block.timestamp < m.epochEnd, "Epoch closed");
        require(!positions[marketId][msg.sender].exists, "Already bet");

        uint64 amtGwei = uint64(msg.value / 1e9);
        require(amtGwei > 0, "Amount rounds to zero gwei");

        euint8 side = FHE.fromExternal(externalEuint8.wrap(encSide), inputProof);
        FHE.allowThis(side);
        FHE.allow(side, msg.sender);

        ebool isYes        = FHE.eq(side, FHE.asEuint8(SIDE_YES));
        euint64 fullAmt    = FHE.asEuint64(amtGwei);
        euint64 zeroAmt    = FHE.asEuint64(0);
        euint64 yesContrib = FHE.select(isYes, fullAmt, zeroAmt);
        euint64 noContrib  = FHE.select(FHE.not(isYes), fullAmt, zeroAmt);

        euint64 newYesPool = FHE.add(m.yesPool, yesContrib);
        FHE.allowThis(newYesPool);
        m.yesPool = newYesPool;

        euint64 newNoPool = FHE.add(m.noPool, noContrib);
        FHE.allowThis(newNoPool);
        m.noPool = newNoPool;

        m.totalEth += msg.value;
        m.participantCount++;

        Position storage pos = positions[marketId][msg.sender];
        pos.exists = true;
        pos.side   = side;
        pos.amount = msg.value;

        emit BetPlaced(marketId, msg.sender, msg.value);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Bid submission — Token path (cUSDC / ERC-7984)
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Place a sealed bid using cUSDC. Both direction AND amount are encrypted.
    ///         The user must have cUSDC balance (wrap USDC → cUSDC via cUSDC.depositFor first).
    ///         A single inputProof covers both encSide (uint8) and encAmount (uint64).
    ///         Frontend: createEncryptedInput(contract, user).add8(side).add64(amount).encrypt()
    function placeBetToken(
        uint256 marketId,
        bytes32 encSide,
        bytes32 encAmount,
        bytes calldata inputProof
    ) external nonReentrant {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.isTokenMarket, "ETH market: use placeBet");
        require(!m.resolved, "Market resolved");
        require(block.timestamp < m.epochEnd, "Epoch closed");
        require(!positions[marketId][msg.sender].exists, "Already bet");

        // Decode side locally
        euint8 side = FHE.fromExternal(externalEuint8.wrap(encSide), inputProof);
        FHE.allowThis(side);
        FHE.allow(side, msg.sender);

        // Transfer cUSDC from user to contract — token contract decodes encAmount internally
        euint64 received = IConfidentialUSDC(m.token).confidentialTransferFrom(
            msg.sender,
            address(this),
            externalEuint64.wrap(encAmount),
            inputProof
        );
        FHE.allowThis(received);
        FHE.allow(received, msg.sender);

        // Route into encrypted pools
        ebool isYes        = FHE.eq(side, FHE.asEuint8(SIDE_YES));
        euint64 zeroAmt    = FHE.asEuint64(0);
        euint64 yesContrib = FHE.select(isYes, received, zeroAmt);
        euint64 noContrib  = FHE.select(FHE.not(isYes), received, zeroAmt);

        euint64 newYesPool = FHE.add(m.yesPool, yesContrib);
        FHE.allowThis(newYesPool);
        m.yesPool = newYesPool;

        euint64 newNoPool = FHE.add(m.noPool, noContrib);
        FHE.allowThis(newNoPool);
        m.noPool = newNoPool;

        m.participantCount++;

        Position storage pos = positions[marketId][msg.sender];
        pos.exists    = true;
        pos.side      = side;
        pos.encAmount = received;
        pos.isToken   = true;

        emit TokenBetPlaced(marketId, msg.sender);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Resolution
    // ──────────────────────────────────────────────────────────────────────

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

    // ──────────────────────────────────────────────────────────────────────
    // Pool reveal — Pattern 3 (same for both ETH and token markets)
    // ──────────────────────────────────────────────────────────────────────

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

        // ETH markets: pools are in gwei → convert to wei.
        // Token markets: pools are in raw token units (6 decimals for USDC) → store as-is.
        if (m.isTokenMarket) {
            m.revealedYesPool = yesRaw;
            m.revealedNoPool  = noRaw;
        } else {
            m.revealedYesPool = yesRaw * 1e9;
            m.revealedNoPool  = noRaw  * 1e9;
        }

        uint256 totalPool = m.revealedYesPool + m.revealedNoPool;
        m.clearingPrice   = totalPool > 0 ? (m.revealedYesPool * 10000) / totalPool : 0;
        m.poolRevealed    = true;

        emit PoolRevealed(marketId, m.revealedYesPool, m.revealedNoPool, m.clearingPrice);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Settlement — ETH path (2-step via KMS callback)
    // ──────────────────────────────────────────────────────────────────────

    function requestPayout(uint256 marketId) external {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.poolRevealed, "Pool not revealed");

        Position storage pos = positions[marketId][msg.sender];
        require(pos.exists && !pos.isToken, "No ETH position");
        require(!pos.payoutRequested, "Already requested");

        uint256 winPool        = m.outcome == SIDE_YES ? m.revealedYesPool : m.revealedNoPool;
        uint64 fullPayoutGwei  = winPool > 0
            ? uint64((pos.amount * m.totalEth) / winPool / 1e9)
            : 0;

        ebool won      = FHE.eq(pos.side, FHE.asEuint8(m.outcome));
        euint64 encPay = FHE.select(won, FHE.asEuint64(fullPayoutGwei), FHE.asEuint64(0));
        FHE.allowThis(encPay);
        FHE.allow(encPay, msg.sender);
        FHE.makePubliclyDecryptable(encPay);

        pos.encPayout       = encPay;
        pos.payoutRequested = true;

        emit PayoutRequested(marketId, msg.sender, FHE.toBytes32(encPay));
    }

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
            (bool ok,) = bettor.call{value: payout}("");
            require(ok, "ETH transfer failed");
        }

        emit PayoutClaimed(marketId, bettor, payout);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Settlement — Token path (single-step, no KMS callback)
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Claim cUSDC payout in a single transaction. No KMS callback needed.
    ///         Payout is computed entirely inside the coprocessor:
    ///           encPayout = FHE.select(won, encAmount * totalPool / winPool, 0)
    ///         Both totalPool and winPool are plaintext scalars after pool reveal.
    ///         The payout amount is never written to plaintext storage or emitted.
    function claimToken(uint256 marketId) external nonReentrant {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(m.isTokenMarket, "Not a token market");
        require(m.poolRevealed, "Pool not revealed");

        Position storage pos = positions[marketId][msg.sender];
        require(pos.exists && pos.isToken, "No token position");
        require(!pos.claimed, "Already claimed");

        uint256 winPool   = m.outcome == SIDE_YES ? m.revealedYesPool : m.revealedNoPool;
        uint256 totalPool = m.revealedYesPool + m.revealedNoPool;

        // Both scalars must fit in uint64 — guaranteed for USDC testnet amounts
        require(totalPool <= type(uint64).max, "Pool overflow");
        require(winPool   <= type(uint64).max, "Pool overflow");

        // Proportional payout using scalar FHE ops (~1.1M HCU, well within 20M limit)
        euint64 numerator  = FHE.mul(pos.encAmount, uint64(totalPool));
        euint64 fullPayout = winPool > 0
            ? FHE.div(numerator, uint64(winPool))
            : FHE.asEuint64(0);

        ebool won         = FHE.eq(pos.side, FHE.asEuint8(m.outcome));
        euint64 encPayout = FHE.select(won, fullPayout, FHE.asEuint64(0));

        pos.claimed = true;

        // Grant token contract permission to move the payout handle, then transfer
        FHE.allow(encPayout, m.token);
        IConfidentialUSDC(m.token).confidentialTransfer(msg.sender, encPayout);

        emit TokenPayoutClaimed(marketId, msg.sender);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Views
    // ──────────────────────────────────────────────────────────────────────

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
            uint256 totalEth,
            uint256 revealedYesPool,
            uint256 revealedNoPool,
            uint256 clearingPrice,
            bool    poolRevealRequested,
            bool    poolRevealed,
            address priceFeed,
            int256  strikePrice,
            bool    useOracle,
            bool    isTokenMarket,
            address token,
            uint256 participantCount
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
            m.useOracle,
            m.isTokenMarket,
            m.token,
            m.participantCount
        );
    }

    function getPosition(uint256 marketId, address bettor)
        external view
        returns (uint256 amount, bool payoutRequested, bool claimed, bool isToken)
    {
        Position storage pos = positions[marketId][bettor];
        return (pos.amount, pos.payoutRequested, pos.claimed, pos.isToken);
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

    function getEncAmount(uint256 marketId, address bettor) external view returns (euint64) {
        return positions[marketId][bettor].encAmount;
    }
}
