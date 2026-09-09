import { config } from "./config.js";
import { log } from "./logger.js";

export interface SafetyResult {
  safe: boolean;
  score: number; // 0-1, higher is safer
  holderConcentrationPct: number | null;
  reasons: string[];
}

interface GoPlusSolanaTokenSecurity {
  mintable?: { status?: string };
  freezable?: { status?: string };
  top_10_holder_rate?: string;
}

const UNKNOWN_RESULT: SafetyResult = {
  safe: false,
  score: 0,
  holderConcentrationPct: null,
  reasons: ["safety check unavailable"],
};

/**
 * Checks the token most real meme-coin traders run before aping in: can the
 * dev mint more supply, can they freeze holder accounts, and how
 * concentrated is ownership. Fails closed — if the check can't be reached,
 * the token is treated as unsafe rather than silently let through.
 */
export async function checkTokenSafety(
  tokenAddress: string,
): Promise<SafetyResult> {
  try {
    const url = `https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${tokenAddress}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      log(`Safety check HTTP ${res.status} for ${tokenAddress}`);
      return UNKNOWN_RESULT;
    }

    const body = (await res.json()) as {
      result?: Record<string, GoPlusSolanaTokenSecurity>;
    };
    const data = body.result?.[tokenAddress];
    if (!data) return UNKNOWN_RESULT;

    const reasons: string[] = [];
    const isMintable = data.mintable?.status === "1";
    const isFreezable = data.freezable?.status === "1";
    const holderConcentrationPct = data.top_10_holder_rate
      ? Number(data.top_10_holder_rate) * 100
      : null;

    if (isMintable) reasons.push("mint authority not renounced");
    if (isFreezable) reasons.push("freeze authority not renounced");
    if (
      holderConcentrationPct !== null &&
      holderConcentrationPct > config.maxTopHolderConcentrationPct
    ) {
      reasons.push(
        `top 10 holders own ${holderConcentrationPct.toFixed(1)}%`,
      );
    }

    const safe = reasons.length === 0;
    const score = safe ? 1 : Math.max(0, 1 - reasons.length * 0.4);

    return { safe, score, holderConcentrationPct, reasons };
  } catch (err) {
    log(`Safety check error for ${tokenAddress}: ${(err as Error).message}`);
    return UNKNOWN_RESULT;
  }
}
