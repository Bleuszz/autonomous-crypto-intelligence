import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchXIntelligence } from "@/lib/aether/api";
import { ErrorState, Kpi, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { XIntelligenceDashboard } from "@/lib/aether/x-market-intelligence";

export const Route = createFileRoute("/x-intelligence")({ component: XIntelligencePage });

function fmtLatency(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n < 1000) return `${Math.round(n)} ms`;
  return `${(n / 1000).toFixed(1)} s`;
}

function impactVariant(score: number): "default" | "outline" | "up" | "warn" | "down" {
  if (score >= 80) return "up";
  if (score >= 60) return "warn";
  if (score >= 40) return "outline";
  return "default";
}

function XIntelligencePage() {
  const q = useQuery({ queryKey: ["x-intelligence"], queryFn: () => fetchXIntelligence() });
  const d = q.data as XIntelligenceDashboard | undefined;
  return (
    <div>
      <PageHeader
        kicker="Context"
        title="X market intelligence"
        description="Low-latency monitoring of a compact, high-value X watchlist. Streaming is used in long-lived processes; no live trades are placed."
      />
      {q.isLoading ? <Skeleton className="h-96 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}

      {d ? <HealthBanner d={d} /> : null}
      {d ? <WatchlistSummary d={d} /> : null}
      {d ? <LatencyGrid d={d} /> : null}
      {d ? <BreakingEvents d={d} /> : null}
      {d ? <AccountPerformance d={d} /> : null}
      {d ? <RecentPosts d={d} /> : null}
    </div>
  );
}

function HealthBanner({ d }: { d: XIntelligenceDashboard }) {
  const h = d.health;
  return (
    <div className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={d.enabled ? (h.connected ? "up" : "warn") : "outline"}>
          {d.enabled ? (h.connected ? "STREAM CONNECTED" : "STREAM DISCONNECTED") : "DISABLED"}
        </Badge>
        <span className="text-muted-foreground">mode: {d.mode}</span>
        {h.lastEventAt ? (
          <span className="text-muted-foreground">last event: {new Date(h.lastEventAt).toISOString().replace("T", " ").slice(0, 19)} UTC</span>
        ) : null}
        {h.reconnectCount > 0 ? (
          <span className="text-muted-foreground">reconnects: {h.reconnectCount}</span>
        ) : null}
        {h.lastError ? <span className="text-warn">error: {h.lastError}</span> : null}
      </div>
      {!d.enabled ? (
        <p className="mt-2 text-xs text-muted-foreground">
          X ingestion is disabled. Set <code className="rounded bg-muted px-1">X_ENABLED=true</code> and{" "}
          <code className="rounded bg-muted px-1">X_MODE=filtered_stream</code> in the environment to enable the stream.
        </p>
      ) : null}
    </div>
  );
}

function WatchlistSummary({ d }: { d: XIntelligenceDashboard }) {
  const s = d.watchlistSummary;
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Watchlist" value={`${s.enabled}/${s.total}`} hint="enabled accounts" />
      <Kpi label="Tier 1" value={s.tier1} hint="extreme influence" tone="up" />
      <Kpi label="Tier 2" value={s.tier2} hint="major corporate / industry" />
      <Kpi label="Tier 3" value={s.tier3} hint="information sources" />
    </div>
  );
}

