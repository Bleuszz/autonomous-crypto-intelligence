import { getSql, type Sql } from "@/lib/db";
import { num0 } from "./math.ts";
import { CAPITAL_SCALES_GBP, classifyCapitalSensitivity, summariseScale, type ScaleReport } from "./capital.ts";
import { pound100Gate } from "./learning/capital-gate.ts";
import { diversityReport, type TrainingExperience } from "./learning/experiences.ts";
import { detectContamination } from "./learning/splits.ts";
import { survivorshipNote, type AssetLifecycleState } from "./learning/survivorship.ts";
import { fetchKrakenOhlc } from "./sources.ts";
import { fetchGbpUsd } from "./fx.ts";
import { framesFromCandles, runReplayTraining } from "./replay.ts";
import {
  persistCounterfactual,
  persistDecay,
  persistReplayRun,
  persistScaleRun,
  persistTrainingExperience,
} from "./learning/jobs.ts";
import { informationDecay, inferReaction } from "./learning/decay.ts";

export type TrainingDashboard = {
  generatedAt: string;
  capital: {
    profile: string;
    researchEquityGbp: number;
    realisticEquityGbp: number;
    gbpUsd: number | null;
    gbpUsdObservedAt: string | null;
    paperStartingUsd: number | null;
    fxStatus: string;
  };
  quality: {
    samples: number;
    avgScore: number | null;
    conflictRate: number;
    delayedRate: number;
    staleRate: number;
    fakeMoveRate: number;
    blockRate: number;
    missingRate: number;
    latest: Array<{
      assetId: string;
      symbol: string;
      score: number;
      sourceConflict: boolean;
      delayed: boolean;
      fakeMoveSuspected: boolean;
      blockEntry: boolean;
      flags: string[];
      observedAt: string;
    }>;
  };
  decisions: {
    enter: number;
    wait: number;
    reject: number;
    exit: number;
  };
  experiences: ReturnType<typeof diversityReport> & { train: number; validation: number; oos: number; walkForward: number };
  contamination: { ok: boolean; reason: string };
  survivorship: { states: Record<string, number>; note: string };
  scale: {
    reports: ScaleReport[];
    classification: string;
    classificationReason: string;
    gate: ReturnType<typeof pound100Gate>;
  };
  clusters: { n: number; multiSource: number };
  decay: { samples: number; avgRemainingEdge: number | null };
  latency: {
    detectionMs: number | null;
    analysisMs: number | null;
    reactionMs: number | null;
  };
  calibration: {
    samples: number;
    avgReward: number | null;
    notes: string;
  };
  replay: { lastNotes: string | null; lookaheadFailures: number };
  honesty: string[];
};

function jsonArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const p = JSON.parse(String(v ?? "[]"));
    return Array.isArray(p) ? p.map(String) : [];
  } catch {
    return [];
  }
}

