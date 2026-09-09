export type Side = "buy" | "sell";

export type AssetKind = "major" | "dex" | "stable" | "unknown";

export type WalletClass =
  | "proven_trader"
  | "early_buyer"
  | "momentum_trader"
  | "market_maker"
  | "whale"
  | "deployer"
  | "insider_risk"
  | "likely_bot"
  | "cex"
  | "unknown";

export type FreshnessBand = "NEW" | "RECENT" | "STALE" | "UNKNOWN";

export type SourceHealth = {
  source: string;
  status: "up" | "degraded" | "down";
  latencyMs: number | null;
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type AssetRow = {
  id: string;
  symbol: string;
  name: string;
  kind: AssetKind | string;
  chainId: string | null;
  contractAddress: string | null;
  coingeckoId: string | null;
  imageUrl: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24hUsd: number | null;
  liquidityUsd: number | null;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  pairCreatedAt: string | null;
  sparkline7d: number[] | null;
  source: string | null;
  sourceReliability: number;
  observedAt: string | null;
  ingestedAt: string | null;
  dataAgeMs: number | null;
};

export type ScoreComponents = {
  marketQuality: number;
  liquidity: number;
  momentum: number;
  volumeAnomaly: number;
  smartMoney: number;
  social: number;
  news: number;
  riskPenalty: number;
  executionPenalty: number;
};

export type RankedOpportunity = {
  asset: AssetRow;
  score: number;
  confidence: number;
  rugRisk: number;
  components: ScoreComponents;
  reasons: string[];
  riskReasons: string[];
};

export type SignalDTO = {
  id: string;
  strategyId: string;
  strategyVersion: string;
  assetId: string;
  symbol: string;
  name: string;
  side: Side;
  confidence: number;
  opportunityScore: number | null;
  status: string;
  entryMid: number | null;
  expectedHorizon: string | null;
  createdAt: string;
  explanation: string[];
};

export type NewsDTO = {
  id: string;
  source: string;
  sourceReliability: number;
  title: string;
  url: string | null;
  summary: string | null;
  entities: string[];
  publishedAt: string | null;
  ingestedAt: string | null;
  freshness: FreshnessBand;
  ageMs: number | null;
};

export type SocialDTO = {
  id: string;
  platform: string;
  author: string | null;
  url: string | null;
  body: string;
  engagement: number | null;
  entities: string[];
  publishedAt: string | null;
  freshness: FreshnessBand;
  sourceReliability: number;
  botLikelihood: number | null;
};

export type PolymarketDTO = {
  id: string;
  question: string;
  slug: string | null;
  probability: number | null;
  probabilityChange24h: number | null;
  volume: number | null;
  volume24h: number | null;
  liquidity: number | null;
  endDate: string | null;
  url: string | null;
  category: string | null;
};

export type WalletDTO = {
  id: string;
  chainId: string;
  address: string;
  label: string | null;
  classification: WalletClass | string;
  confidence: number;
  nTrades: number;
  lastSeen: string | null;
  notes: string | null;
};

export type WalletTxDTO = {
  id: string;
  walletId: string | null;
  address?: string;
  label?: string | null;
  chainId: string | null;
  txHash: string | null;
  assetId: string | null;
  symbol?: string | null;
  side: string | null;
  notionalUsd: number | null;
  priceUsd: number | null;
  observedAt: string | null;
};

export type PositionDTO = {
  id: string;
  assetId: string;
  symbol: string;
  name: string;
  qty: number;
  avgPrice: number;
  mark: number | null;
  notionalUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  openedAt: string;
  chainId: string | null;
};

export type PaperFillDTO = {
  id: string;
  orderId: string;
  assetId: string;
  symbol: string;
  side: Side;
  qty: number;
  price: number;
  notionalUsd: number;
  feeUsd: number;
  slippageBps: number;
  gasUsd: number;
  filledAt: string;
  model: string;
};

export type PaperOrderDTO = {
  id: string;
  assetId: string;
  symbol: string;
  side: Side;
  status: string;
  requestedNotionalUsd: number;
  submittedAt: string;
  reason: string | null;
  latencyMs: number | null;
};

export type EquityPoint = { t: string; equity: number };

export type PortfolioDTO = {
  id: string;
  name: string;
  tradingMode: "PAPER" | "LIVE";
  startingEquityUsd: number;
  cashUsd: number;
  equityUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  dayPnlUsd: number;
  dayPnlPct: number;
  maxDrawdownPct: number;
  peakEquityUsd: number;
  positions: PositionDTO[];
  recentFills: PaperFillDTO[];
  recentOrders: PaperOrderDTO[];
  equityCurve: EquityPoint[];
  feesPaidUsd: number;
  slippagePaidUsd: number;
  nTrades: number;
  nWins: number;
  nLosses: number;
  winRate: number | null;
};

export type BacktestMetrics = {
  totalReturnPct: number;
  annualizedReturnPct: number | null;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
  winRate: number;
  profitFactor: number;
  avgTradePct: number;
  medianTradePct: number;
  nTrades: number;
  exposurePct: number;
  feesUsd: number;
  slippageUsd: number;
  bestTradePct: number;
  worstTradePct: number;
  consecutiveLosses: number;
  avgWinPct: number;
  avgLossPct: number;
  payoffRatio: number;
  expectancy: number;
  calmar: number | null;
  benchmarkReturnPct: number | null;
  benchmarkOutperformancePct: number | null;
  capacityNote: string;
};

export type BacktestDTO = {
  id: string;
  strategyId: string;
  strategyVersion: string;
  assetId: string;
  venue: string;
  timeframe: string;
  startTime: string | null;
  endTime: string | null;
  inSample: boolean;
  walkForward: boolean;
  metrics: BacktestMetrics;
  equityCurve: EquityPoint[];
  notes: string | null;
  createdAt: string;
};

export type StrategyDTO = {
  id: string;
  name: string;
  version: string;
  description: string | null;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
};

export type RegimeDTO = {
  fearGreed: number | null;
  fearGreedLabel: string | null;
  btcChange24h: number | null;
  ethChange24h: number | null;
  btcDominancePct: number | null;
  label: string;
  btcFundingPct?: number | null;
  ethFundingPct?: number | null;
  defiTvlUsd?: number | null;
  stablecapUsd?: number | null;
  mempoolFastSatVb?: number | null;
  hashrateEh?: number | null;
  dxy?: number | null;
  dxyChangePct?: number | null;
  spx?: number | null;
  spxChangePct?: number | null;
  gold?: number | null;
  goldChangePct?: number | null;
  paprikaCapUsd?: number | null;
};

export type ResearchDTO = {
  id: string;
  assetId: string;
  model: string | null;
  fact: string;
  inference: string;
  uncertainty: string;
  speculation: string;
  createdAt: string;
};

export type XUsageDTO = {
  configured: boolean;
  callsToday: number;
  dailyCap: number;
  callsWeek: number;
  weeklyCap: number;
  lastCallAt: string | null;
  lastSuccessAt: string | null;
  nextCallAt: string | null;
  lastError: string | null;
  tweetsPulledWeek: number;
};

export type OverviewDTO = {
  generatedAt: string;
  tradingMode: "PAPER" | "LIVE";
  liveArmed: boolean;
  portfolio: PortfolioDTO;
  regime: RegimeDTO;
  opportunities: RankedOpportunity[];
  signals: SignalDTO[];
  news: NewsDTO[];
  social: SocialDTO[];
  polymarket: PolymarketDTO[];
  detectedEvents: DetectedEventDTO[];
  copySignals: CopySignalDTO[];
  sources: SourceHealth[];
  lastIngestAt: string | null;
  ingestStatus: string;
  assetCount: number;
  scanCapacity: {
    majors: number;
    dex: number;
    ranked: number;
  };
  xUsage: XUsageDTO;
  lastDigestAt?: string | null;
  nextDigestSlot?: string | null;
};

export type DetectedEventDTO = {
  id: string;
  source: string;
  author: string | null;
  entityId: string | null;
  title: string;
  url: string | null;
  eventType: string;
  category: string;
  affectedAssets: string[];
  sentiment: number | null;
  novelty: number;
  credibility: number;
  marketRelevance: number;
  impactScore: number;
  confidence: number;
  historicalContext: string;
  publishedAt: string | null;
  observedAt: string;
};

export type CopySignalDTO = {
  id: string;
  walletId: string;
  address: string;
  marketId: string | null;
  assetId: string | null;
  side: "buy" | "sell";
  walletQualityScore: number;
  copyConfidence: number;
  sourceTradeTimestamp: string;
  latencySeconds: number;
  expectedValue: number;
  reasons: string[];
};

export type SystemDTO = {
  tradingMode: "PAPER" | "LIVE";
  liveGates: { name: string; passed: boolean; detail: string }[];
  sources: SourceHealth[];
  lastIngest: {
    startedAt: string | null;
    finishedAt: string | null;
    status: string | null;
    durationMs: number | null;
    assetsUpserted: number | null;
    signalsCreated: number | null;
    errors: string[];
  };
  dbSource: string;
  paperStartingEquity: number;
  alerts: { id: string; kind: string; severity: string; title: string; createdAt: string }[];
  xUsage: XUsageDTO;
  pollMs: number;
  lastDigestAt: string | null;
  digestSchedule: string;
};
