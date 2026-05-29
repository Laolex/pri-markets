// Minimal ABI — only the events and functions the keeper uses
export const ABI = [
  // Events
  "event MarketCreatedWithOracle(uint256 indexed marketId, address creator, string question, uint64 epochStart, uint64 epochEnd, address priceFeed, int256 strikePrice)",
  "event PoolRevealRequested(uint256 indexed marketId, bytes32[2] handles)",
  "event PayoutRequested(uint256 indexed marketId, address indexed bettor, bytes32 handle)",

  // Views
  "function marketCount() external view returns (uint256)",
  "function getMarket(uint256 marketId) external view returns (address creator, string question, uint64 epochStart, uint64 epochEnd, bool resolved, uint8 outcome, uint256 totalEth, uint256 revealedYesPool, uint256 revealedNoPool, uint256 clearingPrice, bool poolRevealRequested, bool poolRevealed, address priceFeed, int256 strikePrice, bool useOracle)",
  "function getPosition(uint256 marketId, address bettor) external view returns (uint256 amount, bool payoutRequested, bool claimed)",

  // Market creation
  "function createMarketWithOracle(string question, uint64 epochDuration, address priceFeed, int256 strikePrice) external returns (uint256)",

  // Resolution
  "function resolveByOracle(uint256 marketId) external",

  // Callbacks
  "function onPoolRevealed(uint256 marketId, bytes32[] calldata handlesList, bytes calldata cleartexts, bytes calldata decryptionProof) external",
  "function onPayoutRevealed(uint256 marketId, address bettor, bytes32[] calldata handlesList, bytes calldata cleartexts, bytes calldata decryptionProof) external",
] as const;

export const CONTRACT_ADDRESS = "0x1Fe1Dc91396ECBEF7e2B59643A94D2C9277b9fd6";
