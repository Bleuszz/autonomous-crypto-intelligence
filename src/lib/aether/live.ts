import { envStr, type TradingMode } from "./config.ts";

export type LiveGate = { name: string; passed: boolean; detail: string };

export type LiveEvaluation = {
  requestedMode: TradingMode;
  armed: boolean;
  canSubmit: boolean;
  gates: LiveGate[];
};

/**
 * LIVE must never activate merely because an API key exists.
 * Every gate is fail-closed. Presence of credentials is reported as a boolean
 * only — values are never copied into the public DTO.
 */
export function evaluateLiveGates(
  env: Record<string, string | undefined> = typeof process === "undefined" ? {} : (process.env as Record<string, string | undefined>),
  cfg: { tradingMode: TradingMode; enableLiveTrading: boolean } = {
    tradingMode: "PAPER",
    enableLiveTrading: false,
  },
): LiveEvaluation {
  const get = (k: string) => env[k] ?? envStr(k);
  const flag = (k: string) => {
    const v = get(k);
    return !!v && ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
  };

  const envLive = flag("ENABLE_LIVE_TRADING");
  const unlock = get("LIVE_EXECUTION_UNLOCK") === "I_UNDERSTAND_THIS_SPENDS_REAL_MONEY";
  const envMode = (get("TRADING_MODE") ?? "PAPER").toUpperCase() === "LIVE";
  const hasExchangeCreds = !!(get("BINANCE_API_KEY") && get("BINANCE_API_SECRET")) || !!(get("COINBASE_API_KEY") && get("COINBASE_API_SECRET"));

  const gates: LiveGate[] = [
    {
      name: "ENABLE_LIVE_TRADING env",
      passed: envLive,
      detail: envLive ? "set true" : "false or unset — live remains locked",
    },
    {
      name: "Config enable_live_trading",
      passed: cfg.enableLiveTrading === true,
      detail: cfg.enableLiveTrading ? "explicitly enabled in system config" : "system config is not enabled",
    },
    {
      name: "TRADING_MODE",
      passed: cfg.tradingMode === "LIVE" && envMode,
      detail: `config=${cfg.tradingMode} env=${get("TRADING_MODE") ?? "PAPER"}`,
    },
    {
      name: "Execution unlock phrase",
      passed: unlock,
      detail: unlock ? "present" : "LIVE_EXECUTION_UNLOCK is not set to the required phrase",
    },
    {
      name: "Separate live credentials",
      passed: hasExchangeCreds,
      detail: hasExchangeCreds ? "exchange API keys present (values never shown)" : "no live exchange credentials",
    },
    {
      name: "Not a preview accident",
      passed: !!get("GROK_PROJECT_ID") || flag("ALLOW_LIVE_IN_NON_PRODUCTION"),
      detail: "Live submission is refused in ephemeral preview environments",
    },
  ];

  const armed = gates.every((g) => g.passed);
  return {
    requestedMode: cfg.tradingMode,
    armed: false,
    canSubmit: false,
    gates: armed
      ? [
          ...gates,
          {
            name: "Hard disable",
            passed: false,
            detail: "Live submission is compiled out for this release. Paper trading only.",
          },
        ]
      : gates,
  };
}

export function assertPaperOnly(evaluation: LiveEvaluation = evaluateLiveGates()): void {
  if (evaluation.canSubmit) {
    throw new Error("Live submission unexpectedly armed");
  }
}
