import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchDetectedEvents } from "@/lib/aether/api";
import { formatAge } from "@/lib/aether/time";
import { ErrorState, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/events")({ component: EventsPage });

function EventsPage() {
  const q = useQuery({ queryKey: ["events"], queryFn: () => fetchDetectedEvents() });
  return (
    <div>
      <PageHeader
        kicker="Context"
        title="Event intelligence"
        description="Monitored entities, market-moving events, and cross-asset relevance. Probabilistic only — not a forecast."
      />
      {q.isLoading ? <Skeleton className="h-96 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {q.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No monitored events detected yet. News feeds and Polymarket shifts are scanned every ingest.</p>
        ) : (
          q.data?.map((e) => (
            <div key={e.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{e.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {e.source} · {e.eventType} · {e.category}
                    {e.publishedAt ? ` · ${formatAge(Date.now() - Date.parse(e.publishedAt))} old` : null}
                  </p>
                </div>
                <Badge variant={e.confidence > 0.65 ? "up" : "outline"}>{(e.confidence * 100).toFixed(0)} conf</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {e.entityId ? <Badge variant="outline">{e.entityId}</Badge> : null}
                <Badge variant="outline">novelty {(e.novelty * 100).toFixed(0)}</Badge>
                <Badge variant="outline">cred {(e.credibility * 100).toFixed(0)}</Badge>
                <Badge variant="outline">relevance {(e.marketRelevance * 100).toFixed(0)}</Badge>
                {e.sentiment != null ? (
                  <Badge variant={e.sentiment > 0 ? "up" : "down"}>{e.sentiment > 0 ? "bull" : "bear"} {(e.sentiment * 100).toFixed(0)}</Badge>
                ) : null}
              </div>
              {e.affectedAssets.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {e.affectedAssets.map((a) => (
                    <span key={a} className="rounded bg-muted px-2 py-1 font-mono text-[11px]">
                      {a}
                    </span>
                  ))}
                </div>
              ) : null}
              {e.url ? (
                <a href={e.url} target="_blank" rel="noreferrer" className="mt-3 block text-xs text-muted-foreground hover:underline">
                  Source
                </a>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">{e.historicalContext}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
