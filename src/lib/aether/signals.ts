import { newsSideForTitle } from "./engine";
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
  btcChange24h?: number | null;
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
    const liq = numOr(a.liquidityUsd) || numOr(a.volume24hUsd);
    const mom = r.components.momentum;
    const volA = r.components.volumeAnomaly;
    const h1 = numOr(a.change1hPct);
    const d24 = numOr(a.change24hPct);

    if (
      a.kind !== "stable" &&
      liq >= 75_000 &&
      r.rugRisk < 0.55 &&
      mom >= 0.52 &&
      volA >= 0.28 &&
      r.confidence >= 0.52 &&
      d24 < 35
    ) {
      out.push({
        strategyId: "momentum_v1",
        strategyVersion: "1.1.0",
        assetId: a.id,
        side: "buy",
        confidence: r.confidence,
        opportunityScore: r.score,
        entryMid: px,
        expectedHorizon: "hours",
        explanation: [
          `Momentum ${mom.toFixed(2)} with volume anomaly ${volA.toFixed(2)}`,
          `Liquidity/volume ${Math.round(liq).toLocaleString()} USD`,
          ...r.reasons.slice(0, 3),
        ],
      });
    }

    if (a.kind === "major" && d24 <= -1.8 && d24 >= -12 && h1 >= 0.1 && r.confidence >= 0.45) {
      out.push({
        strategyId: "major_dip_v2",
        strategyVersion: "2.0.0",
        assetId: a.id,
        side: "buy",
        confidence: Math.min(0.76, 0.5 + Math.min(0.15, -d24 / 60)),
        opportunityScore: r.score,
        entryMid: px,
        expectedHorizon: "hours",
        explanation: [`24h ${d24.toFixed(2)}% with 1h ${h1.toFixed(2)}% turn`, "Dip-buy on a listed major — not a bottom call"],
      });
    }

    const ageH = a.pairCreatedAt ? (Date.now() - new Date(a.pairCreatedAt).getTime()) / 3_600_000 : null;
    if (
      a.kind === "dex" &&
      ageH != null &&
      ageH < 72 &&
      liq >= 40_000 &&
      r.rugRisk < 0.45 &&
      r.confidence >= 0.58
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
          "Appears on trending-search / mention proxy — not treated as the X firehose, and not auto-traded",
          "Social posts are not treated as true",
        ],
      });
    }

    if (a.kind !== "stable" && h1 <= -2.4 && d24 > 6 && r.confidence >= 0.5) {
      out.push({
        strategyId: "momentum_fade_v2",
        strategyVersion: "2.0.0",
        assetId: a.id,
        side: "sell",
        confidence: 0.58,
        opportunityScore: r.score,
        entryMid: px,
        expectedHorizon: "hours",
        explanation: [`1h ${h1.toFixed(2)}% after 24h ${d24.toFixed(2)}% — fade, not a short inventory book`],
      });
    }
  }

  for (const n of opts.news) {
    if (n.freshness !== "NEW" && n.freshness !== "RECENT") continue;
    const sideHint = newsSideForTitle(n.title);
    for (const ent of n.entities) {
      const matches = bySymbol.get(ent) ?? [];
      for (const r of matches.slice(0, 2)) {
        if (numOr(r.asset.liquidityUsd) < 80_000 && numOr(r.asset.volume24hUsd) < 2_000_000) continue;
        const side = sideHint ?? "buy";
        const conf = Math.min(0.8, 0.5 + n.sourceReliability * 0.2 + (n.freshness === "NEW" ? 0.12 : 0.04));
        out.push({
          strategyId: "news_reaction_v1",
          strategyVersion: "1.1.0",
          assetId: r.asset.id,
          side,
          confidence: conf,
          opportunityScore: r.score,
          entryMid: r.asset.priceUsd,
          expectedHorizon: "hours",
          explanation: [
            `${n.freshness} ${n.source}: ${n.title}`,
            `Entity ${ent} linked by ticker/name match — not a confirmed causal claim`,
            side === "sell" ? "Headline tone treated as bearish — still not ground truth" : "Headline tone treated as catalyst",
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
        side: (m.probabilityChange24h ?? 0) < 0 ? "sell" : "buy",
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
    const k = `${s.strategyId}:${s.assetId}:${s.side}`;
    const prev = dedup.get(k);
    if (!prev || s.confidence > prev.confidence) dedup.set(k, s);
  }
  return [...dedup.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 48);
}
