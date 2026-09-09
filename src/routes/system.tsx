import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchSystem, postKillSwitch, refreshNow } from "@/lib/aether/api";
import { ErrorState, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/system")({ component: SystemPage });

function SystemPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["system"], queryFn: () => fetchSystem() });
  const kill = useMutation({
    mutationFn: (on: boolean) => postKillSwitch({ data: { on } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["system"] }),
  });
  const refresh = useMutation({
    mutationFn: () => refreshNow(),
    onSuccess: () => qc.invalidateQueries(),
  });

  if (q.isLoading) return <Skeleton className="h-80 rounded-xl" />;
  if (q.error) return <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} />;
  const s = q.data!;

  return (
    <div>
      <PageHeader
        kicker="Ops"
        title="System"
        description="Health, freshness, live-trading gates (all closed), and the global kill switch."
        action={
          <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
            Force ingest
          </Button>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge variant="paper">{s.tradingMode}</Badge>
        <Badge variant="outline">DB {s.dbSource}</Badge>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          Kill switch
          <Switch checked={s.killSwitch} onCheckedChange={(v) => kill.mutate(Boolean(v))} />
        </label>
      </div>

      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Live execution gates</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          All gates are fail-closed. An API key alone cannot arm live trading. This build refuses live submission even if every gate is later flipped.
        </p>
        <ul className="mt-4 space-y-2">
          {s.liveGates.map((g) => (
            <li key={g.name} className="flex items-start justify-between gap-3 text-sm">
              <span>{g.name}</span>
              <span className="max-w-[22rem] text-right text-xs text-muted-foreground">
                <Badge variant={g.passed ? "up" : "outline"}>{g.passed ? "pass" : "closed"}</Badge>
                <span className="mt-1 block">{g.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">X API budget</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Capped so a $5 credit lasts about a week. Live trading is not using this key.
        </p>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Configured</dt>
            <dd>{s.xUsage?.configured ? "yes" : "no"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Today</dt>
            <dd className="font-mono">
              {s.xUsage.callsToday}/{s.xUsage.dailyCap}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">This week</dt>
            <dd className="font-mono">
              {s.xUsage.callsWeek}/{s.xUsage.weeklyCap} · {s.xUsage.tweetsPulledWeek} tweets
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Next window</dt>
            <dd className="font-mono text-xs">{s.xUsage.nextCallAt ? s.xUsage.nextCallAt.replace("T", " ").slice(0, 19) : "—"}</dd>
          </div>
        </dl>
        {s.xUsage.lastError ? <p className="mt-2 text-xs text-muted-foreground">{s.xUsage.lastError}</p> : null}
        <p className="mt-2 text-[11px] text-muted-foreground">Market poll every {Math.round(s.pollMs / 1000)}s (free sources). X is not on that cadence.</p>
      </section>

      <section className="mb-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Last ingest</h2>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          {s.lastIngest.status} · {s.lastIngest.durationMs ?? "—"} ms · assets {s.lastIngest.assetsUpserted ?? "—"} · signals {s.lastIngest.signalsCreated ?? "—"}
        </p>
        {s.lastIngest.errors.length ? (
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
            {s.lastIngest.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No ingest errors recorded.</p>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card">
        <p className="border-b border-border px-5 py-3 text-sm font-medium">Sources</p>
        <ul>
          {s.sources.map((src) => (
            <li key={src.source} className="flex items-center justify-between border-b border-border px-5 py-3 last:border-0">
              <div>
                <p className="text-sm">{src.source}</p>
                <p className="text-[11px] text-muted-foreground">{src.lastError ?? "ok"} · {src.latencyMs ?? "—"} ms</p>
              </div>
              <Badge variant={src.status === "up" ? "up" : src.status === "degraded" ? "warn" : "down"}>{src.status}</Badge>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
