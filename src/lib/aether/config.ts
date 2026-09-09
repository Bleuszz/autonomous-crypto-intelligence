export const APP_NAME = "Aether";
export const APP_TAGLINE = "Crypto intelligence & paper trading";

export const DEFAULT_PORTFOLIO_ID = "paper-default";

export type TradingMode = "PAPER" | "LIVE";

export const SCORE_WEIGHTS = {
  marketQuality: 0.2,
  liquidity: 0.15,
  momentum: 0.15,
  volumeAnomaly: 0.1,
  smartMoney: 0.15,
  social: 0.1,
  news: 0.1,
} as const;

export const RISK_LIMITS = {
  maxPositionPct: 0.12,
  maxDailyLossPct: 0.08,
  maxTokenConcentrationPct: 0.25,
  maxChainExposurePct: 0.5,
  maxLiquidityTakePct: 0.02,
  maxSlippageBps: 150,
  maxTradeLossPct: 0.04,
} as const;

export const PAPER_ENGINE = {
  maxOpenPositions: 6,
  maxNewPerCycle: 4,
  minCashPct: 0.22,
  minOrderUsd: 80,
  majorStopPct: 0.045,
  dexStopPct: 0.07,
  majorTakePct: 0.07,
  dexTakePct: 0.12,
  majorTrailPct: 0.028,
  dexTrailPct: 0.05,
  trailArmPct: 0.03,
  staleHoursCut: 10,
  maxHoldHours: 40,
  minConfidenceMajor: 0.48,
  minConfidenceDex: 0.58,
  minMajorVolumeUsd: 750_000,
  minDexLiqUsd: 150_000,
  maxDexRug: 0.4,
  maxAbsChangeMajor: 55,
  maxAbsChangeDex: 45,
} as const;

export const PAPER_FEES = {
  dexFeeBps: 30,
  gasUsdEth: 2.5,
  gasUsdL2: 0.15,
  gasUsdSol: 0.02,
  baseSlippageBps: 8,
  latencyMsMin: 1500,
  latencyMsMax: 9000,
} as const;

/** Request-path cache. Scheduler polls independently. */
export const INGEST_TTL_MS = 150_000;
/** Background desk poll — public providers only; X is gated separately. */
export const INGEST_POLL_MS = 180_000;
export const PRICE_STALE_MS = 180_000;
/** Marks older than this cannot open a paper fill. CG last_updated often lags ~few minutes. */
export const PRICE_TRADE_STALE_MS = 12 * 60_000;
export const RANK_STALE_MS = 8 * 60_000;
export const NEWS_NEW_MS = 30 * 60_000;
export const NEWS_RECENT_MS = 6 * 60 * 60_000;
export const HTTP_TIMEOUT_MS = 12_000;
export const USER_AGENT = "AetherIntelligence/0.1 (+research; paper-trading)";

export const GT_NETWORKS = ["eth", "bsc", "base", "arbitrum", "solana"] as const;

export const CHAIN_TO_GOPLUS: Record<string, string> = {
  ethereum: "1",
  eth: "1",
  bsc: "56",
  base: "8453",
  arbitrum: "42161",
  polygon: "137",
  solana: "solana",
};

export const GT_TO_CHAIN: Record<string, string> = {
  eth: "ethereum",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  solana: "solana",
  polygon: "polygon",
};

export const DS_TO_CHAIN: Record<string, string> = {
  ethereum: "ethereum",
  bsc: "bsc",
  base: "base",
  arbitrum: "arbitrum",
  solana: "solana",
  polygon: "polygon",
};

export const SOURCE_RELIABILITY: Record<string, number> = {
  coingecko: 0.88,
  dexscreener: 0.78,
  geckoterminal: 0.76,
  kraken: 0.9,
  coinbase: 0.9,
  polymarket: 0.8,
  goplus: 0.72,
  coindesk: 0.86,
  cointelegraph: 0.72,
  decrypt: 0.7,
  theblock: 0.84,
  ethereum_blog: 0.9,
  solana_status: 0.88,
  fear_greed: 0.65,
  x: 0.55,
  reddit: 0.4,
  trending: 0.5,
  kraken_ticker: 0.9,
  okx: 0.84,
  defillama: 0.8,
  mempool_fees: 0.78,
  coinpaprika: 0.7,
  yahoo_macro: 0.74,
  bitcoinmagazine: 0.74,
  cryptoslate: 0.66,
  blockworks: 0.72,
  thedefiant: 0.7,
  binance: 0.88,
  coincap: 0.7,
};

export function envFlag(key: string, fallback = false): boolean {
  const v = typeof process === "undefined" ? undefined : process.env[key];
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export function envStr(key: string): string | undefined {
  const v = typeof process === "undefined" ? undefined : process.env[key];
  const t = v?.trim();
  return t || undefined;
}

export function tradingModeFromEnv(): TradingMode {
  const raw = envStr("TRADING_MODE")?.toUpperCase();
  if (raw === "LIVE") return "LIVE";
  return "PAPER";
}
