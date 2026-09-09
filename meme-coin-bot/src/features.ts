export const FEATURE_NAMES = [
  "liquidity",
  "volumeH1",
  "priceChangeH1",
  "safety",
  "holderDistribution",
  "socialVelocity",
  "socialSentiment",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];
export type Features = Record<FeatureName, number>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface BuildFeaturesInput {
  liquidityUsd: number;
  volumeH1Usd: number;
  priceChangeH1Pct: number;
  safetyScore: number;
  holderConcentrationPct: number | null;
  socialMentionsPerHour: number | null;
  socialSentiment: number | null;
}

export function buildFeatures(
  input: BuildFeaturesInput,
  norm: {
    liquidityUsd: number;
    volumeH1Usd: number;
    priceChangeH1Pct: number;
    socialMentionsPerHour: number;
  },
): Features {
  return {
    liquidity: clamp(input.liquidityUsd / norm.liquidityUsd, 0, 2),
    volumeH1: clamp(input.volumeH1Usd / norm.volumeH1Usd, 0, 2),
    priceChangeH1: clamp(input.priceChangeH1Pct / norm.priceChangeH1Pct, -2, 2),
    safety: input.safetyScore,
    holderDistribution:
      input.holderConcentrationPct === null
        ? 0.5
        : clamp(1 - input.holderConcentrationPct / 100, 0, 1),
    socialVelocity:
      input.socialMentionsPerHour === null
        ? 0
        : clamp(input.socialMentionsPerHour / norm.socialMentionsPerHour, 0, 2),
    socialSentiment: input.socialSentiment ?? 0,
  };
}
