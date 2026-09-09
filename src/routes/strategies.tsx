import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchStrategies } from "@/lib/aether/api";
import { ErrorState, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/strategies")({ component: StrategiesPage });

function StrategiesPage() {
  const q = useQuery({ queryKey: ["strategies"], queryFn: () => fetchStrategies(), refetchInterval: false });
  return (
    <div>
      <PageHeader
        kicker="Desk"
        title="Strategies"
        description="Versioned registry. Historical versions are not overwritten. New strategies must pass backtest, out-of-sample, paper trading and an explicit activation before live — and live remains compiled out."
      />
      {q.isLoading ? <Skeleton className="h-64 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {q.data?.map((s) => (
          <article key={s.id} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-medium">{s.name}</h2>
              <Badge variant={s.enabled ? "outline" : "warn"}>{s.enabled ? "enabled" : "paused"}</Badge>
            </div>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {s.id} · v{s.version}
            </p>
            <p className="mt-3 text-sm text-muted-foreground">{s.description}</p>
            <pre className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {JSON.stringify(s.params, null, 2)}
            </pre>
          </article>
        ))}
      </div>
    </div>
  );
}
