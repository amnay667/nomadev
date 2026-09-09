import { config } from "./config.js";
import { log } from "./logger.js";

export interface SocialSignal {
  mentionsPerHour: number;
  sentiment: number; // -1 (bearish) to 1 (bullish)
}

const BULLISH_WORDS = [
  "moon",
  "bullish",
  "pump",
  "gem",
  "100x",
  "ape",
  "send it",
  "lfg",
  "buy",
  "breakout",
];
const BEARISH_WORDS = [
  "rug",
  "scam",
  "dump",
  "sell",
  "dead",
  "honeypot",
  "avoid",
  "exit",
];

let warnedMissingToken = false;
let disabledUntil = 0;

function scoreSentiment(texts: string[]): number {
  let bullish = 0;
  let bearish = 0;
  for (const text of texts) {
    const lower = text.toLowerCase();
    for (const word of BULLISH_WORDS) if (lower.includes(word)) bullish++;
    for (const word of BEARISH_WORDS) if (lower.includes(word)) bearish++;
  }
  if (bullish + bearish === 0) return 0;
  return (bullish - bearish) / (bullish + bearish);
}

/**
 * Mention velocity + lexicon sentiment from the official X API v2 recent
 * search. Requires the user's own bearer token (X_BEARER_TOKEN) — there is
 * no scraping fallback, since scraping X breaks its terms of service and
 * breaks constantly in practice. Returns null (feature treated as neutral)
 * whenever the signal isn't available, rather than failing the whole cycle.
 */
export async function fetchSocialSignal(
  symbol: string,
  tokenAddress: string,
): Promise<SocialSignal | null> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    if (!warnedMissingToken) {
      log(
        "X_BEARER_TOKEN not set — social/sentiment signal disabled (see README)",
      );
      warnedMissingToken = true;
    }
    return null;
  }

  if (Date.now() < disabledUntil) return null;

  try {
    const query = encodeURIComponent(
      `(${symbol} OR ${tokenAddress}) -is:retweet lang:en`,
    );
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${query}&max_results=${config.twitterMaxResults}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 429) {
      log("X API rate limited — disabling social signal for 15 minutes");
      disabledUntil = Date.now() + 15 * 60 * 1000;
      return null;
    }
    if (!res.ok) {
      log(`X API HTTP ${res.status} for ${symbol}`);
      return null;
    }

    const body = (await res.json()) as {
      data?: { text: string }[];
      meta?: { result_count?: number };
    };
    const tweets = body.data ?? [];
    const mentionsPerHour = tweets.length; // recent-search window is ~last hour of activity

    return {
      mentionsPerHour,
      sentiment: scoreSentiment(tweets.map((t) => t.text)),
    };
  } catch (err) {
    log(`X API error for ${symbol}: ${(err as Error).message}`);
    return null;
  }
}
