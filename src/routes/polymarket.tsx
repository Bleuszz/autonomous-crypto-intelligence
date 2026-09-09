import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchPolymarketFeed } from "@/lib/aether/api";
import { fmtPct, fmtUsd, signedClass } from "@/lib/aether/format";
import { ErrorState, PageHeader } from "@/components/desk";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/polymarket")({ component: PolymarketPage });

function PolymarketPage() {
  const q = useQuery({ queryKey: ["polymarket"], queryFn: () => fetchPolymarketFeed() });
  return (
    <div>
      <PageHeader
        kicker="Context"
        title="Polymarket"
        description="Public Gamma discovery. Used as an information source, not a trading venue. Probability shifts are coincident observations — causation is not assumed."
      />
      {q.isLoading ? <Skeleton className="h-80 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Market</th>
              <th className="px-3 py-2 font-medium">Yes</th>
              <th className="px-3 py-2 font-medium">24h Δ</th>
              <th className="px-3 py-2 font-medium">Volume</th>
              <th className="px-3 py-2 font-medium">Liquidity</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.map((m) => (
              <tr key={m.id} className="border-b border-border last:border-0">
                <td className="px-3 py-3">
                  <a href={m.url ?? "https://polymarket.com"} target="_blank" rel="noreferrer" className="hover:underline">
                    {m.question}
                  </a>
                </td>
                <td className="px-3 py-3 font-mono tabular">
                  {m.probability == null ? "—" : `${(m.probability <= 1 ? m.probability * 100 : m.probability).toFixed(1)}%`}
                </td>
                <td className={cn("px-3 py-3 font-mono tabular", signedClass(m.probabilityChange24h))}>
                  {m.probabilityChange24h == null ? "—" : fmtPct(m.probabilityChange24h * 100)}
                </td>
                <td className="px-3 py-3 font-mono tabular text-muted-foreground">{fmtUsd(m.volume24h ?? m.volume)}</td>
                <td className="px-3 py-3 font-mono tabular text-muted-foreground">{fmtUsd(m.liquidity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
