import type { RankedOpportunity, RegimeDTO, SignalDTO } from "../types.ts";
import type { TradeIntent, RegimeInput } from "../engine.ts";

export type DecisionAction = "ENTER" | "WAIT" | "REJECT" | "EXIT";
export type Contribution = "STRONGLY_POSITIVE" | "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "STRONGLY_NEGATIVE";
export type AvoidableLoss = "AVOIDABLE" | "PROBABLY_UNAVOIDABLE" | "INSUFFICIENT_EVIDENCE";
export type DecisionOutcomeClass = "GOOD_GOOD" | "GOOD_BAD" | "BAD_GOOD" | "BAD_BAD";
export type PatternStatus = "DISCOVERED" | "SHADOW" | "VALIDATING" | "APPROVED" | "REJECTED";
export type LearnerStatus = "SHADOW" | "CANDIDATE" | "VALIDATING" | "APPROVED" | "REJECTED" | "ROLLED_BACK";
export type PromotionStage =
  | "DISCOVERED"
  | "SHADOW"
  | "TRAINED"
  | "VALIDATED"
  | "OUT-OF-SAMPLE"
  | "WALK-FORWARD"
  | "STABILITY-CHECK"
  | "PAPER-CANARY"
  | "APPROVED"
  | "REJECTED";
export type PromotionPipeline = { current: PromotionStage; history: PromotionStage[] };
export type SerializableRecord = Record<string, string | number | boolean | null>;

export type DecisionFeatures = {
  momentum: number;
  liquidity: number;
  volumeAnomaly: number;
  marketQuality: number;
  smartMoney: number;
  social: number;
  news: number;
  riskPenalty: number;
  executionPenalty: number;
  score: number;
  confidence: number;
  rugRisk: number;
  change1hPct: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  distFrom7dHighPct: number | null;
  isMajor: boolean;
  isDex: boolean;
};

export type MarketStructure = {
  htfTrend: "bullish" | "bearish" | "neutral";
  priceVs7dHigh: "near_high" | "mid" | "near_low";
  volatilityRegime: "low" | "medium" | "high";
};

export type EvidenceState = {
  newsBoost: number;
  socialBoost: number;
  walletHits: number;
  eventsNear: number;
  signalAgreement: number;
  contradictorySignals: number;
};

export type RiskState = {
  positionPctOfEquity: number;
  tokenConcentrationPct: number;
  chainExposurePct: number;
  liquidityTakePct: number;
  slippageBps: number;
  dailyLossUsedPct: number;
  hardLimitsHit: string[];
};

export type SizingInfo = {
  equityUsd: number;
  cashUsd: number;
  requestedNotionalUsd: number;
  approvedNotionalUsd: number;
  positionSizePct: number;
};

export type ExecutionAssumptions = {
  latencyMs: number;
  feeBps: number;
  baseSlippageBps: number;
  model: string;
  expectedFillPrice: number;
};

export type DataQuality = {
  priceFresh: boolean;
  dataAgeMs: number | null;
  sourceReliability: number;
  source: string | null;
  stalenessFlags: string[];
};

export type LearnerRecommendation = {
  action: DecisionAction;
  expectedReward: number;
  confidence: number;
  reasons: string[];
};

export type DecisionContext = {
  assetId: string;
  symbol: string;
  decision: DecisionAction;
  side?: "buy" | "sell";
  strategyId: string;
  strategyVersion: string;
  signalId?: string | null;
  orderId?: string | null;
  actionAt?: string;
  ranked?: RankedOpportunity;
  regime?: RegimeInput | RegimeDTO;
  signal?: SignalDTO;
  intent?: TradeIntent;
  expectedValue?: number;
  confidence?: number;
  sizing?: SizingInfo;
  execution?: ExecutionAssumptions;
  dataQuality?: DataQuality;
  learnerRecommendation?: LearnerRecommendation | null;
  notes?: string;
};

export type DecisionSnapshot = {
  id: string;
  portfolioId: string;
  assetId: string;
  symbol: string;
  decision: DecisionAction;
  side: "buy" | "sell" | null;
  actionAt: string;
  strategyId: string;
  strategyVersion: string;
  learnerVersion: string;
  signalId: string | null;
  orderId: string | null;
  features: DecisionFeatures;
  marketStructure: MarketStructure;
  regime: Record<string, string | number | boolean | null>;
  evidence: EvidenceState;
  riskState: RiskState;
  sizing: SizingInfo | null;
  executionAssumptions: ExecutionAssumptions | null;
  dataQuality: DataQuality;
  expectedValue: number | null;
  confidence: number | null;
  learnerRecommendation: LearnerRecommendation | null;
  notes: string | null;
  createdAt: string;
};

export type TradeOutcome = {
  id: string;
  decisionSnapshotId: string;
  portfolioId: string;
  assetId: string;
  exitActionAt: string;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  realizedPnlUsd: number;
  realizedReturnPct: number;
  realizedRMultiple: number | null;
  feesUsd: number;
  gasUsd: number;
  slippageBps: number;
  holdingSeconds: number;
  mfePct: number | null;
  maePct: number | null;
  drawdownImpactPct: number | null;
  exitReason: string;
  stopHit: boolean;
  targetHit: boolean;
  thesisInvalidated: boolean;
  postExitReturnPct: number | null;
  opportunityCostPct: number | null;
  createdAt: string;
};

