import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { fetchOverview, refreshNow } from "@/lib/aether/api";
import { fmtPct, fmtUsd, signedClass } from "@/lib/aether/format";
import { formatUtc } from "@/lib/aether/time";
import { EmptyState, ErrorState, Kpi, OpportunityRow, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  loader: () => fetchOverview(),
  component: Home,
});

function Home() {
  const qc = useQueryClient();
  const initial = Route.useLoaderData();
  const q = useQuery({
    queryKey: ["overview"],
    queryFn: () => fetchOverview(),
    initialData: initial,
    staleTime: 20_000,
  });
  const refresh = useMutation({
    mutationFn: () => refreshNow(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overview"] }),
  });

  if (q.error && !q.data) return <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} />;
  if (!q.data) {
    return (
      <div>
        <PageHeader
          kicker="Overview"
          title="Desk"
          description="Ingesting live markets, news, pools and prediction books. First pass can take a short while."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  const d = q.data;
  const pnlTone = d.portfolio.equityUsd >= d.portfolio.startingEquityUsd ? "up" : "down";

  return (
    <div>
      <PageHeader
        kicker="Overview"
        title="Desk"
        description="Ranked opportunities from independent sources. Paper trading is the only execution path."
        action={
          <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            <RefreshCw className={cn("size-4", refresh.isPending && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant="paper">PAPER</Badge>
        {d.killSwitch ? <Badge variant="down">Kill switch</Badge> : <Badge variant="outline">Orders armed (paper)</Badge>}
        <Badge variant="outline">Snapshot {formatUtc(d.lastIngestAt)}</Badge>
        <Badge variant="outline">
          {d.scanCapacity.majors} majors · {d.scanCapacity.dex} dex · {d.scanCapacity.ranked} ranked
        </Badge>
        {d.xUsage ? (
          <Badge variant={d.xUsage.configured ? "outline" : "warn"}>
            {d.xUsage.configured
              ? `X ${d.xUsage.callsToday}/${d.xUsage.dailyCap} today`
              : "X off"}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Paper equity" value={fmtUsd(d.portfolio.equityUsd)} hint={`Start ${fmtUsd(d.portfolio.startingEquityUsd)}`} tone={pnlTone} />
        <Kpi
          label="Day P/L"
          value={fmtUsd(d.portfolio.dayPnlUsd)}
          hint={fmtPct(d.portfolio.dayPnlPct)}
          tone={d.portfolio.dayPnlUsd >= 0 ? "up" : "down"}
        />
        <Kpi label="Open positions" value={d.portfolio.positions.length} hint={`${d.signals.length} open signals`} />
        <Kpi
          label="Regime"
          value={d.regime.label}
          hint={`F&G ${d.regime.fearGreed ?? "—"} · BTC ${fmtPct(d.regime.btcChange24h)}`}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Top opportunities</CardTitle>
            <Link to="/opportunities" className="text-xs text-muted-foreground hover:text-foreground">
              View all
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-2">
            {d.opportunities.length === 0 ? (
              <div className="px-5">
                <EmptyState title="No ranked assets yet" body="Wait for ingest or hit refresh." />
              </div>
            ) : (
              d.opportunities.slice(0, 8).map((row) => <OpportunityRow key={row.asset.id} row={row} />)
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Open signals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {d.signals.slice(0, 6).map((s) => (
                <Link key={s.id} to="/token/$assetId" params={{ assetId: s.assetId }} className="block">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm">
                      {s.symbol} <span className="text-muted-foreground">{s.strategyId}</span>
                    </p>
                    <p className="font-mono text-xs tabular">{(s.confidence * 100).toFixed(0)}%</p>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{s.explanation[0]}</p>
                </Link>
              ))}
              {d.signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No signals cleared the bar this cycle. That is expected.</p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Source health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {d.sources.slice(0, 8).map((s) => (
                <div key={s.source} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{s.source}</span>
                  <Badge variant={s.status === "up" ? "up" : s.status === "degraded" ? "warn" : "down"}>{s.status}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Newest news</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {d.news.slice(0, 5).map((n) => (
              <a key={n.id} href={n.url ?? "#"} target="_blank" rel="noreferrer" className="block">
                <div className="flex items-center gap-2">
                  <Badge variant={n.freshness === "NEW" ? "up" : n.freshness === "RECENT" ? "outline" : "warn"}>{n.freshness}</Badge>
                  <span className="text-[11px] text-muted-foreground">{n.source}</span>
                </div>
                <p className="mt-1 text-sm">{n.title}</p>
              </a>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Positions</CardTitle>
          </CardHeader>
          <CardContent>
            {d.portfolio.positions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No paper positions. The desk only trades when a signal clears risk, liquidity and confidence gates.
              </p>
            ) : (
              <ul className="space-y-2">
                {d.portfolio.positions.map((p) => (
                  <li key={p.id} className="flex items-center justify-between text-sm">
                    <span>{p.symbol}</span>
                    <span className={cn("font-mono tabular", signedClass(p.unrealizedPnlUsd))}>{fmtUsd(p.unrealizedPnlUsd)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
