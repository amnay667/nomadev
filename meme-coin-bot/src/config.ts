export const config = {
  chainId: "solana",

  pollIntervalMs: 30_000,

  startingBalanceUsd: 1000,

  // Entry filters
  minLiquidityUsd: 20_000,
  minVolumeH1Usd: 10_000,
  minPriceChangeH1Pct: 5,

  // Position sizing / risk
  maxOpenPositions: 5,
  positionSizeUsd: 100,

  // Exit rules
  takeProfitPct: 40,
  stopLossPct: 20,
  maxHoldMs: 6 * 60 * 60 * 1000, // 6 hours

  // Simulated execution costs
  dexFeePct: 0.3,
  priceImpactCoefficient: 0.5, // impact% ≈ (tradeSize / liquidity) * coefficient * 100

  dataFile: new URL("../data/portfolio.json", import.meta.url).pathname,
  tradeLogFile: new URL("../data/trades.json", import.meta.url).pathname,
};
