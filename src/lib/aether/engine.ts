import { PAPER_ENGINE, PRICE_TRADE_STALE_MS, RISK_LIMITS } from "./config.ts";
import { clamp, mean } from "./math.ts";
import { positionSizeUsd } from "./paper.ts";
import type { RankedOpportunity, SignalDTO } from "./types.ts";

export type RegimeInput = {
  fearGreed: number | null;
  btcChange24h: number | null;
  ethChange24h: number | null;
  btcFundingPct: number | null;
  label: string;
  dxyChangePct?: number | null;
  spxChangePct?: number | null;
  mempoolFastSatVb?: number | null;
};

export type OpenPosition = {
  id: string;
  assetId: string;
  qty: number;
  avgPrice: number;
  openedAt: string;
  peakMark: number | null;
};

export type TradeIntent = {
  assetId: string;
  symbol: string;
  side: "buy" | "sell";
  strategyId: string;
  reason: string;
  confidence: number;
  /** 1 = full position, <1 = trim */
  fraction: number;
  explanation: string[];
};

export type SparkFeat = {
  last: number;
  first: number;
  mean: number;
  min: number;
  max: number;
  retShortPct: number;
  retLongPct: number;
  distFromHighPct: number;
  rising: boolean;
  falling: boolean;
};

export function sparkFeat(spark: number[] | null | undefined): SparkFeat | null {
  if (!spark || spark.length < 8) return null;
  const xs = spark.filter((n) => Number.isFinite(n) && n > 0);
  if (xs.length < 8) return null;
  const last = xs[xs.length - 1]!;
  const first = xs[0]!;
  const recent = xs.slice(-6);
  const prior = xs.slice(-12, -6);
  const hi = Math.max(...xs);
  const lo = Math.min(...xs);
  const retShort = prior.length ? ((mean(recent) - mean(prior)) / mean(prior)) * 100 : 0;
  const retLong = first ? ((last - first) / first) * 100 : 0;
  return {
    last,
    first,
    mean: mean(xs),
    min: lo,
    max: hi,
    retShortPct: retShort,
    retLongPct: retLong,
    distFromHighPct: hi ? ((hi - last) / hi) * 100 : 0,
    rising: retShort > 0.15,
    falling: retShort < -0.15,
  };
}

export function executableUsd(r: RankedOpportunity): number {
  const a = r.asset;
  if (a.kind === "major") {
    return Math.max(a.volume24hUsd ?? 0, a.liquidityUsd ?? 0, (a.marketCapUsd ?? 0) * 0.02);
  }
  return a.liquidityUsd ?? 0;
}

export function isFreshMark(r: RankedOpportunity, now = Date.now()): boolean {
  if (!(r.asset.priceUsd && r.asset.priceUsd > 0)) return false;
  const age =
    r.asset.dataAgeMs ??
    (r.asset.observedAt ? now - Date.parse(r.asset.observedAt) : null);
  if (age == null || !Number.isFinite(age)) return false; // unknown age is not fresh
  return age <= PRICE_TRADE_STALE_MS;
}

export function isQualityPaperEntry(r: RankedOpportunity, s: { strategyId: string; confidence: number }): boolean {
  if (s.strategyId === "social_proxy_v1") return false;
  if (r.asset.kind === "stable") return false;
  if (!(r.asset.priceUsd && r.asset.priceUsd > 0)) return false;
  if (!isFreshMark(r)) return false;
  if (r.dataQuality?.blockEntry) return false;
  if (r.dataQuality?.fakeMoveSuspected && (r.dataQuality.score ?? 100) < 60) return false;
  const d24 = Math.abs(r.asset.change24hPct ?? 0);
  if (r.asset.kind === "dex") {
    if (s.confidence < PAPER_ENGINE.minConfidenceDex) return false;
    if (r.rugRisk >= PAPER_ENGINE.maxDexRug) return false;
    if (d24 > PAPER_ENGINE.maxAbsChangeDex) return false;
    return executableUsd(r) >= PAPER_ENGINE.minDexLiqUsd;
  }
  if (s.confidence < PAPER_ENGINE.minConfidenceMajor) return false;
  if (d24 > PAPER_ENGINE.maxAbsChangeMajor) return false;
  if (r.rugRisk >= 0.5) return false;
  return executableUsd(r) >= PAPER_ENGINE.minMajorVolumeUsd;
}

