import { config } from "./config.js";
import type { DexPair, Position } from "./types.js";
import { buildFeatures, type Features } from "./features.js";
import { checkTokenSafety } from "./safety.js";
import { fetchSocialSignal } from "./twitter.js";
import type { ScoringModel } from "./model.js";

export interface EntryEvaluation {
  enter: boolean;
  score: number;
  features: Features;
  safetyReasons: string[];
}

function passesHardFilters(pair: DexPair): boolean {
  const liquidity = pair.liquidity?.usd ?? 0;
  const volumeH1 = pair.volume?.h1 ?? 0;
  const priceChangeH1 = pair.priceChange?.h1 ?? 0;

  return (
    liquidity >= config.minLiquidityUsd &&
    volumeH1 >= config.minVolumeH1Usd &&
    priceChangeH1 >= config.minPriceChangeH1Pct
  );
}

/**
 * Runs the full "tools a meme-coin trader uses" checklist for one
 * candidate: liquidity/volume/momentum, on-chain rug-safety, and social
 * mention/sentiment — then scores the result with the self-learning model.
 * Returns null for candidates that don't even clear the cheap filters, so
 * we skip the network calls (safety + Twitter) for obvious non-starters.
 */
export async function evaluateEntry(
  pair: DexPair,
  model: ScoringModel,
): Promise<EntryEvaluation | null> {
  if (!passesHardFilters(pair)) return null;

  const [safety, social] = await Promise.all([
    checkTokenSafety(pair.baseToken.address),
    fetchSocialSignal(pair.baseToken.symbol, pair.baseToken.address),
  ]);

  const features = buildFeatures(
    {
      liquidityUsd: pair.liquidity?.usd ?? 0,
      volumeH1Usd: pair.volume?.h1 ?? 0,
      priceChangeH1Pct: pair.priceChange?.h1 ?? 0,
      safetyScore: safety.score,
      holderConcentrationPct: safety.holderConcentrationPct,
      socialMentionsPerHour: social?.mentionsPerHour ?? null,
      socialSentiment: social?.sentiment ?? null,
    },
    {
      liquidityUsd: config.normLiquidityUsd,
      volumeH1Usd: config.normVolumeH1Usd,
      priceChangeH1Pct: config.normPriceChangeH1Pct,
      socialMentionsPerHour: config.normSocialMentionsPerHour,
    },
  );

  const score = model.score(features);

  return {
    enter: safety.safe && score >= config.entryScoreThreshold,
    score,
    features,
    safetyReasons: safety.reasons,
  };
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
