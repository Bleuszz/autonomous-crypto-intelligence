import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchNewsFeed } from "@/lib/aether/api";
import { formatAge } from "@/lib/aether/time";
import { ErrorState, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/news")({ component: NewsPage });

function NewsPage() {
  const q = useQuery({ queryKey: ["news"], queryFn: () => fetchNewsFeed() });
  return (
    <div>
      <PageHeader
        kicker="Context"
        title="News"
        description="Primary-source RSS plus exchange of timestamps. A 12-hour-old story is labelled STALE and cannot masquerade as breaking."
      />
      {q.isLoading ? <Skeleton className="h-80 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      <div className="space-y-3">
        {q.data?.map((n) => (
          <a
            key={n.id}
            href={n.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/40"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={n.freshness === "NEW" ? "up" : n.freshness === "RECENT" ? "outline" : "warn"}>{n.freshness}</Badge>
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{n.source}</span>
              <span className="text-[11px] text-muted-foreground">{formatAge(n.ageMs)} ago</span>
              <span className="text-[11px] text-muted-foreground">rel {(n.sourceReliability * 100).toFixed(0)}</span>
            </div>
            <p className="mt-2 text-sm font-medium">{n.title}</p>
            {n.entities.length ? (
              <p className="mt-1 text-xs text-muted-foreground">Entities {n.entities.join(", ")}</p>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  );
}