function isMajorish(r: RankedOpportunity): boolean {
  return r.asset.kind === "major" || (r.asset.coingeckoId != null && (r.asset.marketCapUsd ?? 0) > 250_000_000);
}

export function stopPctFor(r: RankedOpportunity): number {
  return isMajorish(r) ? PAPER_ENGINE.majorStopPct : PAPER_ENGINE.dexStopPct;
}

export function takePctFor(r: RankedOpportunity): number {
  return isMajorish(r) ? PAPER_ENGINE.majorTakePct : PAPER_ENGINE.dexTakePct;
}

export function trailPctFor(r: RankedOpportunity): number {
  return isMajorish(r) ? PAPER_ENGINE.majorTrailPct : PAPER_ENGINE.dexTrailPct;
}

export function sizeUsd(opts: {
  equity: number;
  cash: number;
  confidence: number;
  r: RankedOpportunity;
  regime: RegimeInput;
}): number {
  const riskOff = (opts.regime.fearGreed ?? 50) < 28 || (opts.regime.btcChange24h ?? 0) < -4.5;
  const greedy = (opts.regime.fearGreed ?? 50) > 78;
  const dxyBid = (opts.regime.dxyChangePct ?? 0) >= 0.45;
  let maxPct = RISK_LIMITS.maxPositionPct;
  if (!isMajorish(opts.r)) maxPct *= 0.55;
  if (riskOff) maxPct *= isMajorish(opts.r) && /BTC|ETH/i.test(opts.r.asset.symbol) ? 0.7 : 0.35;
  if (greedy) maxPct *= 0.75;
  if (dxyBid && !/BTC|ETH/i.test(opts.r.asset.symbol)) maxPct *= 0.7;
  const raw = positionSizeUsd(
    opts.equity,
    opts.confidence,
    maxPct,
    executableUsd(opts.r),
    RISK_LIMITS.maxLiquidityTakePct,
  );
  const capCash = opts.cash * (1 - PAPER_ENGINE.minCashPct);
  return Math.max(0, Math.min(raw, capCash, opts.equity * maxPct));
}

function newsTone(title: string): "bull" | "bear" | "neutral" {
  const t = title.toLowerCase();
  if (/\b(hack|exploit|rug|insolvent|halted|delist|lawsuit|sec charges|outage|breach|liquidation cascade|banned)\b/.test(t)) {
    return "bear";
  }
  if (/\b(etf approved|spot etf|lists|listing|partnership|upgrade|mainnet|buyback|approved)\b/.test(t)) {
    return "bull";
  }
  return "neutral";
}

