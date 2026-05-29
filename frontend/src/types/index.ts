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

// cUSDC on Sepolia
export const CUSDC_TOKEN  = "0xfDBFC62F97A7988515a2684fA427d449fA7a6BAe";
export const USDC_TOKEN   = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const USDC_DECIMALS = 6;

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
