export type EpochStatus =
  | "accumulating"
  | "closed"
  | "resolving"
  | "revealing"
  | "revealed";

export interface MarketView {
  id: number;
  creator: string;
  question: string;
  epochStart: number;
  epochEnd: number;
  resolved: boolean;
  outcome: number;
  totalEth: bigint;
  clearingPrice: bigint;
  revealedYesPool: bigint;
  revealedNoPool: bigint;
  poolRevealRequested: boolean;
  poolRevealed: boolean;
  epochStatus: EpochStatus;
  // Oracle resolution
  priceFeed: string;
  strikePrice: bigint;
  useOracle: boolean;
  // Token market
  isTokenMarket: boolean;
  token: string;
  participantCount: bigint;
}

export interface PositionView {
  amount: bigint;
  payoutRequested: boolean;
  claimed: boolean;
  isToken: boolean;
}

// Official Zama cUSDC (Mock) on Sepolia — github.com/zama-ai/protocol-apps
export const CUSDC_TOKEN      = "0x7c5BF43B851c1dff1a4feE8dB225b87f2C223639";
// Underlying mock USDC wrapped by official Zama cUSDC
export const USDC_TOKEN       = "0x9b5Cd13b8eFbB58Dc25A05CF411D8056058aDFfF";
export const USDC_DECIMALS    = 6;

// Zama Wrappers Registry — browse available confidential tokens
export const WRAPPERS_REGISTRY = "0x2f0750Bbb0A246059d80e94c454586a7F27a128e";

// Other Zama confidential tokens on Sepolia
export const CUSDT_TOKEN = "0x4E7B06D78965594eB5EF5414c357ca21E1554491";
export const CWETH_TOKEN = "0x46208622DA27d91db4f0393733C8BA082ed83158";

export const SIDE_NO  = 0;
export const SIDE_YES = 1;
export const UNRESOLVED = 255;

export function isTokenMarketView(m: MarketView): boolean {
  return m.isTokenMarket && m.token !== "0x0000000000000000000000000000000000000000";
}

export function computeEpochStatus(m: MarketView): EpochStatus {
  const now = Math.floor(Date.now() / 1000);
  if (m.poolRevealed) return "revealed";
  if (m.poolRevealRequested) return "revealing";
  if (m.resolved) return "resolving";
  if (now >= m.epochEnd) return "closed";
  return "accumulating";
}

// Known Chainlink price feeds on Sepolia
export const SEPOLIA_FEEDS: { label: string; address: string; decimals: number; unit: string }[] = [
  { label: "ETH / USD",  address: "0x694AA1769357215DE4FAC081bf1f309aDC325306", decimals: 8, unit: "USD" },
  { label: "BTC / USD",  address: "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43", decimals: 8, unit: "USD" },
  { label: "LINK / USD", address: "0xc59E3633BAAC79493d908e63626716e204A45EdF", decimals: 8, unit: "USD" },
  { label: "EUR / USD",  address: "0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910", decimals: 8, unit: "USD" },
];

/** Convert a human-readable price (e.g. 3000) to feed native units (8 decimals) */
export function toFeedUnits(price: number, decimals: number): bigint {
  return BigInt(Math.round(price * 10 ** decimals));
}

/** Convert feed native units back to a human-readable price string */
export function fromFeedUnits(raw: bigint, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
