try {
  process.loadEnvFile();
} catch {
  // no .env file — fine, config can also come from real env vars
}

export const config = {
  chainId: "solana",

  pollIntervalMs: 30_000,
  dashboardPort: Number(process.env.PORT ?? 3000),
  dashboardTradeHistoryLimit: 100,

  startingBalanceUsd: 1000,

  // Entry filters (aggressive: catch tokens earlier, on weaker signals)
  minLiquidityUsd: 8_000,
  minVolumeH1Usd: 4_000,
  minPriceChangeH1Pct: 3,

  // Position sizing / risk (aggressive: bigger bets, more of them at once)
  maxOpenPositions: 10,
  positionSizeUsd: 150,

  // Exit rules (aggressive: wider bands both ways, faster turnover)
  takeProfitPct: 70,
  stopLossPct: 30,
  maxHoldMs: 3 * 60 * 60 * 1000, // 3 hours

  // Simulated execution costs
  dexFeePct: 0.3,
  priceImpactCoefficient: 0.5, // impact% ≈ (tradeSize / liquidity) * coefficient * 100

  // On-chain safety (rug/mint/freeze/holder-concentration checks)
  maxTopHolderConcentrationPct: 40,

  // Social signal (requires X_BEARER_TOKEN; disabled without it)
  twitterMaxResults: 50,

  // Self-learning entry scoring. A freshly-initialized model has zero
  // weights and zero bias, so it scores every candidate at exactly 0.5
  // (sigmoid(0)) regardless of features — the threshold must be <= 0.5 or
  // the model can never make a first trade to learn from, and gets stuck
  // forever. Cold-start selectivity comes from the hard filters and safety
  // check; the model only starts discriminating once it has outcomes to
  // learn from.
  // (aggressive: lower bar to enter, more willingness to take chances)
  entryScoreThreshold: 0.45,
  learningRate: 0.05,
  // Chance to enter anyway on a sub-threshold score, so a run of losses
  // (which can push every weight negative at once — see evaluateEntry)
  // can't permanently stop the model from ever seeing another outcome.
  explorationRate: 0.25,
  normLiquidityUsd: 50_000,
  normVolumeH1Usd: 20_000,
  normPriceChangeH1Pct: 50,
  normSocialMentionsPerHour: 20,

  dataFile: new URL("../data/portfolio.json", import.meta.url).pathname,
  tradeLogFile: new URL("../data/trades.json", import.meta.url).pathname,
  modelFile: new URL("../data/model.json", import.meta.url).pathname,
};
