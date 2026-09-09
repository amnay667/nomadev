import type { DexPair, TokenProfile } from "./types.js";

const BASE_URL = "https://api.dexscreener.com";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`DexScreener request failed (${res.status}): ${url}`);
  }
  return res.json() as Promise<T>;
}

/** Recently listed token profiles across all chains. */
export async function fetchLatestTokenProfiles(): Promise<TokenProfile[]> {
  const data = await getJson<TokenProfile[]>(
    `${BASE_URL}/token-profiles/latest/v1`,
  );
  return Array.isArray(data) ? data : [];
}

/** Fetch the most liquid pair for each of up to 30 token addresses. */
export async function fetchPairsForTokens(
  chainId: string,
  tokenAddresses: string[],
): Promise<Map<string, DexPair>> {
  const result = new Map<string, DexPair>();
  if (tokenAddresses.length === 0) return result;

  const data = await getJson<{ pairs: DexPair[] | null }>(
    `${BASE_URL}/latest/dex/tokens/${tokenAddresses.join(",")}`,
  );

  for (const pair of data.pairs ?? []) {
    if (pair.chainId !== chainId) continue;
    const existing = result.get(pair.baseToken.address);
    const liquidity = pair.liquidity?.usd ?? 0;
    if (!existing || liquidity > (existing.liquidity?.usd ?? 0)) {
      result.set(pair.baseToken.address, pair);
    }
  }
  return result;
}
