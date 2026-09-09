import { SCORE_WEIGHTS } from "./config.ts";
import { clamp, logScale01, num0, tanh01 } from "./math.ts";
import type { AssetRow, RankedOpportunity, ScoreComponents } from "./types.ts";

export type FeatureInput = {
  asset: AssetRow;
  rugRisk: number;
  riskReasons: string[];
  smartMoney: number;
  social: number;
  news: number;
  sourceReliability?: number;
  washHint?: boolean;
};

export function volumeLiquidityRatio(volume: number, liquidity: number): number {
  if (liquidity <= 0) return 0;
  return volume / liquidity;
}

export function marketQuality(asset: AssetRow): number {
  const liq = num0(asset.liquidityUsd);
  const mcap = num0(asset.marketCapUsd) || num0(asset.fdvUsd);
  const vol = num0(asset.volume24hUsd);
  const hasIdentity = asset.coingeckoId ? 0.25 : 0;
  const hasImage = asset.imageUrl ? 0.05 : 0;
  const liqScore = logScale01(liq, 4, 7);
  const mcapScore = logScale01(mcap, 6, 10) * 0.5;
  const volScore = logScale01(vol, 4, 8) * 0.4;
  const stableHaircut = asset.kind === "stable" ? 0.35 : 1;
  return clamp((0.35 + hasIdentity + hasImage + liqScore * 0.4 + mcapScore + volScore) * stableHaircut, 0, 1);
}

export function momentumScore(asset: AssetRow): number {
  const h1 = num0(asset.change1hPct);
  const d1 = num0(asset.change24hPct);
  const d7 = num0(asset.change7dPct);
  // Reward acceleration, not a 7d dump bounce alone.
  const accel = h1 - d1 / 24;
  const core = 0.45 * tanh01(h1 / 6) + 0.35 * tanh01(d1 / 18) + 0.2 * tanh01(accel / 4);
  const overheat = d1 > 80 ? 0.25 : d1 > 40 ? 0.1 : 0;
  // If the 7d trend is strongly down, a 24h bounce is more likely mean-reversion than momentum.
  const extendedDump = d7 < -30 && d1 < 0 ? 0.12 : 0;
  const wreck = d1 < -35 ? 0.2 : 0;
  return clamp(core - overheat - extendedDump - wreck, 0, 1);
}

export function volumeAnomalyScore(asset: AssetRow): number {
  const vol = num0(asset.volume24hUsd);
  const liq = num0(asset.liquidityUsd);
  const mcap = num0(asset.marketCapUsd) || num0(asset.fdvUsd) || liq * 8;
  const ratio = volumeLiquidityRatio(vol, Math.max(liq, 1));
  const turnover = mcap > 0 ? vol / mcap : 0;
  // Healthy unusual: elevated but not cartoonish.
  const elevated = tanh01((ratio - 0.4) * 1.4);
  const wash = ratio > 18 || turnover > 2.5 ? 0.5 : ratio > 8 ? 0.2 : 0;
  return clamp(elevated - wash, 0, 1);
}

export function liquidityScore(asset: AssetRow): number {
  return logScale01(num0(asset.liquidityUsd) || num0(asset.volume24hUsd) * 0.25, 4, 7.2);
}

export function executionPenalty(asset: AssetRow): number {
  const liq = num0(asset.liquidityUsd);
  if (liq <= 0) return 0.55;
  if (liq < 15_000) return 0.5;
  if (liq < 40_000) return 0.32;
  if (liq < 100_000) return 0.16;
  if (liq < 400_000) return 0.06;
  return 0;
}

export function scoreOpportunity(input: FeatureInput, weights = SCORE_WEIGHTS): RankedOpportunity {
  const { asset } = input;
  const reliabilityDiscount = 1 - 0.5 * (1 - clamp(input.sourceReliability ?? 1, 0, 1));

  const components: ScoreComponents = {
    marketQuality: marketQuality(asset) * reliabilityDiscount,
    liquidity: liquidityScore(asset) * reliabilityDiscount,
    momentum: momentumScore(asset) * reliabilityDiscount,
    volumeAnomaly: volumeAnomalyScore(asset) * reliabilityDiscount,
    smartMoney: clamp(input.smartMoney, 0, 1),
    social: clamp(input.social, 0, 1),
    news: clamp(input.news, 0, 1),
    riskPenalty: clamp(input.rugRisk, 0, 1),
    executionPenalty: executionPenalty(asset),
  };

  const raw =
    weights.marketQuality * components.marketQuality +
    weights.liquidity * components.liquidity +
    weights.momentum * components.momentum +
    weights.volumeAnomaly * components.volumeAnomaly +
    weights.smartMoney * components.smartMoney +
    weights.social * components.social +
    weights.news * components.news;

  const score = clamp(raw - 0.55 * components.riskPenalty - 0.35 * components.executionPenalty, 0, 1);

  const reasons: string[] = [];
  if (components.liquidity > 0.55) reasons.push(`Liquidity ${Math.round(components.liquidity * 100)}`);
  else if (num0(asset.liquidityUsd) < 40_000) reasons.push("Thin book — execution uncertain");
  if (components.momentum > 0.62) reasons.push("Short-horizon momentum");
  if (components.volumeAnomaly > 0.55) reasons.push("Volume elevated vs liquidity");
  if (volumeLiquidityRatio(num0(asset.volume24hUsd), num0(asset.liquidityUsd) || 1) > 10) {
    reasons.push("Volume/liquidity stretched — possible wash");
  }
  if (components.news > 0.5) reasons.push("Linked news catalyst");
  if (components.social > 0.5) reasons.push("Social/trending attention");
  if (components.smartMoney > 0.5) reasons.push("Qualified wallet flow");
  if (asset.kind === "major") reasons.push("Established market");
  if (components.riskPenalty > 0.4) reasons.push("Risk flags present");
  if (!reasons.length) reasons.push("Insufficient confirmatory features");

  const confidence = clamp(
    0.25 +
      0.25 * components.marketQuality +
      0.2 * components.liquidity +
      0.15 * Math.max(components.news, components.smartMoney, components.momentum) -
      0.35 * components.riskPenalty -
      0.2 * components.executionPenalty,
    0.05,
    0.92,
  );

  return {
    asset,
    score,
    confidence,
    rugRisk: clamp(input.rugRisk, 0, 1),
    components,
    reasons,
    riskReasons: input.riskReasons,
  };
}

export function compareOpportunities(a: RankedOpportunity, b: RankedOpportunity): number {
  return b.score - a.score;
}