export async function getTrainingDashboard(): Promise<TrainingDashboard> {
  const sql = await getSql();
  const honesty: string[] = [
    "£100,000 is a research laboratory, not a prediction of real capital.",
    "The realistic deployment assumption is approximately £100.",
    "Live execution remains compiled out.",
  ];

  const fxRows = await sql.query<{ rate: number; observed_at: string }>(
    `select rate, observed_at from fx_quotes where pair = 'GBPUSD' order by observed_at desc limit 1`,
  ).catch(() => [] as Array<{ rate: number; observed_at: string }>);
  const port = await sql.query<{ starting_equity_usd: number; capital_profile: string | null; starting_equity_gbp: number | null }>(
    `select starting_equity_usd, capital_profile, starting_equity_gbp from paper_portfolios where id = 'paper-default'`,
  ).catch(() => [] as Array<{ starting_equity_usd: number; capital_profile: string | null; starting_equity_gbp: number | null }>);

  const gbpUsd = fxRows[0]?.rate ?? null;
  if (gbpUsd == null) honesty.push("DATA UNAVAILABLE: GBPUSD — paper book has not been rescaled from the seed until a live FX print arrives.");

  const qRows = await sql.query<Record<string, unknown>>(
    `select * from asset_data_quality order by observed_at desc limit 80`,
  ).catch(() => [] as Record<string, unknown>[]);
  const avgScore = qRows.length ? qRows.reduce((a, r) => a + num0(r.score), 0) / qRows.length : null;

  const snapRows = await sql.query<{ decision: string; n: number }>(
    `select decision, count(*)::int as n from trade_decision_snapshots group by decision`,
  ).catch(() => [] as Array<{ decision: string; n: number }>);
  const decisions = { enter: 0, wait: 0, reject: 0, exit: 0 };
  for (const r of snapRows) {
    const k = String(r.decision).toLowerCase();
    if (k === "enter") decisions.enter = num0(r.n);
    else if (k === "wait") decisions.wait = num0(r.n);
    else if (k === "reject") decisions.reject = num0(r.n);
    else if (k === "exit") decisions.exit = num0(r.n);
  }

  const expRows = await sql.query<Record<string, unknown>>(
    `select * from training_experiences order by decision_timestamp desc limit 500`,
  ).catch(() => [] as Record<string, unknown>[]);
  const experiences: TrainingExperience[] = expRows.map((r) => ({
    id: String(r.id),
    capitalProfile: r.capital_profile === "realistic" ? "realistic" : "research",
    startingEquityGbp: num0(r.starting_equity_gbp),
    availableEquityGbp: num0(r.available_equity_gbp),
    positionSizeGbp: r.position_size_gbp == null ? null : num0(r.position_size_gbp),
    portfolioExposurePct: num0(r.portfolio_exposure_pct),
    capitalUtilisationPct: num0(r.capital_utilisation_pct),
    regime: String(r.regime ?? "unknown"),
    asset: String(r.asset ?? ""),
    assetClass: String(r.asset_class ?? ""),
    marketStructure: String(r.market_structure ?? ""),
    signalType: String(r.signal_type ?? ""),
    dataQuality: num0(r.data_quality),
    sourceConflict: Boolean(r.source_conflict),
    eventClusterId: r.event_cluster_id ? String(r.event_cluster_id) : null,
    decisionTimestamp: String(r.decision_timestamp),
    latestMarketDataTimestamp: r.latest_market_data_timestamp ? String(r.latest_market_data_timestamp) : null,
    latestNewsTimestamp: r.latest_news_timestamp ? String(r.latest_news_timestamp) : null,
    latestSocialTimestamp: r.latest_social_timestamp ? String(r.latest_social_timestamp) : null,
    latestEventTimestamp: r.latest_event_timestamp ? String(r.latest_event_timestamp) : null,
    analysisTimestamp: String(r.analysis_timestamp ?? r.decision_timestamp),
    decision: String(r.decision) as TrainingExperience["decision"],
    confidence: r.confidence == null ? null : num0(r.confidence),
    executableAt100: Boolean(r.executable_at_100),
    minimumRequiredCapitalGbp: r.minimum_required_capital_gbp == null ? null : num0(r.minimum_required_capital_gbp),
    capitalSensitivity: (r.capital_sensitivity as TrainingExperience["capitalSensitivity"]) ?? "UNKNOWN",
    outcome: String(r.outcome ?? ""),
    reward: r.reward == null ? null : num0(r.reward),
    learningWeight: num0(r.learning_weight) || 1,
    split: (r.split as TrainingExperience["split"]) ?? "TRAINING",
    usedForTraining: Boolean(r.used_for_training),
    correlationGroup: r.correlation_group ? String(r.correlation_group) : null,
    lookaheadClean: r.lookahead_clean !== false,
    negativeExample: Boolean(r.negative_example),
    historicalReplay: Boolean(r.historical_replay),
    assetState: (r.asset_state as TrainingExperience["assetState"]) ?? "ACTIVE",
  }));
  const div = diversityReport(experiences);
  const splitMap = new Map<string, TrainingExperience["split"][]>();
  for (const e of experiences) {
    const cur = splitMap.get(e.id) ?? [];
    cur.push(e.split);
    splitMap.set(e.id, cur);
  }
  const contamination = detectContamination(splitMap);

  const lifeRows = await sql.query<{ state: string; n: number }>(
    `select state, count(*)::int as n from asset_lifecycle group by state`,
  ).catch(() => [] as Array<{ state: string; n: number }>);
  const states: Record<string, number> = {};
  const stateList: AssetLifecycleState[] = [];
  for (const r of lifeRows) {
    states[r.state] = num0(r.n);
    for (let i = 0; i < num0(r.n); i++) stateList.push(r.state as AssetLifecycleState);
  }

  const scaleRows = await sql.query<Record<string, unknown>>(
    `select equity_gbp, metrics from capital_scale_runs order by created_at desc limit 20`,
  ).catch(() => [] as Record<string, unknown>[]);
  let reports: ScaleReport[] = scaleRows.map((r) => {
    const m = typeof r.metrics === "string" ? JSON.parse(String(r.metrics)) : r.metrics;
    return { ...(m as ScaleReport), equityGbp: num0(r.equity_gbp) };
  });
  if (!reports.length) {
    reports = CAPITAL_SCALES_GBP.map((g) => summariseScale(g, []));
    honesty.push("INSUFFICIENT EVIDENCE: no capital-scale runs stored yet. Ladder shown as empty placeholders.");
  }
  const cls = classifyCapitalSensitivity(reports);
  const gate = pound100Gate(reports);

  const clus = await sql.query<{ n: number; multi: number }>(
    `select count(*)::int as n, count(*) filter (where independent_source_count > 1)::int as multi from event_clusters`,
  ).catch(() => [] as Array<{ n: number; multi: number }>);
  const decay = await sql.query<{ n: number; avg: number | null; det: number | null; ana: number | null; rea: number | null }>(
    `select count(*)::int as n, avg(remaining_edge_fraction) as avg, avg(detection_latency_ms) as det, avg(analysis_latency_ms) as ana, avg(reaction_latency_ms) as rea from information_decay`,
  ).catch(() => [] as Array<{ n: number; avg: number | null; det: number | null; ana: number | null; rea: number | null }>);
  const replay = await sql.query<{ notes: string | null; lookahead_failures: number }>(
    `select notes, lookahead_failures from replay_runs order by created_at desc limit 1`,
  ).catch(() => [] as Array<{ notes: string | null; lookahead_failures: number }>);

  const rewarded = experiences.filter((e) => e.reward != null);
  const calibration = {
    samples: rewarded.length,
    avgReward: rewarded.length ? rewarded.reduce((a, e) => a + (e.reward ?? 0), 0) / rewarded.length : null,
    notes: rewarded.length < 8 ? "INSUFFICIENT EVIDENCE to claim calibration." : "Average realised training reward (not a profitability claim).",
  };

  if (div.total === 0) honesty.push("INSUFFICIENT EVIDENCE: training_experiences is empty until paper decisions or historical replay accumulate.");
  if (!qRows.length) honesty.push("INSUFFICIENT EVIDENCE: data-quality samples appear after the next ingest.");

  const missingRate = qRows.length ? qRows.filter((r) => jsonArr(r.flags).includes("missing_price")).length / qRows.length : 0;

  return {
    generatedAt: new Date().toISOString(),
    capital: {
      profile: port[0]?.capital_profile ?? "research",
      researchEquityGbp: 100_000,
      realisticEquityGbp: 100,
      gbpUsd: gbpUsd,
      gbpUsdObservedAt: fxRows[0]?.observed_at ?? null,
      paperStartingUsd: port[0] ? num0(port[0].starting_equity_usd) : null,
      fxStatus: gbpUsd != null ? "live" : "DATA UNAVAILABLE",
    },
    quality: {
      samples: qRows.length,
      avgScore,
      conflictRate: qRows.length ? qRows.filter((r) => r.source_conflict).length / qRows.length : 0,
      delayedRate: qRows.length ? qRows.filter((r) => r.delayed).length / qRows.length : 0,
      staleRate: qRows.length ? qRows.filter((r) => r.stale).length / qRows.length : 0,
      fakeMoveRate: qRows.length ? qRows.filter((r) => r.fake_move_suspected).length / qRows.length : 0,
      blockRate: qRows.length ? qRows.filter((r) => r.block_entry).length / qRows.length : 0,
      missingRate,
      latest: qRows.slice(0, 20).map((r) => ({
        assetId: String(r.asset_id),
        symbol: String(r.symbol),
        score: num0(r.score),
        sourceConflict: Boolean(r.source_conflict),
        delayed: Boolean(r.delayed),
        fakeMoveSuspected: Boolean(r.fake_move_suspected),
        blockEntry: Boolean(r.block_entry),
        flags: jsonArr(r.flags),
        observedAt: String(r.observed_at),
      })),
    },
    decisions,
    experiences: {
      ...div,
      train: experiences.filter((e) => e.split === "TRAINING").length,
      validation: experiences.filter((e) => e.split === "VALIDATION").length,
      oos: experiences.filter((e) => e.split === "OOS").length,
      walkForward: experiences.filter((e) => e.split === "WALK_FORWARD").length,
    },
    contamination,
    survivorship: { states, note: survivorshipNote(stateList) },
    scale: {
      reports,
      classification: cls.classification,
      classificationReason: cls.reason,
      gate,
    },
    clusters: { n: num0(clus[0]?.n), multiSource: num0(clus[0]?.multi) },
    decay: { samples: num0(decay[0]?.n), avgRemainingEdge: decay[0]?.avg == null ? null : num0(decay[0]?.avg) },
    latency: {
      detectionMs: decay[0]?.det == null ? null : num0(decay[0]?.det),
      analysisMs: decay[0]?.ana == null ? null : num0(decay[0]?.ana),
      reactionMs: decay[0]?.rea == null ? null : num0(decay[0]?.rea),
    },
    calibration,
    replay: {
      lastNotes: replay[0]?.notes ?? null,
      lookaheadFailures: num0(replay[0]?.lookahead_failures),
    },
    honesty,
  };
}

