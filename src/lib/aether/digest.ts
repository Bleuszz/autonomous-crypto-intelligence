import { APP_NAME } from "./config.ts";
import { fmtPct, fmtUsd } from "./format.ts";
import { redactSecrets } from "./privacy.ts";
import { formatUtc } from "./time.ts";
import type { OverviewDTO } from "./types.ts";

export type DigestSlot = "morning" | "evening";

export type DigestReport = {
  slot: DigestSlot;
  generatedAt: string;
  subject: string;
  text: string;
  html: string;
};

export function londonSlot(now = new Date()): { slot: DigestSlot; date: string } | null {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  // 8-minute window so a 3-minute poll still hits the clock.
  if (hour === 8 && minute < 8) return { slot: "morning", date };
  if (hour === 20 && minute < 8) return { slot: "evening", date };
  return null;
}

export function digestKey(slot: DigestSlot, date: string): string {
  return `${date}:${slot}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "\u0026amp;")
    .replace(/</g, "\u0026lt;")
    .replace(/>/g, "\u0026gt;")
    .replace(/"/g, "\u0026quot;");
}

export function buildDigest(overview: OverviewDTO, slot: DigestSlot): DigestReport {
  const p = overview.portfolio;
  const ret = p.startingEquityUsd ? ((p.equityUsd - p.startingEquityUsd) / p.startingEquityUsd) * 100 : 0;
  const generatedAt = overview.generatedAt;
  const heading = slot === "morning" ? "Morning desk" : "Evening desk";
  const subject = `${APP_NAME} ${heading} — equity ${fmtUsd(p.equityUsd)} · day ${fmtPct(p.dayPnlPct)}`;

  const posLines = p.positions.length
    ? p.positions
        .map(
          (x) =>
            `  ${x.symbol}  qty ${x.qty.toPrecision(4)}  avg ${fmtUsd(x.avgPrice)}  mark ${fmtUsd(x.mark)}  uPnL ${fmtUsd(x.unrealizedPnlUsd)} (${fmtPct(x.unrealizedPnlPct)})`,
        )
        .join("\n")
    : "  Flat — no open inventory.";

  const fillLines = p.recentFills.length
    ? p.recentFills
        .slice(0, 16)
        .map(
          (f) =>
            `  ${f.side.toUpperCase()} ${f.symbol}  ${fmtUsd(f.notionalUsd)} @ ${fmtUsd(f.price)}  slip ${f.slippageBps.toFixed(0)}bps  fee ${fmtUsd(f.feeUsd)}  ${formatUtc(f.filledAt)}`,
        )
        .join("\n")
    : "  No fills in the recent blotter.";

  const sigLines = overview.signals.length
    ? overview.signals
        .slice(0, 10)
        .map((s) => `  ${s.side.toUpperCase()} ${s.symbol}  ${s.strategyId}  conf ${(s.confidence * 100).toFixed(0)}%  ${s.explanation[0] ?? ""}`)
        .join("\n")
    : "  No open signals.";

  const oppLines = overview.opportunities
    .slice(0, 8)
    .map(
      (o) =>
        `  ${o.asset.symbol.padEnd(8)} score ${(o.score * 100).toFixed(0)}  conf ${(o.confidence * 100).toFixed(0)}  Δ24h ${fmtPct(o.asset.change24hPct)}  ${o.reasons[0] ?? ""}`,
    )
    .join("\n");

  const newsLines = overview.news
    .slice(0, 8)
    .map((n) => `  [${n.freshness}] ${n.source}: ${n.title}`)
    .join("\n");

  const srcLines = overview.sources
    .map((s) => `  ${s.source}: ${s.status}${s.lastError ? ` (${s.lastError})` : ""}`)
    .join("\n");

  const r = overview.regime;
  const x = overview.xUsage;

  const lines: Array<string | null> = [
      `${APP_NAME} — ${heading}`,
      `Generated ${formatUtc(generatedAt)} (Europe/London clock for the 08:00 / 20:00 send).`,
      `Paper only. Live execution is compiled out. No API keys, tokens or personal identifiers are included.`,
      "",
      "=== FACT — portfolio ===",
      `Equity ${fmtUsd(p.equityUsd)}   cash ${fmtUsd(p.cashUsd)}   start ${fmtUsd(p.startingEquityUsd)}`,
      `Total return ${fmtPct(ret)}   day P/L ${fmtUsd(p.dayPnlUsd)} (${fmtPct(p.dayPnlPct)})`,
      `Realized ${fmtUsd(p.realizedPnlUsd)}   unrealized ${fmtUsd(p.unrealizedPnlUsd)}`,
      `Peak ${fmtUsd(p.peakEquityUsd)}   max DD ${fmtPct(p.maxDrawdownPct)}`,
      `Fees ${fmtUsd(p.feesPaidUsd)}   modelled slippage ${fmtUsd(p.slippagePaidUsd)}   fills ${p.nTrades}${p.winRate != null ? `   win rate ${fmtPct(p.winRate * 100)}` : ""}`,
      "",
      "=== FACT — open positions ===",
      posLines,
      "",
      "=== FACT — recent paper fills (latency + impact + fee model) ===",
      fillLines,
      "",
      "=== FACT — regime & tape ===",
      `Label: ${r.label}`,
      `Fear & Greed ${r.fearGreed ?? "—"} (${r.fearGreedLabel ?? "—"})`,
      `BTC 24h ${fmtPct(r.btcChange24h)}   ETH 24h ${fmtPct(r.ethChange24h)}   BTC dominance ${r.btcDominancePct != null ? fmtPct(r.btcDominancePct) : "—"}`,
      r.btcFundingPct != null ? `BTC perp funding ${r.btcFundingPct.toFixed(4)}%` : "BTC perp funding: not in this snapshot",
      r.ethFundingPct != null ? `ETH perp funding ${r.ethFundingPct.toFixed(4)}%` : null,
      r.defiTvlUsd != null ? `DefiLlama chain TVL ${fmtUsd(r.defiTvlUsd)}` : null,
      r.stablecapUsd != null ? `Stablecoin float ${fmtUsd(r.stablecapUsd)}` : null,
      r.mempoolFastSatVb != null ? `Mempool fastest fee ${r.mempoolFastSatVb} sat/vB` : null,
      r.hashrateEh != null ? `Hashrate ${r.hashrateEh.toFixed(1)} EH/s` : null,
      r.dxy != null ? `DXY ${r.dxy.toFixed(2)} (${fmtPct(r.dxyChangePct)})   SPX ${r.spx ?? "—"} (${fmtPct(r.spxChangePct)})   Gold ${r.gold ?? "—"} (${fmtPct(r.goldChangePct)})` : null,
      r.paprikaCapUsd != null ? `CoinPaprika cap ${fmtUsd(r.paprikaCapUsd)}` : null,
      `Scan: ${overview.scanCapacity.majors} majors · ${overview.scanCapacity.dex} dex · ${overview.scanCapacity.ranked} ranked`,
      `Last ingest ${formatUtc(overview.lastIngestAt)}  status ${overview.ingestStatus}`,
      x
        ? `X API (budgeted): ${x.callsToday}/${x.dailyCap} today, ${x.callsWeek}/${x.weeklyCap} week, ${x.tweetsPulledWeek} tweets. Next window ${x.nextCallAt ? formatUtc(x.nextCallAt) : "—"}.`
        : null,
      "",
      "=== FACT — open signals ===",
      sigLines,
      "",
      "=== FACT — top ranked opportunities ===",
      oppLines || "  None ranked.",
      "",
      "=== FACT — news (entity-linked, not treated as true) ===",
      newsLines || "  None.",
      "",
      "=== FACT — source health ===",
      srcLines,
      "",
      "=== INFERENCE ===",
      p.positions.length === 0
        ? "The book is flat or still waiting for a quality bar to clear. That is a decision, not a stub: social-proxy and thin DEX prints are not auto-traded."
        : `Inventory is ${p.positions.map((x) => x.symbol).join(", ")}. Day P/L ${fmtUsd(p.dayPnlUsd)} on ${fmtUsd(p.equityUsd)} equity.`,
      (r.fearGreed ?? 50) > 75
        ? "Tape is greedy — engine trims winners and refuses stretched DEX chase."
        : (r.fearGreed ?? 50) < 30
          ? "Tape is fearful — engine prefers liquid majors and dip-buys over new DEX inventory."
          : "Mixed regime — both dip-buys and confirmed momentum can fire, still size-capped.",
      (r.dxyChangePct ?? 0) >= 0.45
        ? "DXY is bid — engine cuts alt size and can exit non-BTC/ETH beta."
        : null,
      (r.mempoolFastSatVb ?? 0) >= 55
        ? "BTC mempool is congested — new DEX inventory is refused this cycle."
        : null,
      "",
      "=== UNCERTAINTY ===",
      "Paper fills are modelled (latency, impact, DEX fee, gas). They are not venue prints. Rank scores are not forecasts. News ticker matches are not causal claims. X is a throttled recent-search sample, not the firehose. Venue overlays (Kraken/Coinbase/OKX/Binance/CoinCap) refresh marks when those APIs answer; CoinGecko last_updated can lag.",
      "",
      "=== SPECULATION ===",
      "Do not treat this email as a recommendation to spend real money. Live submission stays compiled out.",
      "",
      "— Aether (paper desk)",
    ];

  const text = redactSecrets(lines.filter((line): line is string => line != null).join("\n"));

  const posHtml = p.positions.length
    ? `<table><thead><tr><th>Asset</th><th>Qty</th><th>Avg</th><th>Mark</th><th>uPnL</th></tr></thead><tbody>${p.positions
        .map(
          (x) =>
            `<tr><td>${esc(x.symbol)}</td><td>${x.qty.toPrecision(4)}</td><td>${esc(fmtUsd(x.avgPrice))}</td><td>${esc(fmtUsd(x.mark))}</td><td>${esc(fmtUsd(x.unrealizedPnlUsd))} (${esc(fmtPct(x.unrealizedPnlPct))})</td></tr>`,
        )
        .join("")}</tbody></table>`
    : "<p>Flat — no open inventory.</p>";

  const html = `<!DOCTYPE html><html><body style="font-family:ui-sans-serif,system-ui,sans-serif;background:#0b0b0f;color:#e7e7ea;padding:24px">
  <h1 style="font-size:20px">${esc(APP_NAME)} — ${esc(heading)}</h1>
  <p style="color:#a0a0ab">${esc(formatUtc(generatedAt))} · paper only · live execution compiled out</p>
  <h2>Portfolio</h2>
  <p>Equity <b>${esc(fmtUsd(p.equityUsd))}</b> · cash ${esc(fmtUsd(p.cashUsd))} · day ${esc(fmtUsd(p.dayPnlUsd))} (${esc(fmtPct(p.dayPnlPct))}) · total ${esc(fmtPct(ret))}</p>
  <p>Realized ${esc(fmtUsd(p.realizedPnlUsd))} · fees ${esc(fmtUsd(p.feesPaidUsd))} · slippage ${esc(fmtUsd(p.slippagePaidUsd))} · max DD ${esc(fmtPct(p.maxDrawdownPct))}</p>
  <h2>Positions</h2>${posHtml}
  <h2>Regime</h2>
  <p>${esc(r.label)} · F&G ${r.fearGreed ?? "—"} · BTC ${esc(fmtPct(r.btcChange24h))} · ETH ${esc(fmtPct(r.ethChange24h))}</p>
  <h2>Signals</h2>
  <pre style="white-space:pre-wrap">${esc(sigLines)}</pre>
  <h2>News</h2>
  <pre style="white-space:pre-wrap">${esc(newsLines)}</pre>
  <p style="color:#a0a0ab;font-size:12px">FACT / INFERENCE / UNCERTAINTY / SPECULATION are labelled in the plain-text part. Keys, tokens and recipient addresses are never included.</p>
  </body></html>`;

  return { slot, generatedAt, subject: redactSecrets(subject), text, html: redactSecrets(html) };
}

type Ledger = { sent: Record<string, string> };

async function ledgerPath(): Promise<string> {
  const path = await import("node:path");
  return path.join(process.cwd(), "secrets/digest-ledger.json");
}

export async function wasDigestSent(key: string): Promise<boolean> {
  try {
    const fs = await import("node:fs");
    const file = await ledgerPath();
    if (!fs.existsSync(file)) return false;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
    return Boolean(parsed?.sent?.[key]);
  } catch {
    return false;
  }
}

export async function rememberDigest(key: string, report: DigestReport): Promise<void> {
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = await ledgerPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let parsed: Ledger = { sent: {} };
    if (fs.existsSync(file)) {
      try {
        parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
      } catch {
        parsed = { sent: {} };
      }
    }
    parsed.sent[key] = report.generatedAt;
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2));
    fs.writeFileSync(
      path.join(path.dirname(file), "latest-digest.txt"),
      report.text,
    );
  } catch {
    /* disk persist is best-effort; never throw into ingest */
  }
}

export async function loadLatestDigestMeta(): Promise<{ generatedAt: string | null; key: string | null }> {
  try {
    const fs = await import("node:fs");
    const file = await ledgerPath();
    if (!fs.existsSync(file)) return { generatedAt: null, key: null };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Ledger;
    const entries = Object.entries(parsed.sent ?? {});
    if (!entries.length) return { generatedAt: null, key: null };
    entries.sort((a, b) => (a[1] < b[1] ? 1 : -1));
    const [key, generatedAt] = entries[0]!;
    return { key, generatedAt };
  } catch {
    return { generatedAt: null, key: null };
  }
}

