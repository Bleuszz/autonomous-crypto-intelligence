import { createServerFn } from "@tanstack/react-start";
import {
  ensureIngested,
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
  listBacktests,
  placeManualPaperTrade,
  runBacktestJob,
  runTokenResearch,
  setKillSwitch,
} from "./ingest";

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

export const postKillSwitch = createServerFn({ method: "POST" })
  .validator((input: { on: boolean }) => input)
  .handler(async ({ data }) => {
    await setKillSwitch(data.on);
    return { ok: true, on: data.on };
  });

export const postPaperTrade = createServerFn({ method: "POST" })
  .validator((input: { assetId: string; side: "buy" | "sell"; notionalUsd: number }) => input)
  .handler(async ({ data }) => {
    return placeManualPaperTrade(data);
  });
