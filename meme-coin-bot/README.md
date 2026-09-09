# meme-coin-bot

A paper-trading bot for meme coins. It watches live pair data on Solana via the
[DexScreener](https://docs.dexscreener.com/api/reference) public API and trades
against a simulated wallet — no real funds, no wallet keys, no on-chain
transactions.

## How it works

Every poll cycle (`pollIntervalMs`, default 30s) the bot:

1. Fetches recently listed token profiles from DexScreener and looks up the
   most liquid pair for each.
2. **Exits** any open position whose price has hit take-profit, stop-loss, or
   max hold time.
3. **Enters** new candidates that pass the liquidity / volume / momentum
   filters, sized at a fixed USD amount per trade, up to a max number of
   concurrent positions.
4. Simulates a DEX fee and a price-impact penalty based on trade size vs. pool
   liquidity, so results aren't unrealistically clean.
5. Logs each fill and the current portfolio value to the console, and
   persists wallet + trade history to `data/portfolio.json` and
   `data/trades.json`.

## Run it

```bash
npm install
npm start        # or: npm run dev (auto-restarts on file change)
```

## Configuring the strategy

All knobs live in `src/config.ts`:

- `startingBalanceUsd` — simulated wallet size
- `minLiquidityUsd`, `minVolumeH1Usd`, `minPriceChangeH1Pct` — entry filters
- `positionSizeUsd`, `maxOpenPositions` — sizing/risk
- `takeProfitPct`, `stopLossPct`, `maxHoldMs` — exit rules
- `dexFeePct`, `priceImpactCoefficient` — simulated execution cost

## Notes

- This is paper trading only — it never touches a real wallet or sends
  transactions. There's nothing here to fund or authorize.
- Meme coin pools are thin and volatile; the price-impact model is a rough
  approximation, not a substitute for real slippage. Treat results as
  directional, not a guarantee of live performance.
- To reset the simulated wallet, delete `data/portfolio.json` and
  `data/trades.json`.