function LatencyGrid({ d }: { d: XIntelligenceDashboard }) {
  const sections: { label: string; data: XIntelligenceDashboard["latency"]["detection"] }[] = [
    { label: "Detection", data: d.latency.detection },
    { label: "Classification", data: d.latency.classification },
    { label: "Market check", data: d.latency.marketCheck },
    { label: "Signal", data: d.latency.signal },
    { label: "Total", data: d.latency.total },
  ];
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-medium">Latency percentiles (24h)</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {sections.map(({ label, data }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
            <p className="mt-2 font-mono text-sm tabular">
              p50 {fmtLatency(data.p50)} · p95 {fmtLatency(data.p95)}
            </p>
            <p className="mt-1 font-mono text-xs tabular text-muted-foreground">
              p99 {fmtLatency(data.p99)} · max {fmtLatency(data.max)} · n={data.count}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function BreakingEvents({ d }: { d: XIntelligenceDashboard }) {
  const events = d.breakingEvents.slice(0, 12);
  if (!events.length) {
    return (
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium">Breaking events</h2>
        <p className="text-sm text-muted-foreground">No high-impact X events in the last 24 hours.</p>
      </section>
    );
  }
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-medium">Breaking events</h2>
      <div className="grid gap-3 lg:grid-cols-2">
        {events.map((e) => (
          <article key={e.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-snug">{e.body.slice(0, 180)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  @{e.username} · {e.eventType} · {e.category}
                </p>
              </div>
              <Badge variant={impactVariant(e.marketImpactScore)}>{e.marketImpactScore}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {e.affectedAssets.map((a) => (
                <span key={a} className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
                  {a}
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{e.signal.replace(/_/g, " ").toLowerCase()}</Badge>
              <Badge variant="outline">{e.marketReaction.replace(/_/g, " ")}</Badge>
              <span>conf {(e.confidence * 100).toFixed(0)}</span>
              <span>lat {fmtLatency(e.latency.totalLatencyMs)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function AccountPerformance({ d }: { d: XIntelligenceDashboard }) {
  const rows = d.accountPerformance.slice(0, 20);
  if (!rows.length) {
    return (
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium">Account performance</h2>
        <p className="text-sm text-muted-foreground">No watchlist account activity yet.</p>
      </section>
    );
  }
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-medium">Account performance</h2>
      <div className="rounded-xl border border-border bg-card">
        <div className="grid grid-cols-[1.2fr_0.6fr_0.8fr_1fr_0.8fr] gap-2 border-b border-border px-3 py-2 text-[11px] uppercase text-muted-foreground">
          <span>Account</span>
          <span>Tier</span>
          <span className="text-right">Posts</span>
          <span className="text-right">Market-moving</span>
          <span className="text-right">Avg impact</span>
        </div>
        {rows.map((r) => (
          <div
            key={r.username}
            className="grid grid-cols-[1.2fr_0.6fr_0.8fr_1fr_0.8fr] gap-2 border-b border-border px-3 py-2 last:border-0"
          >
            <span className="font-mono text-xs">@{r.username}</span>
            <span className="text-xs">{r.tier.replace("TIER_", "")}</span>
            <span className="text-right font-mono text-xs">{r.postsAnalysed}</span>
            <span className="text-right font-mono text-xs">{r.marketMovingPosts}</span>
            <span className="text-right font-mono text-xs">{r.avgImpact == null ? "—" : r.avgImpact.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentPosts({ d }: { d: XIntelligenceDashboard }) {
  const rows = d.recentPosts.slice(0, 20);
  if (!rows.length) {
    return (
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-medium">Recent X posts</h2>
        <p className="text-sm text-muted-foreground">No watchlist posts received yet.</p>
      </section>
    );
  }
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-medium">Recent X posts</h2>
      <div className="space-y-3">
        {rows.map((p) => (
          <article key={p.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{p.tier.replace("TIER_", "T")}</Badge>
              <span className="text-xs font-medium">@{p.username}</span>
              <span className="text-xs text-muted-foreground">{p.eventType}</span>
              <Badge variant={impactVariant(p.marketImpactScore)}>{p.marketImpactScore}</Badge>
            </div>
            <p className="mt-2 text-sm leading-relaxed">{p.body}</p>
            {p.affectedAssets.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{p.affectedAssets.join(" · ")}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{p.signal.replace(/_/g, " ").toLowerCase()}</span>
              <span>·</span>
              <span>{p.marketReaction.replace(/_/g, " ")}</span>
              <span>·</span>
              <span>conf {(p.confidence * 100).toFixed(0)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
