import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchSocialFeed } from "@/lib/aether/api";
import { ErrorState, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/social")({ component: SocialPage });

function SocialPage() {
  const q = useQuery({ queryKey: ["social"], queryFn: () => fetchSocialFeed() });
  return (
    <div>
      <PageHeader
        kicker="Context"
        title="Social"
        description="Official X recent-search is on a hard budget (~$5/week): one compact query, 10 posts, at most eight calls a day and three hours between them. Posts are not treated as true."
      />
      {q.isLoading ? <Skeleton className="h-80 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      {q.data?.xUsage ? (
        <p className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          {q.data.xUsage.configured ? (
            <>
              X live · {q.data.xUsage.callsToday}/{q.data.xUsage.dailyCap} calls today · {q.data.xUsage.callsWeek}/
              {q.data.xUsage.weeklyCap} this week
              {q.data.xUsage.nextCallAt ? ` · next window ${q.data.xUsage.nextCallAt.replace("T", " ").slice(11, 19)} UTC` : ""}
              {q.data.xUsage.lastError ? ` · ${q.data.xUsage.lastError}` : ""}
            </>
          ) : (
            <>Official X recent-search is not configured.</>
          )}
        </p>
      ) : null}
      <div className="space-y-3">
        {q.data?.posts.map((p) => (
          <article key={p.id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{p.platform}</Badge>
              <Badge variant={p.freshness === "NEW" ? "up" : "outline"}>{p.freshness}</Badge>
              {p.author ? <span className="text-xs text-muted-foreground">{p.author}</span> : null}
            </div>
            <p className="mt-2 text-sm leading-relaxed">{p.body}</p>
            {p.entities.length ? <p className="mt-2 text-xs text-muted-foreground">{p.entities.join(" · ")}</p> : null}
          </article>
        ))}
      </div>
    </div>
  );
}
