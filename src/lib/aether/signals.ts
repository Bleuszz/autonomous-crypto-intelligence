import type { RankedOpportunity, NewsDTO, PolymarketDTO, SocialDTO } from "./types";

export type GeneratedSignal = {
  strategyId: string;
  strategyVersion: string;
  assetId: string;
  side: "buy" | "sell";
  confidence: number;
  opportunityScore: number;
  entryMid: number | null;
  expectedHorizon: string;
  explanation: string[];
};

function numOr(n: number | null | undefined, d = 0) {
  return n == null || !Number.isFinite(n) ? d : n;
}

export function generateSignals(opts: {
  ranked: RankedOpportunity[];
  news: NewsDTO[];
  social: SocialDTO[];
  polymarket: PolymarketDTO[];
  trendingSymbols: Set<string>;
  walletHits: Map<string, number>;
}): GeneratedSignal[] {
  const out: GeneratedSignal[] = [];
  const bySymbol = new Map<string, RankedOpportunity[]>();
  for (const r of opts.ranked) {
    const k = r.asset.symbol.toUpperCase();
    const arr = bySymbol.get(k) ?? [];
    arr.push(r);
    bySymbol.set(k, arr);
  }

  for (const r of opts.ranked) {
    const a = r.asset;
    const px = a.priceUsd;
    const liq = numOr(a.liquidityUsd);
    const mom = r.components.momentum;
    const volA = r.components.volumeAnomaly;

    if (
      a.kind !== "stable" &&
      liq >= 75_000 &&
      r.rugRisk < 0.55 &&
      mom >= 0.58 &&
      volA >= 0.35 &&
      r.confidence >= 0.58
    ) {
      out.push({
        strategyId: "momentum_v1",
        strategyVersion: "1.0.0",
        assetId: a.id,
        side: "buy",
        confidence: r.confidence,
        opportunityScore: r.score,
        entryMid: px,
        expectedHorizon: "hours",
        explanation: [
          `Momentum ${mom.toFixed(2)} with volume anomaly ${volA.toFixed(2)}`,
          `Liquidity ${Math.round(liq).toLocaleString()} USD`,
          ...r.reasons.slice(0, 3),
        ],
      });
    }

    const ageH = a.pairCreatedAt ? (Date.now() - new Date(a.pairCreatedAt).getTime()) / 3_600_000 : null;
    if (
      a.kind === "dex" &&
      ageH != null &&
      ageH < 72 &&
      liq >= 40_000 &&
      r.rugRisk < 0.45 &&
      r.confidence >= 0.6
    ) {
      out.push({
        strategyId: "discovery_liquidity_v1",
        strategyVersion: "1.0.0",
        assetId: a.id,
        side: "buy",
        confidence: Math.min(r.confidence, 0.78),
        opportunityScore: r.score,
        entryMid: px,
        expectedHorizon: "hours",
        explanation: [
          `Pool age ~${ageH.toFixed(1)}h`,
          `Liquidity ${Math.round(liq).toLocaleString()} USD`,
          `Rug-risk score ${r.rugRisk.toFixed(2)} (probabilistic, not a safety certificate)`,
        ],
      });
    }

    const hits = opts.walletHits.get(a.id) ?? 0;
    if (hits >= 2 && liq >= 100_000 && r.rugRisk < 0.5 && r.confidence >= 0.55) {
      out.push({
        strategyId: "smart_money_follow_v1",
        strategyVersion: "1.0.0",
        assetId: a.id,
        side: "buy",
        confidence: Math.min(0.74, 0.5 + hits * 0.06),
        opportunityScore: r.score,
        entryMid: px,
        expectedHorizon: "days",
        explanation: [
          `${hits} qualified-wallet prints on this pool (not assumed smart money)`,
          "Copy execution would be delayed vs the observed print",
        ],
      });
    }

    if (opts.trendingSymbols.has(a.symbol.toUpperCase()) && r.components.social >= 0.45 && liq >= 50_000) {
      out.push({
        strategyId: "social_proxy_v1",
        strategyVersion: "1.0.0",
        assetId: a.id,
        side: "buy",
        confidence: Math.min(0.7, 0.48 + r.components.social * 0.25),
        opportunityScore: r.score,
        entryMid: px,
        expectedHorizon: "hours",
        explanation: [
          "Appears on trending-search / mention proxy (not the X firehose)",
          "Social posts are not treated as true",
        ],
      });
    }
  }

  for (const n of opts.news) {
    if (n.freshness !== "NEW" && n.freshness !== "RECENT") continue;
    for (const ent of n.entities) {
      const matches = bySymbol.get(ent) ?? [];
      for (const r of matches.slice(0, 2)) {
        if (numOr(r.asset.liquidityUsd) < 80_000) continue;
        const conf = Math.min(0.8, 0.5 + n.sourceReliability * 0.2 + (n.freshness === "NEW" ? 0.12 : 0.04));
        out.push({
          strategyId: "news_reaction_v1",
          strategyVersion: "1.0.0",
          assetId: r.asset.id,
          side: "buy",
          confidence: conf,
          opportunityScore: r.score,
          entryMid: r.asset.priceUsd,
          expectedHorizon: "hours",
          explanation: [
            `${n.freshness} ${n.source}: ${n.title}`,
            `Entity ${ent} linked by ticker/name match — not a confirmed causal claim`,
          ],
        });
      }
    }
  }

  const movers = opts.polymarket.filter((m) => m.probabilityChange24h != null && Math.abs(m.probabilityChange24h) >= 0.06);
  if (movers.length) {
    const btc = opts.ranked.find((r) => r.asset.id === "cg:bitcoin" || r.asset.symbol === "BTC");
    const eth = opts.ranked.find((r) => r.asset.id === "cg:ethereum" || r.asset.symbol === "ETH");
    for (const target of [btc, eth]) {
      if (!target) continue;
      const m = movers[0]!;
      out.push({
        strategyId: "polymarket_macro_v1",
        strategyVersion: "1.0.0",
        assetId: target.asset.id,
        side: "buy",
        confidence: 0.55,
        opportunityScore: target.score,
        entryMid: target.asset.priceUsd,
        expectedHorizon: "days",
        explanation: [
          `Polymarket probability shift ${(m.probabilityChange24h! * 100).toFixed(1)}pp: ${m.question}`,
          "Coincidence with crypto beta is not causation",
        ],
      });
    }
  }

  const dedup = new Map<string, GeneratedSignal>();
  for (const s of out) {
    const k = `${s.strategyId}:${s.assetId}`;
    const prev = dedup.get(k);
    if (!prev || s.confidence > prev.confidence) dedup.set(k, s);
  }
  return [...dedup.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 40);
}
