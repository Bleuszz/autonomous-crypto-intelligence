import { clamp, num, num0 } from "./math.ts";

export type TokenSecurity = {
  isHoneypot?: boolean | null;
  buyTax?: number | null;
  sellTax?: number | null;
  transferTax?: number | null;
  isProxy?: boolean | null;
  isOpenSource?: boolean | null;
  cannotSell?: boolean | null;
  cannotBuy?: boolean | null;
  ownerPercent?: number | null;
  creatorPercent?: number | null;
  top10Percent?: number | null;
  lpLocked?: boolean | null;
  mintable?: boolean | null;
  freezeable?: boolean | null;
  blacklist?: boolean | null;
  hiddenOwner?: boolean | null;
  isMintable?: boolean | null;
  tradingCooldown?: boolean | null;
  holderCount?: number | null;
};

export type RugAssessment = {
  score: number;
  reasons: string[];
};

function flag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === "string") return ["1", "true", "yes"].includes(v.toLowerCase());
  return false;
}

function pct(v: unknown): number | null {
  const n = num(v);
  if (n == null) return null;
  return n > 1 && n <= 100 ? n / 100 : n;
}

export function assessRug(sec: TokenSecurity, extras?: { ageHours?: number | null; liquidityUsd?: number | null; name?: string }): RugAssessment {
  const reasons: string[] = [];
  let s = 0.12;

  if (flag(sec.isHoneypot) || flag(sec.cannotSell)) {
    s += 0.55;
    reasons.push("Honeypot / cannot-sell indicator");
  }
  if (flag(sec.cannotBuy)) {
    s += 0.2;
    reasons.push("Cannot-buy indicator");
  }
  const sellTax = pct(sec.sellTax);
  const buyTax = pct(sec.buyTax);
  if (sellTax != null && sellTax > 0.1) {
    s += Math.min(0.25, sellTax);
    reasons.push(`Sell tax ${(sellTax * 100).toFixed(1)}%`);
  }
  if (buyTax != null && buyTax > 0.1) {
    s += Math.min(0.15, buyTax);
    reasons.push(`Buy tax ${(buyTax * 100).toFixed(1)}%`);
  }
  if (flag(sec.mintable) || flag(sec.isMintable)) {
    s += 0.18;
    reasons.push("Mint authority present");
  }
  if (flag(sec.freezeable)) {
    s += 0.12;
    reasons.push("Freeze authority present");
  }
  if (flag(sec.blacklist)) {
    s += 0.12;
    reasons.push("Blacklist function present");
  }
  if (flag(sec.hiddenOwner)) {
    s += 0.1;
    reasons.push("Hidden owner");
  }
  if (sec.isOpenSource === false) {
    s += 0.08;
    reasons.push("Source not verified");
  }
  if (flag(sec.isProxy)) {
    s += 0.06;
    reasons.push("Proxy contract");
  }
  const creator = pct(sec.creatorPercent) ?? pct(sec.ownerPercent);
  if (creator != null && creator > 0.15) {
    s += Math.min(0.22, creator);
    reasons.push(`Deployer concentration ${(creator * 100).toFixed(1)}%`);
  }
  const top10 = pct(sec.top10Percent);
  if (top10 != null && top10 > 0.4) {
    s += Math.min(0.18, (top10 - 0.4) * 0.6);
    reasons.push(`Top-10 wallets ${(top10 * 100).toFixed(0)}%`);
  }
  if (sec.lpLocked === false) {
    s += 0.12;
    reasons.push("Liquidity not locked (where detectable)");
  }
  const liq = extras?.liquidityUsd ?? null;
  if (liq != null && liq < 20_000) {
    s += 0.1;
    reasons.push("Very low liquidity");
  }
  const age = extras?.ageHours ?? null;
  if (age != null && age < 6) {
    s += 0.08;
    reasons.push("Contract / pool is very new");
  }
  if (sec.holderCount != null && sec.holderCount < 30) {
    s += 0.06;
    reasons.push("Few holders");
  }

  if (!reasons.length) reasons.push("No high-severity flags from available data — not a safety certificate");

  return { score: clamp(s, 0, 0.99), reasons };
}

