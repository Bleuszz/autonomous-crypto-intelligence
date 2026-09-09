import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchOpportunities } from "@/lib/aether/api";
import { ErrorState, OpportunityRow, PageHeader } from "@/components/desk";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/opportunities")({ component: OpportunitiesPage });

function OpportunitiesPage() {
  const q = useQuery({ queryKey: ["opportunities"], queryFn: () => fetchOpportunities() });
  return (
    <div>
      <PageHeader
        kicker="Intel"
        title="Opportunities"
        description="Composite rank is configurable and explainable. High percentage gain is not sufficient — thin books and mint risk are penalised."
      />
      {q.isLoading ? <Skeleton className="h-96 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      {q.data ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.6fr_88px] border-b border-border px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground sm:grid">
            <span>Asset</span>
            <span>Price</span>
            <span>24h</span>
            <span>Liquidity</span>
            <span>Score</span>
            <span>7d</span>
          </div>
          {q.data.map((row) => (
            <OpportunityRow key={row.asset.id} row={row} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