export function decideExits(opts: {
  positions: OpenPosition[];
  ranked: RankedOpportunity[];
  signals: SignalDTO[];
  regime: RegimeInput;
  now?: number;
}): TradeIntent[] {
  const now = opts.now ?? Date.now();
  const rankedById = new Map(opts.ranked.map((r) => [r.asset.id, r]));
  const sellSignals = new Set(
    opts.signals.filter((s) => s.side === "sell" && s.status === "open").map((s) => s.assetId),
  );
  const out: TradeIntent[] = [];

  for (const pos of opts.positions) {
    const r = rankedById.get(pos.assetId);
    const mark = r?.asset.priceUsd ?? pos.avgPrice;
    if (!(pos.qty > 0) || !(mark > 0) || !(pos.avgPrice > 0)) continue;
    const pnlPct = (mark - pos.avgPrice) / pos.avgPrice;
    const peak = Math.max(pos.peakMark ?? mark, mark, pos.avgPrice);
    const ddFromPeak = peak > 0 ? (peak - mark) / peak : 0;
    const opened = Date.parse(pos.openedAt);
    const ageH = Number.isFinite(opened) ? (now - opened) / 3_600_000 : 0;
    const h1 = r?.asset.change1hPct ?? 0;
    const d24 = r?.asset.change24hPct ?? 0;
    const spark = sparkFeat(r?.asset.sparkline7d ?? null);
    const symbol = r?.asset.symbol ?? pos.assetId;
    const stop = r ? stopPctFor(r) : PAPER_ENGINE.majorStopPct;
    const take = r ? takePctFor(r) : PAPER_ENGINE.majorTakePct;
    const trail = r ? trailPctFor(r) : PAPER_ENGINE.majorTrailPct;
    const isBtc = /bitcoin|btc/i.test(symbol) || pos.assetId === "cg:bitcoin";

    const push = (strategyId: string, reason: string, fraction = 1, confidence = 0.7) => {
      out.push({
        assetId: pos.assetId,
        symbol,
        side: "sell",
        strategyId,
        reason,
        confidence,
        fraction,
        explanation: [
          reason,
          `Mark ${mark} vs avg ${pos.avgPrice} (${(pnlPct * 100).toFixed(2)}%)`,
          `Held ${ageH.toFixed(1)}h · peak ${peak}`,
        ],
      });
    };

    if (pnlPct <= -stop) {
      push("exit_stop_v2", `Hard stop ${(stop * 100).toFixed(1)}% from entry`);
      continue;
    }
    if (pnlPct >= take) {
      push("exit_take_v2", `Take-profit ${(take * 100).toFixed(1)}% from entry`);
      continue;
    }
    if (pnlPct >= PAPER_ENGINE.trailArmPct && ddFromPeak >= trail) {
      push("exit_trail_v2", `Trailing stop ${(trail * 100).toFixed(1)}% off peak`);
      continue;
    }
    if (ageH >= PAPER_ENGINE.maxHoldHours) {
      push("exit_time_v2", `Max hold ${PAPER_ENGINE.maxHoldHours}h`);
      continue;
    }
    if (ageH >= PAPER_ENGINE.staleHoursCut && pnlPct < 0.004) {
      push("exit_stale_v2", "Position not working — time cut");
      continue;
    }
    if (sellSignals.has(pos.assetId)) {
      push("exit_signal_v2", "Open sell signal against this book", 1, 0.66);
      continue;
    }
    if ((opts.regime.btcChange24h ?? 0) <= -5 && !isBtc && pnlPct < 0.03 && !/ETH/i.test(symbol)) {
      push("exit_regime_v2", "BTC risk-off — cutting alt beta", 1, 0.62);
      continue;
    }
    if ((opts.regime.dxyChangePct ?? 0) >= 0.7 && !isBtc && pnlPct < 0.02 && !/ETH/i.test(symbol)) {
      push("exit_macro_v2", "DXY bid — cutting alt beta", 1, 0.6);
      continue;
    }
    if (h1 <= -2.2 && pnlPct < 0.01 && ageH >= 0.4) {
      push("exit_momentum_fail_v2", "1h reversal against a flat/losing long");
      continue;
    }
    if ((opts.regime.fearGreed ?? 50) >= 82 && pnlPct >= 0.035) {
      push("exit_greed_trim_v2", "Extreme greed — taking partial profit", 0.45, 0.6);
      continue;
    }
    if (spark?.falling && d24 > 12 && pnlPct > 0.02) {
      push("exit_fade_v2", "Sparkline rolling over after an extended move", 0.5, 0.58);
      continue;
    }
  }
  return out;
}