export function parseGoPlus(raw: Record<string, unknown>): TokenSecurity {
  const n = (k: string) => num(raw[k]);
  const b = (k: string) => {
    const v = raw[k];
    if (v == null) return null;
    return flag(v);
  };
  const holders = raw.holders;
  let top10 = 0;
  if (Array.isArray(holders)) {
    top10 = holders.slice(0, 10).reduce((a: number, h: unknown) => {
      const rec = h as { percent?: unknown };
      return a + num0(rec.percent);
    }, 0);
    if (top10 > 1) top10 = top10 / 100;
  }
  return {
    isHoneypot: b("is_honeypot"),
    buyTax: n("buy_tax"),
    sellTax: n("sell_tax"),
    transferTax: n("transfer_tax"),
    isProxy: b("is_proxy"),
    isOpenSource: b("is_open_source"),
    cannotSell: b("cannot_sell_all") || b("cannot_sell"),
    cannotBuy: b("cannot_buy"),
    ownerPercent: n("owner_percent"),
    creatorPercent: n("creator_percent"),
    top10Percent: top10 || null,
    lpLocked: b("is_lp_locked") ?? (raw.lp_holders ? undefined : null),
    mintable: b("is_mintable"),
    freezeable: b("is_freezable") ?? b("transfer_pausable"),
    blacklist: b("is_blacklisted") ?? b("can_take_back_ownership"),
    hiddenOwner: b("hidden_owner"),
    tradingCooldown: b("trading_cooldown"),
    holderCount: n("holder_count"),
  };
}

export type RiskLimitCheck = {
  ok: boolean;
  reasons: string[];
};

export function checkOrderRisk(opts: {
  equity: number;
  cash: number;
  requestedNotional: number;
  dayPnlUsd: number;
  tokenNotionalAfter: number;
  chainNotionalAfter: number;
  liquidityUsd: number;
  slippageBps: number;
  startingEquity?: number;
  limits: {
    maxPositionPct: number;
    maxDailyLossPct: number;
    maxTokenConcentrationPct: number;
    maxChainExposurePct: number;
    maxLiquidityTakePct: number;
    maxSlippageBps: number;
  };
}): RiskLimitCheck {
  const reasons: string[] = [];
  if (opts.equity <= 0) reasons.push("Equity is non-positive");
  if (opts.requestedNotional > opts.cash + 1e-6) reasons.push("Insufficient cash");
  if (opts.requestedNotional > opts.equity * opts.limits.maxPositionPct + 1e-6) {
    reasons.push(`Exceeds max position size (${opts.limits.maxPositionPct * 100}% of equity)`);
  }
  const dailyAnchor = opts.startingEquity && opts.startingEquity > 0 ? opts.startingEquity : opts.equity;
  if (opts.dayPnlUsd < -dailyAnchor * opts.limits.maxDailyLossPct) {
    reasons.push("Daily loss circuit breaker");
  }
  if (opts.tokenNotionalAfter > opts.equity * opts.limits.maxTokenConcentrationPct + 1e-6) {
    reasons.push("Token concentration limit");
  }
  if (opts.chainNotionalAfter > opts.equity * opts.limits.maxChainExposurePct + 1e-6) {
    reasons.push("Chain exposure limit");
  }
  const take = opts.liquidityUsd > 0 ? opts.requestedNotional / opts.liquidityUsd : 1;
  if (take > opts.limits.maxLiquidityTakePct) {
    reasons.push("Order too large versus pool liquidity");
  }
  if (opts.slippageBps > opts.limits.maxSlippageBps) {
    reasons.push("Modelled slippage above limit");
  }
  return { ok: reasons.length === 0, reasons };
}
