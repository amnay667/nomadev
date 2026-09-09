import { config } from "./config.js";
import type { DexPair, Position } from "./types.js";

export function shouldEnter(pair: DexPair): boolean {
  const liquidity = pair.liquidity?.usd ?? 0;
  const volumeH1 = pair.volume?.h1 ?? 0;
  const priceChangeH1 = pair.priceChange?.h1 ?? 0;

  return (
    liquidity >= config.minLiquidityUsd &&
    volumeH1 >= config.minVolumeH1Usd &&
    priceChangeH1 >= config.minPriceChangeH1Pct
  );
}

export function exitReason(
  position: Position,
  currentPriceUsd: number,
): string | null {
  const changePct =
    ((currentPriceUsd - position.entryPriceUsd) / position.entryPriceUsd) * 100;

  if (changePct >= config.takeProfitPct) return "take-profit";
  if (changePct <= -config.stopLossPct) return "stop-loss";
  if (Date.now() - position.openedAt >= config.maxHoldMs) return "max-hold-time";
  return null;
}
