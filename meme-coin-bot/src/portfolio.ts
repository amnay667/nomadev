import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";
import type { PortfolioState, Position, Trade } from "./types.js";
import type { Features } from "./features.js";

export class Portfolio {
  state: PortfolioState;
  private trades: Trade[] = [];

  constructor() {
    this.state = this.load();
    this.trades = this.loadTrades();
  }

  private load(): PortfolioState {
    if (existsSync(config.dataFile)) {
      return JSON.parse(readFileSync(config.dataFile, "utf-8"));
    }
    return { cashUsd: config.startingBalanceUsd, positions: [], realizedPnlUsd: 0 };
  }

  private loadTrades(): Trade[] {
    if (existsSync(config.tradeLogFile)) {
      return JSON.parse(readFileSync(config.tradeLogFile, "utf-8"));
    }
    return [];
  }

  private persist() {
    mkdirSync(dirname(config.dataFile), { recursive: true });
    writeFileSync(config.dataFile, JSON.stringify(this.state, null, 2));
    writeFileSync(config.tradeLogFile, JSON.stringify(this.trades, null, 2));
  }

  /** Simulated price impact from trading against a shallow pool. */
  private priceImpactPct(tradeUsd: number, liquidityUsd: number): number {
    if (liquidityUsd <= 0) return 100;
    return (tradeUsd / liquidityUsd) * config.priceImpactCoefficient * 100;
  }

  hasPosition(tokenAddress: string): boolean {
    return this.state.positions.some((p) => p.tokenAddress === tokenAddress);
  }

  canOpenNewPosition(): boolean {
    return (
      this.state.positions.length < config.maxOpenPositions &&
      this.state.cashUsd >= config.positionSizeUsd
    );
  }

  buy(
    tokenAddress: string,
    pairAddress: string,
    symbol: string,
    quotedPriceUsd: number,
    liquidityUsd: number,
    reason: string,
    features: Features,
  ) {
    const tradeUsd = config.positionSizeUsd;
    const impactPct = this.priceImpactPct(tradeUsd, liquidityUsd);
    const effectivePrice = quotedPriceUsd * (1 + impactPct / 100);
    const feeUsd = tradeUsd * (config.dexFeePct / 100);
    const netUsd = tradeUsd - feeUsd;
    const quantity = netUsd / effectivePrice;

    this.state.cashUsd -= tradeUsd;
    this.state.positions.push({
      tokenAddress,
      pairAddress,
      symbol,
      entryPriceUsd: effectivePrice,
      quantity,
      costUsd: tradeUsd,
      openedAt: Date.now(),
      features,
    });

    this.trades.push({
      side: "BUY",
      tokenAddress,
      symbol,
      priceUsd: effectivePrice,
      quantity,
      valueUsd: tradeUsd,
      feeUsd,
      reason,
      timestamp: Date.now(),
    });

    this.persist();
  }

  sell(
    position: Position,
    quotedPriceUsd: number,
    liquidityUsd: number,
    reason: string,
  ): number {
    const grossUsd = position.quantity * quotedPriceUsd;
    const impactPct = this.priceImpactPct(grossUsd, liquidityUsd);
    const effectivePrice = quotedPriceUsd * (1 - impactPct / 100);
    const proceedsGross = position.quantity * effectivePrice;
    const feeUsd = proceedsGross * (config.dexFeePct / 100);
    const proceedsNet = proceedsGross - feeUsd;
    const pnlUsd = proceedsNet - position.costUsd;

    this.state.cashUsd += proceedsNet;
    this.state.realizedPnlUsd += pnlUsd;
    this.state.positions = this.state.positions.filter(
      (p) => p.tokenAddress !== position.tokenAddress,
    );

    this.trades.push({
      side: "SELL",
      tokenAddress: position.tokenAddress,
      symbol: position.symbol,
      priceUsd: effectivePrice,
      quantity: position.quantity,
      valueUsd: proceedsNet,
      feeUsd,
      reason,
      timestamp: Date.now(),
      pnlUsd,
    });

    this.persist();
    return pnlUsd;
  }

  getTrades(): Trade[] {
    return this.trades;
  }

  totalValueUsd(currentPrices: Map<string, number>): number {
    const positionsValue = this.state.positions.reduce((sum, p) => {
      const price = currentPrices.get(p.tokenAddress) ?? p.entryPriceUsd;
      return sum + p.quantity * price;
    }, 0);
    return this.state.cashUsd + positionsValue;
  }
}
