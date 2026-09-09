import { config } from "./config.js";
import { fetchLatestTokenProfiles, fetchPairsForTokens } from "./dexscreener.js";
import { Portfolio } from "./portfolio.js";
import { shouldEnter, exitReason } from "./strategy.js";
import { log } from "./logger.js";
import type { DexPair } from "./types.js";

const portfolio = new Portfolio();

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function runCycle() {
  try {
    const heldAddresses = portfolio.state.positions.map((p) => p.tokenAddress);

    const profiles = await fetchLatestTokenProfiles();
    const candidateAddresses = profiles
      .filter((p) => p.chainId === config.chainId)
      .map((p) => p.tokenAddress);

    const allAddresses = Array.from(
      new Set([...heldAddresses, ...candidateAddresses]),
    );

    const pairsByToken = new Map<string, DexPair>();
    for (const batch of chunk(allAddresses, 30)) {
      const batchPairs = await fetchPairsForTokens(config.chainId, batch);
      for (const [address, pair] of batchPairs) pairsByToken.set(address, pair);
    }

    // Exits first, so a token that's both held and re-surfaced as a candidate
    // frees up a slot before we consider new entries.
    for (const position of [...portfolio.state.positions]) {
      const pair = pairsByToken.get(position.tokenAddress);
      if (!pair) continue;
      const price = Number(pair.priceUsd);
      const reason = exitReason(position, price);
      if (reason) {
        portfolio.sell(position, price, pair.liquidity?.usd ?? 0, reason);
        log(
          `SELL ${position.symbol} @ $${price.toFixed(6)} (${reason})`,
        );
      }
    }

    for (const address of candidateAddresses) {
      if (!portfolio.canOpenNewPosition()) break;
      if (portfolio.hasPosition(address)) continue;

      const pair = pairsByToken.get(address);
      if (!pair || !shouldEnter(pair)) continue;

      const price = Number(pair.priceUsd);
      portfolio.buy(
        address,
        pair.baseToken.symbol,
        price,
        pair.liquidity?.usd ?? 0,
        "momentum-entry",
      );
      log(`BUY ${pair.baseToken.symbol} @ $${price.toFixed(6)}`);
    }

    const currentPrices = new Map<string, number>();
    for (const [address, pair] of pairsByToken) {
      currentPrices.set(address, Number(pair.priceUsd));
    }
    const totalValue = portfolio.totalValueUsd(currentPrices);
    log(
      `Portfolio: $${totalValue.toFixed(2)} | cash: $${portfolio.state.cashUsd.toFixed(2)} | positions: ${portfolio.state.positions.length} | realized P&L: $${portfolio.state.realizedPnlUsd.toFixed(2)}`,
    );
  } catch (err) {
    log(`Cycle error: ${(err as Error).message}`);
  }
}

log(`Starting meme-coin-bot (paper trading, chain=${config.chainId})`);
runCycle();
setInterval(runCycle, config.pollIntervalMs);
