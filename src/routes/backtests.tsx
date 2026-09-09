import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchBacktests, postBacktest } from "@/lib/aether/api";
import { fmtPct } from "@/lib/aether/format";
import { ErrorState, Kpi, PageHeader } from "@/components/desk";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/backtests")({ component: BacktestsPage });

function BacktestsPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["backtests"],
    queryFn: () => fetchBacktests(),
    refetchInterval: false,
  });
  const run = useMutation({
    mutationFn: (pair: "XBTUSD" | "ETHUSD") => postBacktest({ data: { pair } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["backtests"] }),
  });
  const latest = q.data?.[0];

  return (
    <div>
      <PageHeader
        kicker="Desk"
        title="Backtests"
        description="Walk-forward momentum on Kraken daily candles. Buys fill at the next bar open. Costs applied. Highest historical return is not used for selection."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => run.mutate("XBTUSD")} disabled={run.isPending}>
              Run BTC daily
            </Button>
            <Button variant="outline" onClick={() => run.mutate("ETHUSD")} disabled={run.isPending}>
              Run ETH daily
            </Button>
          </div>
        }
      />
      {run.isPending ? <p className="mb-4 text-sm text-muted-foreground">Running walk-forward…</p> : null}
      {run.error ? <ErrorState message={run.error instanceof Error ? run.error.message : "Failed"} /> : null}
      {q.isLoading ? <Skeleton className="h-64 rounded-xl" /> : null}
      {!latest ? (
        <p className="text-sm text-muted-foreground">No runs stored yet. Execute a walk-forward on BTC or ETH.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="OOS return" value={fmtPct(latest.metrics.totalReturnPct)} />
            <Kpi label="Sharpe" value={latest.metrics.sharpe.toFixed(2)} />
            <Kpi label="Max DD" value={fmtPct(latest.metrics.maxDrawdownPct)} tone="warn" />
            <Kpi label="Win rate" value={fmtPct(latest.metrics.winRate * 100, 1)} hint={`${latest.metrics.nTrades} trades`} />
          </div>
          <div className="mt-6 rounded-xl border border-border bg-card p-4">
            <p className="mb-2 text-sm font-medium">Full-sample equity (inspection only)</p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={latest.equityCurve}>
                  <XAxis dataKey="t" hide />
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Tooltip contentStyle={{ background: "#16161a", border: "1px solid rgb(244 244 245 / 0.12)", fontSize: 12 }} />
                  <Area type="monotone" dataKey="equity" stroke="var(--color-foreground)" fill="var(--color-muted)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">{latest.notes}</p>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">OOS ret</th>
                  <th className="px-3 py-2">Sharpe</th>
                  <th className="px-3 py-2">Trades</th>
                </tr>
              </thead>
              <tbody>
                {q.data?.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{b.createdAt.replace("T", " ").slice(0, 19)}</td>
                    <td className="px-3 py-2">{b.assetId}</td>
                    <td className="px-3 py-2 font-mono tabular">{fmtPct(b.metrics.totalReturnPct)}</td>
                    <td className="px-3 py-2 font-mono tabular">{b.metrics.sharpe.toFixed(2)}</td>
                    <td className="px-3 py-2">{b.metrics.nTrades}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
