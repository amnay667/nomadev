# meme-coin-bot

A paper-trading bot for meme coins. It watches live pair data on Solana via
[DexScreener](https://docs.dexscreener.com/api/reference), runs the same
checks a meme-coin trader would run before aping in, and trades against a
simulated wallet — no real funds, no wallet keys, no on-chain transactions.

## How it works

Every poll cycle (`pollIntervalMs`, default 30s) the bot:

1. Fetches recently listed token profiles from DexScreener and looks up the
   most liquid pair for each.
2. **Exits** any open position whose price has hit take-profit, stop-loss, or
   max hold time.
3. For each new candidate that clears the liquidity/volume/momentum filters,
   runs:
   - **On-chain safety check** ([GoPlus Security API](https://gopluslabs.io/)):
     mint authority renounced, freeze authority renounced, top-10 holder
     concentration. Fails closed — if the check can't be reached, the token
     is skipped rather than let through.
   - **Social signal** (official X/Twitter API v2, optional): mention
     velocity and a keyword-based bullish/bearish sentiment score for the
     token's symbol and contract address.
4. Feeds every feature (liquidity, volume, momentum, safety, holder
   distribution, social velocity, social sentiment) into a small **online
   logistic-regression scorer**. It starts neutral and re-weights itself
   after every closed trade based on whether that trade was actually
   profitable — so the entry bar adapts to this bot's own track record
   instead of staying fixed. **Enters** when the score clears
   `entryScoreThreshold`, up to `maxOpenPositions`.
5. Simulates a DEX fee and a price-impact penalty based on trade size vs.
   pool liquidity, so results aren't unrealistically clean.
6. Logs each fill/skip and the current portfolio value, and persists wallet
   history (`data/portfolio.json`, `data/trades.json`) and the learned model
   weights (`data/model.json`).

## Run it

```bash
npm install
npm start        # or: npm run dev (auto-restarts on file change)
```

A dashboard also starts alongside the bot at **http://localhost:3000** (change
with the `PORT` env var). It shows current cash, realized/unrealized/total
P&L, open positions with live unrealized P&L per position, and full trade
history — refreshing every 5 seconds. In a GitHub Codespace, open the
"Ports" tab and click the forwarded 3000 link.

### Enabling the social signal (optional)

The bot reads Twitter **only** through the official X API v2 — there's no
scraping fallback, since scraping X breaks its terms of service and breaks
constantly in practice. Without a token this feature is simply disabled
(logged once) and every other part of the bot runs normally.

To enable it, get a bearer token from the [X developer
portal](https://developer.x.com/) and either export it or put it in a
`.env` file next to `package.json`:

```
X_BEARER_TOKEN=your-token-here
```

The free tier's read quota is very small (historically ~100 tweets/month) —
fine for trying it out, not for continuous polling. If you hit rate limits
the bot backs off social checks for 15 minutes and keeps trading on the
other signals.

## Configuring the strategy

All knobs live in `src/config.ts`:

- `startingBalanceUsd` — simulated wallet size
- `minLiquidityUsd`, `minVolumeH1Usd`, `minPriceChangeH1Pct` — hard entry filters (cheap, checked before any API calls)
- `maxTopHolderConcentrationPct` — rug-risk gate on the safety check
- `entryScoreThreshold`, `learningRate` — self-learning scorer
- `normLiquidityUsd`, `normVolumeH1Usd`, `normPriceChangeH1Pct`, `normSocialMentionsPerHour` — feature normalization scales
- `positionSizeUsd`, `maxOpenPositions` — sizing/risk
- `takeProfitPct`, `stopLossPct`, `maxHoldMs` — exit rules (fixed, not learned — entries adapt, risk controls don't)
- `dexFeePct`, `priceImpactCoefficient` — simulated execution cost

## Notes / honest limitations

- This is paper trading only — it never touches a real wallet or sends
  transactions. There's nothing here to fund or authorize.
- "Self-learning" means a real but simple online logistic-regression model
  trained on this bot's own closed trades. It is not a deep-learning system
  and it cannot learn anything from before it has enough closed trades to
  learn from — expect it to behave close to the hard filters alone for the
  first few dozen trades. It also explores: on a sub-threshold score it
  still enters some of the time (`explorationRate`), because otherwise a
  single early loss can push every weight negative at once and permanently
  stop the model from ever seeing another outcome to learn from.
- The Twitter sentiment score is a blunt keyword lexicon, not NLP — treat it
  as a rough mention-volume/tone signal, not ground truth.
- Meme coin pools are thin and volatile; the price-impact model is a rough
  approximation, not a substitute for real slippage. Treat results as
  directional, not a guarantee of live performance.
- The safety check catches the most common rug patterns (unrenounced
  mint/freeze authority, concentrated holders) but is not a guarantee — it's
  one more signal, same as a human trader checking RugCheck before buying.
- To reset the simulated wallet or the learned model, delete the relevant
  file(s) in `data/`.
