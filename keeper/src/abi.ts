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

  // Resolution
  "function resolveByOracle(uint256 marketId) external",

  // Pool-reveal decryption callback (V2 settlement is single-step `claim` — no payout callback)
  "function onPoolRevealed(uint256 marketId, bytes32[] calldata handlesList, bytes calldata cleartexts, bytes calldata decryptionProof) external",
] as const;

// ConfidentialBatchAuction V2 (token-only) — Sepolia, deployed 2026-06-02
export const CONTRACT_ADDRESS = "0x68D2E94D5A94C542ea0741A8F38a957A436df2c6";