export function decideEntries(opts: {
  ranked: RankedOpportunity[];
  signals: SignalDTO[];
  held: Set<string>;
  regime: RegimeInput;
  openCount: number;
}): TradeIntent[] {
  const slots = Math.max(0, PAPER_ENGINE.maxOpenPositions - opts.openCount);
  if (slots <= 0) return [];
  const riskOff = (opts.regime.fearGreed ?? 50) < 28 || (opts.regime.btcChange24h ?? 0) < -4.5;
  const greedy = (opts.regime.fearGreed ?? 50) > 80;
  const btcChg = opts.regime.btcChange24h ?? 0;
  const dxyBid = (opts.regime.dxyChangePct ?? 0) >= 0.45;
  const spxDump = (opts.regime.spxChangePct ?? 0) <= -1.2;
  const congested = (opts.regime.mempoolFastSatVb ?? 0) >= 55;
  const macroOff = dxyBid && (btcChg < 0 || spxDump);
  const out: TradeIntent[] = [];
  const seen = new Set<string>();

  const consider = (r: RankedOpportunity, intent: Omit<TradeIntent, "assetId" | "symbol">) => {
    if (opts.held.has(r.asset.id) || seen.has(r.asset.id)) return;
    if (!isQualityPaperEntry(r, { strategyId: intent.strategyId, confidence: intent.confidence })) return;
    if ((riskOff || macroOff) && !isMajorish(r)) return;
    if (congested && r.asset.kind === "dex") return;
    if (greedy && !isMajorish(r) && (r.asset.change24hPct ?? 0) > 8) return;
    seen.add(r.asset.id);
    out.push({
      assetId: r.asset.id,
      symbol: r.asset.symbol,
      ...intent,
    });
  };

  const ranked = [...opts.ranked].sort((a, b) => b.score - a.score);

  // Stay in the tape: a small BTC/ETH core when the book is empty and the regime is not extreme.
  if (opts.openCount === 0 && !riskOff && !greedy) {
    const btc = ranked.find((r) => r.asset.id === "cg:bitcoin");
    const eth = ranked.find((r) => r.asset.id === "cg:ethereum");
    for (const r of [btc, eth]) {
      if (!r) continue;
      const d24 = Math.abs(r.asset.change24hPct ?? 99);
      if (d24 > 6) continue;
      consider(r, {
        side: "buy",
        strategyId: "core_beta_v2",
        reason: `Core ${r.asset.symbol} inventory on a mixed tape`,
        confidence: 0.58,
        fraction: 1,
        explanation: [
          "Empty book in a non-extreme regime — hold a liquid beta sleeve, not a directional call",
          `24h ${r.asset.change24hPct?.toFixed(2) ?? "n/a"}% · F&G ${opts.regime.fearGreed ?? "n/a"}`,
        ],
      });
    }
  }

  for (const r of ranked) {
    const a = r.asset;
    const h1 = a.change1hPct ?? 0;
    const d24 = a.change24hPct ?? 0;
    const d7 = a.change7dPct ?? 0;
    const spark = sparkFeat(a.sparkline7d);
    const mom = r.components.momentum;
    const volA = r.components.volumeAnomaly;
    const major = isMajorish(r);

    // Dip-buy liquid majors when the 1h is turning up.
    if (major && d24 <= -0.9 && d24 >= -9 && h1 >= 0.08 && (opts.regime.fearGreed ?? 50) <= 75) {
      consider(r, {
        side: "buy",
        strategyId: "major_dip_v2",
        reason: `Dip-buy: 24h ${d24.toFixed(1)}% with 1h turn ${h1.toFixed(2)}%`,
        confidence: clamp(0.52 + Math.min(0.12, -d24 / 80) + Math.min(0.08, h1 / 8), 0.5, 0.78),
        fraction: 1,
        explanation: [
          `24h ${d24.toFixed(2)}% / 1h ${h1.toFixed(2)}% on a listed major`,
          `F&G ${opts.regime.fearGreed ?? "n/a"} — not chasing a crash`,
          ...r.reasons.slice(0, 2),
        ],
      });
    }

    // Confirmed momentum (not a 80% meme candle).
    if (h1 >= 0.25 && d24 >= 0.8 && d24 <= 22 && mom >= 0.48 && volA >= 0.18 && d7 > -12) {
      consider(r, {
        side: "buy",
        strategyId: "momentum_v2",
        reason: `Momentum ${mom.toFixed(2)} with volume ${volA.toFixed(2)}`,
        confidence: clamp(r.confidence, 0.5, 0.84),
        fraction: 1,
        explanation: [
          `1h ${h1.toFixed(2)}% · 24h ${d24.toFixed(2)}%`,
          `Liquidity/volume ${Math.round(executableUsd(r)).toLocaleString()} USD proxy`,
          ...r.reasons.slice(0, 2),
        ],
      });
    }

    // Mean-revert oversold majors whose spark is lifting.
    if (major && d24 <= -6 && d24 >= -18 && (spark?.rising || h1 > 0.3) && (opts.regime.fearGreed ?? 50) <= 55) {
      consider(r, {
        side: "buy",
        strategyId: "mean_revert_v2",
        reason: `Oversold 24h ${d24.toFixed(1)}% with lifting tape`,
        confidence: 0.56,
        fraction: 1,
        explanation: [`Spark short-horizon ${spark?.retShortPct.toFixed(2) ?? "n/a"}%`, "Mean reversion is not a promise of a bounce"],
      });
    }

    // Breakout vs 7d spark high with contained 24h.
    if (spark && spark.distFromHighPct <= 1.2 && spark.retShortPct > 0.4 && d24 > 0 && d24 < 18 && volA >= 0.28) {
      consider(r, {
        side: "buy",
        strategyId: "breakout_v2",
        reason: "Holding 7d highs with rising short-horizon tape",
        confidence: clamp(0.5 + volA * 0.2, 0.5, 0.76),
        fraction: 1,
        explanation: [`Dist from 7d high ${spark.distFromHighPct.toFixed(2)}%`, ...r.reasons.slice(0, 2)],
      });
    }

    // Relative strength vs BTC.
    if (!/BTC/i.test(a.symbol) && d24 > btcChg + 2.8 && d24 > 1 && d24 < 20 && major && h1 > 0) {
      consider(r, {
        side: "buy",
        strategyId: "rel_strength_v2",
        reason: `Outperforming BTC by ${(d24 - btcChg).toFixed(1)}pp over 24h`,
        confidence: 0.55,
        fraction: 1,
        explanation: [`Asset 24h ${d24.toFixed(2)}% vs BTC ${btcChg.toFixed(2)}%`, "Relative strength can unwind quickly"],
      });
    }

    // Funding squeeze: very negative perp funding, buy BTC.
    if (a.id === "cg:bitcoin" && (opts.regime.btcFundingPct ?? 0) <= -0.015 && d24 > -8) {
      consider(r, {
        side: "buy",
        strategyId: "funding_squeeze_v2",
        reason: `Negative BTC funding ${opts.regime.btcFundingPct?.toFixed(3)}%`,
        confidence: 0.57,
        fraction: 1,
        explanation: ["Crowded shorts on perps — still a paper hypothesis, not a fill at the perp venue"],
      });
    }
  }

  // Consume high-quality open buy signals (not social proxy).
  const buys = opts.signals
    .filter((s) => s.side === "buy" && s.status === "open" && !opts.held.has(s.assetId))
    .sort((a, b) => b.confidence - a.confidence);
  for (const s of buys) {
    const r = ranked.find((x) => x.asset.id === s.assetId);
    if (!r) continue;
    consider(r, {
      side: "buy",
      strategyId: s.strategyId,
      reason: s.explanation[0] ?? s.strategyId,
      confidence: s.confidence,
      fraction: 1,
      explanation: s.explanation.slice(0, 4),
    });
  }

  return out.slice(0, Math.min(PAPER_ENGINE.maxNewPerCycle, slots));
}

export function newsSideForTitle(title: string): "buy" | "sell" | null {
  const tone = newsTone(title);
  if (tone === "bull") return "buy";
  if (tone === "bear") return "sell";
  return null;
}