const REPLAY_THROTTLE_MS = 6 * 3600_000;

/**
 * Historical replay is the training loop. Fetches public Kraken daily OHLC
 * (never invents candles). Point-in-time frames, settle with later prices only,
 * persist experiences / counterfactuals / capital-scale ladder / replay run.
 * Throttled so ingest does not hang.
 */
export async function runTrainingJobs(sql: Sql): Promise<{ ran: boolean; notes: string }> {
  const last = await sql.query<{ created_at: string }>(
    `select created_at from replay_runs order by created_at desc limit 1`,
  ).catch(() => [] as Array<{ created_at: string }>);
  if (last[0] && Date.now() - Date.parse(String(last[0].created_at)) < REPLAY_THROTTLE_MS) {
    return { ran: false, notes: "throttled" };
  }

  const [btc, eth] = await Promise.all([
    fetchKrakenOhlc("XBTUSD", 1440),
    fetchKrakenOhlc("ETHUSD", 1440),
  ]);
  const series = [
    { assetId: "cg:bitcoin", symbol: "BTC", kind: "major" as const, liquidityUsd: 5_000_000_000, candles: btc.candles.slice(-180) },
    { assetId: "cg:ethereum", symbol: "ETH", kind: "major" as const, liquidityUsd: 2_000_000_000, candles: eth.candles.slice(-180) },
  ].filter((s) => s.candles.length >= 30);
  if (!series.length) {
    return { ran: false, notes: "DATA UNAVAILABLE: Kraken OHLC" };
  }

  const newsRows = await sql.query<{ title: string; published_at: string | null }>(
    `select title, published_at from news_articles where published_at is not null order by published_at desc limit 40`,
  ).catch(() => [] as Array<{ title: string; published_at: string | null }>);
  const news = newsRows
    .map((n) => ({ publishedAt: Date.parse(String(n.published_at)), title: n.title }))
    .filter((n) => Number.isFinite(n.publishedAt));

  const fx = await fetchGbpUsd();
  const frames = framesFromCandles({ series, news });
  const trained = runReplayTraining({
    frames,
    delayMs: 0,
    capitalProfile: "research",
    fx: fx.quote,
  });

  await persistReplayRun(sql, trained.replay, 0, "research");
  for (const exp of trained.experiences.slice(0, 400)) {
    await persistTrainingExperience(sql, exp);
  }
  for (const cf of trained.counterfactuals.slice(0, 800)) {
    await persistCounterfactual(sql, cf.experienceId, cf.outcome);
  }
  for (const report of trained.scaleReports) {
    await persistScaleRun(sql, report, trained.classification.classification);
  }

  const delayed = runReplayTraining({
    frames,
    delayMs: 6 * 3600_000,
    capitalProfile: "research",
    fx: fx.quote,
  });
  await persistReplayRun(sql, delayed.replay, 6 * 3600_000, "research");

  return {
    ran: true,
    notes: `${trained.notes} Experiences ${trained.experiences.length}. Dropped lookahead ${trained.droppedLookahead}. ${trained.classification.reason}`,
  };
}

export async function persistEventDecayFromNews(
  sql: Sql,
  events: Array<{ id: string; publishedAt: string | null; observedAt: string; clusterId?: string | null }>,
  path: Array<{ t: number; px: number }>,
): Promise<void> {
  for (const ev of events.slice(0, 20)) {
    const published = ev.publishedAt ? Date.parse(ev.publishedAt) : Date.parse(ev.observedAt);
    const detected = Date.parse(ev.observedAt);
    if (!Number.isFinite(published) || !Number.isFinite(detected)) continue;
    const reaction = inferReaction({ publishedAt: published, path });
    const pxAt = (t: number) => {
      const hit = path.find((p) => p.t >= t);
      return hit?.px ?? null;
    };
    const report = informationDecay({
      publishedAt: published,
      detectedAt: detected,
      analysisAt: detected,
      marketReactionStart: reaction.start,
      marketReactionPeak: reaction.peak,
      priceAtPublish: pxAt(published),
      priceAtDetect: pxAt(detected),
      priceAtPeak: reaction.peak != null ? pxAt(reaction.peak) : null,
      falsePositive: reaction.falsePositive,
    });
    await persistDecay(sql, { eventId: ev.id, clusterId: ev.clusterId ?? null, report });
  }
}
