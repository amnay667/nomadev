import type { Features } from "./features.js";

export interface TokenProfile {
  chainId: string;
  tokenAddress: string;
}

export interface DexPair {
  chainId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  liquidity?: { usd: number };
  volume?: { h1: number; h24: number };
  priceChange?: { h1: number; h24: number };
  pairCreatedAt?: number;
}

export interface Position {
  tokenAddress: string;
  pairAddress: string;
  symbol: string;
  entryPriceUsd: number;
  quantity: number;
  costUsd: number;
  openedAt: number;
  features: Features;
}

export interface Trade {
  side: "BUY" | "SELL";
  tokenAddress: string;
  symbol: string;
  priceUsd: number;
  quantity: number;
  valueUsd: number;
  feeUsd: number;
  reason: string;
  timestamp: number;
  pnlUsd?: number;
}

export interface PortfolioState {
  cashUsd: number;
  positions: Position[];
  realizedPnlUsd: number;
}