export type RewardComponents = {
  outcomeQuality: number;
  decisionQuality: number;
  executionQuality: number;
  riskDiscipline: number;
  drawdownPenalty: number;
  slippagePenalty: number;
  feePenalty: number;
  contradictionPenalty: number;
};

export type TradeReward = {
  id: string;
  outcomeId: string;
  decisionSnapshotId: string;
  totalReward: number;
  components: RewardComponents;
  avoidableLoss: AvoidableLoss | null;
  decisionOutcomeClass: DecisionOutcomeClass | null;
  version: string;
  createdAt: string;
};

export type FeatureAttribution = {
  id: string;
  rewardId: string;
  featureName: string;
  contribution: Contribution;
  conditionalExpectancy: number | null;
  evidence: string;
};

export type DiscoveredPattern = {
  id: string;
  patternHash: string;
  status: PatternStatus;
  description: string;
  conditions: Record<string, string | number | boolean>;
  action: DecisionAction;
  regime: string | null;
  assetScope: string | null;
  sampleCount: number;
  positiveCount: number;
  negativeCount: number;
  winRate: number | null;
  expectancy: number | null;
  avgReward: number | null;
  rewardVariance: number | null;
  confidenceLower: number | null;
  confidenceUpper: number | null;
  oosExpectancy: number | null;
  walkForwardStability: number | null;
  recencyWeight: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  promotedAt: string | null;
  rolledBackAt: string | null;
  championVersion: string | null;
  learnerVersion: string;
  createdAt: string;
  updatedAt: string;
};

export type LessonEvidence = {
  positive?: Array<{ name: string; weight: number | null }>;
  negative?: Array<{ name: string; weight: number | null }>;
  reward?: number;
  avoidableLoss?: string | null;
  decisionOutcomeClass?: string | null;
  attributions?: Array<{ name: string; contribution: Contribution }>;
};

export type Lesson = {
  id: string;
  patternId: string | null;
  tradeRewardId: string | null;
  lessonType: "POSITIVE" | "NEGATIVE" | "CAVEAT";
  title: string;
  body: string;
  evidence: LessonEvidence;
  confidence: "HIGH" | "MODERATE" | "LOW" | "INSUFFICIENT_EVIDENCE";
  createdAt: string;
};

export type LearnerVersion = {
  learnerId: string;
  learnerVersion: string;
  status: LearnerStatus;
  strategyId: string;
  strategyVersion: string;
  trainingPeriodStart: string | null;
  trainingPeriodEnd: string | null;
  trainingExperienceCount: number;
  featuresUsed: string[];
  hyperparameters: SerializableRecord;
  validationMetrics: Record<string, number>;
  oosMetrics: Record<string, number>;
  walkForwardMetrics: Record<string, number>;
  ablationResults: Record<string, Record<string, number>>;
  sensitivityResults: Record<string, Record<string, number>>;
  championVersion: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  rolledBackAt: string | null;
  rollbackReason: string | null;
};

export type StrategyCandidate = {
  id: string;
  strategyId: string;
  strategyVersion: string;
  learnerVersion: string;
  championVersion: string | null;
  status: LearnerStatus;
  promotionPipeline: PromotionPipeline;
  validationResults: SerializableRecord;
  createdAt: string;
  approvedAt: string | null;
  rolledBackAt: string | null;
  rollbackReason: string | null;
};

export type LearningExperience = {
  id: string;
  learnerVersion: string;
  decisionSnapshotId: string;
  rewardId: string | null;
  patternSignatures: string[];
  featureVector: SerializableRecord;
  reward: number | null;
  outcome: SerializableRecord;
  attribution: Record<string, Contribution>;
  validationStatus: "IN_SAMPLE" | "OOS" | "WALK_FORWARD" | "REJECTED";
  usedForTraining: boolean;
  createdAt: string;
};

export type LearningOverview = {
  learnerVersion: string;
  championVersion: string | null;
  challengerVersion: string | null;
  experiences: number;
  positiveRewards: number;
  negativeRewards: number;
  averageReward: number | null;
  status: string;
  patterns: number;
  approvedPatterns: number;
  shadowPatterns: number;
  lessons: number;
};

export type ChampionChallengerMetrics = {
  totalReturnPct: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRate: number;
  expectancy: number;
  calmar: number | null;
  payoffRatio: number;
  nTrades: number;
  tradesByRegime: Record<string, { n: number; avgReturn: number }>;
  tradesByAsset: Record<string, { n: number; avgReturn: number }>;
  costSensitivity: Record<string, number>;
};

export type LearningDashboard = {
  overview: LearningOverview;
  goodTrades: Array<TradeReward & { snapshot: DecisionSnapshot; outcome: TradeOutcome; attributions: FeatureAttribution[] }>;
  badTrades: Array<TradeReward & { snapshot: DecisionSnapshot; outcome: TradeOutcome; attributions: FeatureAttribution[] }>;
  patterns: DiscoveredPattern[];
  learners: LearnerVersion[];
  candidates: StrategyCandidate[];
  lessons: Lesson[];
};
