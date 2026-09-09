import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchPaper } from "@/lib/aether/api";
import { fmtPct, fmtUsd, signedClass } from "@/lib/aether/format";
import { ErrorState, Kpi, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/paper")({ component: PaperPage });

function PaperPage() {
  const q = useQuery({ queryKey: ["paper"], queryFn: () => fetchPaper() });

  if (q.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (q.error) return <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} />;
  const p = q.data!;
  const ret = p.startingEquityUsd ? ((p.equityUsd - p.startingEquityUsd) / p.startingEquityUsd) * 100 : 0;

  return (
    <div>
      <PageHeader
        kicker="Desk"
        title="Paper portfolio"
        description="Live marks in, simulated fills out. Latency, impact, DEX fees and gas are modelled. This is not live trading and is not a claim of edge."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant="paper">PAPER</Badge>
        <Badge variant="outline">{p.positions.length} open</Badge>
        <Badge variant="outline">{p.nTrades} fills</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Equity" value={fmtUsd(p.equityUsd)} hint={`Cash ${fmtUsd(p.cashUsd)}`} tone={ret >= 0 ? "up" : "down"} />
        <Kpi label="Total return" value={fmtPct(ret)} hint={`Realized ${fmtUsd(p.realizedPnlUsd)}`} />
        <Kpi label="Day P/L" value={fmtUsd(p.dayPnlUsd)} hint={fmtPct(p.dayPnlPct)} tone={p.dayPnlUsd >= 0 ? "up" : "down"} />
        <Kpi label="Costs" value={fmtUsd(p.feesPaidUsd + p.slippagePaidUsd)} hint={`Fees ${fmtUsd(p.feesPaidUsd)}`} />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <p className="mb-3 text-sm font-medium">Equity curve</p>
        {p.equityCurve.length < 2 ? (
          <p className="text-sm text-muted-foreground">Curve appears after the first mark-to-market snapshots.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={p.equityCurve}>
                <XAxis dataKey="t" hide />
                <YAxis hide domain={["dataMin", "dataMax"]} />
                <Tooltip
                  contentStyle={{ background: "#16161a", border: "1px solid rgb(244 244 245 / 0.12)", fontSize: 12 }}
                  formatter={(v: number) => fmtUsd(v)}
                />
                <Area type="monotone" dataKey="equity" stroke="var(--color-paper)" fill="var(--color-muted)" fillOpacity={0.35} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-3 text-sm font-medium">Positions</p>
          {p.positions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Flat. Waiting for the next quality entry on live marks.</p>
          ) : (
            p.positions.map((pos) => (
              <div key={pos.id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
                <div>
                  <p className="text-sm font-medium">{pos.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    {pos.qty.toPrecision(4)} @ {fmtUsd(pos.avgPrice)} · mark {fmtUsd(pos.mark)}
                  </p>
                </div>
                <p className={cn("font-mono text-sm tabular", signedClass(pos.unrealizedPnlUsd))}>
                  {fmtUsd(pos.unrealizedPnlUsd)} {fmtPct(pos.unrealizedPnlPct)}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-3 text-sm font-medium">Fills</p>
          {p.recentFills.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No fills yet this book. Entries need a fresh mark, size vs liquidity, and a non-social-proxy setup.</p>
          ) : (
            p.recentFills.slice(0, 14).map((f) => (
              <div key={f.id} className="flex items-center justify-between border-b border-border px-4 py-3 last:border-0">
                <div>
                  <p className="text-sm">
                    {f.side} {f.symbol}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    slip {f.slippageBps.toFixed(0)} bps · fee {fmtUsd(f.feeUsd)} · {f.model}
                  </p>
                </div>
                <p className="font-mono text-sm tabular">{fmtUsd(f.notionalUsd)}</p>
              </div>
            ))
          )}
        </div>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Rejected orders remain on the blotter. Live mode cannot be activated from this screen.
      </p>
      <div className="mt-2">
        <Button variant="outline" disabled>
          Enable live trading
        </Button>
      </div>
    </div>
  );
}
