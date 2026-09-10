import { createServerFn } from "@tanstack/react-start";
import {
  changeLearnerModeData,
  ensureIngested,
  getCopySignals,
  getDetectedEvents,
  getLearningDashboardData,
  getLearnerModeData,
  getNews,
  getOpportunities,
  getOverview,
  getPaper,
  getPolymarket,
  getScanner,
  getSocial,
  getStrategies,
  getSystem,
  getToken,
  getWallets,
  getXIntelligenceDashboard,
  listBacktests,
  placeManualPaperTrade,
  runBacktestJob,
  runTokenResearch,
  getTrainingDashboardData,
} from "./ingest";
import { assembleTradingIntelDashboard } from "./trading-intel/dashboard.ts";
import { assetsFromRanked } from "./trading-intel/from-ranked.ts";

export const fetchOverview = createServerFn({ method: "GET" }).handler(async () => {
  return getOverview();
});

export const refreshNow = createServerFn({ method: "POST" }).handler(async () => {
  return ensureIngested(true);
});

export const fetchOpportunities = createServerFn({ method: "GET" }).handler(async () => {
  return getOpportunities();
});

export const fetchScanner = createServerFn({ method: "GET" }).handler(async () => {
  return getScanner();
});

export const fetchNewsFeed = createServerFn({ method: "GET" }).handler(async () => {
  return getNews();
});

export const fetchSocialFeed = createServerFn({ method: "GET" }).handler(async () => {
  return getSocial();
});

export const fetchPolymarketFeed = createServerFn({ method: "GET" }).handler(async () => {
  return getPolymarket();
});

export const fetchWallets = createServerFn({ method: "GET" }).handler(async () => {
  return getWallets();
});

export const fetchDetectedEvents = createServerFn({ method: "GET" }).handler(async () => {
  return getDetectedEvents();
});

export const fetchCopySignals = createServerFn({ method: "GET" }).handler(async () => {
  return getCopySignals();
});

export const fetchPaper = createServerFn({ method: "GET" }).handler(async () => {
  return getPaper();
});

export const fetchSystem = createServerFn({ method: "GET" }).handler(async () => {
  return getSystem();
});

export const fetchStrategies = createServerFn({ method: "GET" }).handler(async () => {
  return getStrategies();
});

export const fetchToken = createServerFn({ method: "POST" })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    return getToken(data.id);
  });

export const postResearch = createServerFn({ method: "POST" })
  .validator((input: { assetId: string }) => input)
  .handler(async ({ data }) => {
    return runTokenResearch(data.assetId);
  });

export const postBacktest = createServerFn({ method: "POST" })
  .validator((input: { pair?: "XBTUSD" | "ETHUSD" }) => input)
  .handler(async ({ data }) => {
    return runBacktestJob(data.pair ?? "XBTUSD");
  });

export const fetchBacktests = createServerFn({ method: "GET" }).handler(async () => {
  return listBacktests();
});

export const fetchLearningDashboard = createServerFn({ method: "GET" }).handler(async () => {
  return getLearningDashboardData();
});

export const fetchLearnerMode = createServerFn({ method: "GET" }).handler(async () => {
  return getLearnerModeData();
});

export const postLearnerMode = createServerFn({ method: "POST" })
  .validator((input: { mode: "DISABLED" | "SHADOW" | "ACTIVE"; password: string }) => input)
  .handler(async ({ data }) => {
    return changeLearnerModeData(data);
  });

export const postPaperTrade = createServerFn({ method: "POST" })
  .validator((input: { assetId: string; side: "buy" | "sell"; notionalUsd: number }) => input)
  .handler(async ({ data }) => {
    return placeManualPaperTrade(data);
  });

export const fetchXIntelligence = createServerFn({ method: "GET" }).handler(async () => {
  return getXIntelligenceDashboard();
});

export const fetchTrainingDashboard = createServerFn({ method: "GET" }).handler(async () => {
  return getTrainingDashboardData();
});

export const fetchTradingIntelligence = createServerFn({ method: "GET" }).handler(async () => {
  const raw = await getOpportunities();
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { opportunities?: unknown[] }).opportunities)
      ? (raw as { opportunities: unknown[] }).opportunities
      : raw && typeof raw === "object" && Array.isArray((raw as { ranked?: unknown[] }).ranked)
        ? (raw as { ranked: unknown[] }).ranked
        : [];
  return assembleTradingIntelDashboard({ assets: assetsFromRanked(list as never[]) });
});
