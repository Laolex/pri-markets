// Minimal ABI — only the events and functions the keeper uses (V2, token-only)
export const ABI = [
  // Events
  "event MarketCreatedWithOracle(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address token, address priceFeed, int256 strikePrice)",
  "event PoolRevealRequested(uint256 indexed marketId, bytes32[2] handles)",

  // Views (V2 getMarket return shape)
  "function marketCount() external view returns (uint256)",
  "function getMarket(uint256 marketId) external view returns (address creator, string question, uint64 epochStart, uint64 epochEnd, bool resolved, uint8 outcome, uint256 revealedYesPool, uint256 revealedNoPool, uint256 clearingPrice, bool poolRevealRequested, bool poolRevealed, address priceFeed, int256 strikePrice, bool useOracle, address token, uint256 betCount, uint256 bettorCount)",

  // Market creation (demo refresh)
  "function createMarketWithOracle(string question, uint64 epochDuration, address priceFeed, int256 strikePrice) external returns (uint256)",

  // Resolution + pool-reveal request (autonomous settlement)
  "function resolveByOracle(uint256 marketId) external",
  "function requestPoolReveal(uint256 marketId) external",

  // Pool-reveal decryption callback (V2 settlement is single-step `claim` — no payout callback)
  "function onPoolRevealed(uint256 marketId, bytes32[] calldata handlesList, bytes calldata cleartexts, bytes calldata decryptionProof) external",

  // Treasury sweep — permissionless; collects the 2% fee (or the full no-winner pot) into treasury
  "function sweepFees(uint256 marketId) external",
  "function getFeeInfo(uint256 marketId) external view returns (uint16 feeBps, uint256 feeAmount, uint256 distributable, bool feesSwept)",
] as const;

// ConfidentialBatchAuction V2 (token-only, fee+treasury) — Sepolia, deployed 2026-06-03
export const CONTRACT_ADDRESS = "0xF00573FbBE32264ac14442BDC39512845D0d41C1";
