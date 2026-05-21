// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint8, euint64, ebool, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ConfidentialBatchAuction — sealed-bid directional discovery for information markets
/// @notice Users submit encrypted YES/NO positions during a fixed epoch. ETH amounts are
///         plaintext; only the directional choice is sealed. At epoch close, aggregate YES and NO
///         volumes are revealed as the clearing price. Individual sides are NEVER revealed —
///         payouts are computed on-chain via FHE.select and only the payout amount is decrypted.
///
/// @dev    Core mechanism: eliminating pre-trade directional signaling during price formation.
///         Continuous markets leak sentiment (visible YES/NO imbalance drives reflexive momentum).
///         Batch epochs + encrypted sides suppress this: nobody sees directional skew until after
///         the epoch closes and no more orders can be placed.
///
///         FHE operations:
///           placeBet:      fromExternal + eq + select + add (pool accumulation)
///           requestPayout: eq(side, outcome) + select(won, fullPayout, 0) + makePubliclyDecryptable
///           onPayoutRevealed: checkSignatures + assembly calldataload
///
///         Pattern 3 (public decryption):
///           - makePubliclyDecryptable emits handles to the relayer
///           - relayer signs cleartexts with KMS key
///           - contract callback pins handles before checkSignatures (anti-substitution)
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
    event BetPlaced(uint256 indexed marketId, address indexed bettor, uint256 amount);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event PoolRevealRequested(uint256 indexed marketId, bytes32[2] handles);
    event PoolRevealed(uint256 indexed marketId, uint256 yesPool, uint256 noPool, uint256 clearingPrice);
    event PayoutRequested(uint256 indexed marketId, address indexed bettor, bytes32 handle);
    event PayoutClaimed(uint256 indexed marketId, address indexed bettor, uint256 payout);

    // ──────────────────────────────────────────────────────────────────────
    // Market lifecycle
    // ──────────────────────────────────────────────────────────────────────

    /// @notice Create a new sealed-bid batch auction epoch.
    /// @param question The binary question to be resolved (e.g. "BTC above $100k by Dec 31?")
    /// @param epochDuration Epoch length in seconds; betting is open until epochEnd
    function createMarket(
        string calldata question,
        uint64 epochDuration
    ) external returns (uint256 marketId) {
        require(bytes(question).length > 0, "Empty question");
        require(epochDuration >= 60, "Epoch too short");

        marketId = markets.length;
        markets.push();
        Market storage m = markets[marketId];
        m.creator = msg.sender;
        m.question = question;
        m.epochStart = uint64(block.timestamp);
        m.epochEnd   = uint64(block.timestamp) + epochDuration;
        m.outcome    = UNRESOLVED;

        euint64 zeroYes = FHE.asEuint64(0);
        FHE.allowThis(zeroYes);
        m.yesPool = zeroYes;

        euint64 zeroNo = FHE.asEuint64(0);
        FHE.allowThis(zeroNo);
        m.noPool = zeroNo;

        emit MarketCreated(marketId, msg.sender, question, m.epochStart, m.epochEnd);
    }

    /// @notice Submit a sealed bid during the epoch.
    /// @param marketId The target market
    /// @param encSide  Encrypted uint8: 0 = NO, 1 = YES (from fhevm.createEncryptedInput.add8)
    /// @param inputProof ZK proof binding encSide to msg.sender and this contract
    /// @dev ETH amount is plaintext (msg.value). Side is encrypted throughout the epoch —
    ///      the pool accumulation uses FHE.select so even the individual YES/NO contribution
    ///      to the ciphertext pool is hidden. Nobody sees directional skew until epoch close.
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

    /// @notice Resolve the epoch after it has closed. Only the creator can call.
    /// @param marketId The market to resolve
    /// @param outcome  SIDE_YES (1) or SIDE_NO (0) — the oracle-determined result
    function resolveMarket(uint256 marketId, uint8 outcome) external {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        require(msg.sender == m.creator, "Not creator");
        require(block.timestamp >= m.epochEnd, "Epoch not closed");
        require(!m.resolved, "Already resolved");
        require(outcome == SIDE_YES || outcome == SIDE_NO, "Invalid outcome");

        m.resolved = true;
        m.outcome  = outcome;
        emit MarketResolved(marketId, outcome);
    }

    /// @notice Mark both encrypted pool totals as publicly decryptable.
    ///         Emits handles so the relayer can request KMS signatures.
    ///         Called once after resolution; triggers the aggregate-only reveal.
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
    ///         Writes aggregate volumes and computes the clearing price.
    ///
    /// @dev    Handle pinning (rule 2): handlesList[0] is bound to m.yesPool and handlesList[1]
    ///         to m.noPool before checkSignatures. Without pinning an attacker could substitute
    ///         any other publicly-decryptable euint64.
    ///
    ///         Cleartexts: flat tuple of 2 × uint256 (32 bytes each), values in gwei.
    ///
    ///         Clearing price: yesPool / (yesPool + noPool) * 10000 basis points.
    ///         This is the first and only public signal about directional flow —
    ///         published after epoch close so it cannot influence bids.
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
    ///
    /// @dev    Settlement path (no side reveal):
    ///           1. winPool and fullPayout are computed in plaintext from public data.
    ///           2. FHE.eq(pos.side, outcome) produces an encrypted bool `won`.
    ///           3. FHE.select(won, fullPayoutGwei, 0) gates the amount — only the FHE
    ///              coprocessor evaluates the branch; the contract sees only a ciphertext.
    ///           4. The result is made publicly decryptable and its handle is emitted.
    ///
    ///         The bettor's side remains encrypted in storage. Only the payout amount
    ///         is eventually decrypted — and only to complete the ETH transfer.
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
    ///         transfers ETH to the bettor. Losers receive 0 ETH; their side is never revealed.
    ///
    /// @dev    Handle pinning: handlesList[0] is bound to pos.encPayout before checkSignatures.
    ///         Payout value is in gwei (×1e9 to restore wei).
    ///         Zero-payout transfers are skipped but the position is marked claimed,
    ///         preventing double-calls.
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
            bool poolRevealed
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
            m.poolRevealed
        );
    }

    function getPosition(uint256 marketId, address bettor)
        external
        view
        returns (
            uint256 amount,
            bool payoutRequested,
            bool claimed
        )
    {
        Position storage pos = positions[marketId][bettor];
        return (pos.amount, pos.payoutRequested, pos.claimed);
    }

    /// @notice Return the encrypted side handle — allows the bettor to re-encrypt
    ///         and privately verify their own choice. ACL grants msg.sender access in placeBet.
    function getEncSide(uint256 marketId, address bettor) external view returns (euint8) {
        return positions[marketId][bettor].side;
    }

    /// @notice Return the encrypted pool handles for Pattern 3 reveal calls.
    function getEncPools(uint256 marketId) external view returns (euint64 yesPool, euint64 noPool) {
        require(marketId < markets.length, "Bad market");
        Market storage m = markets[marketId];
        return (m.yesPool, m.noPool);
    }

    /// @notice Return a bettor's encrypted payout handle for the Pattern 3 claim callback.
    function getEncPayout(uint256 marketId, address bettor) external view returns (euint64) {
        return positions[marketId][bettor].encPayout;
    }
}
