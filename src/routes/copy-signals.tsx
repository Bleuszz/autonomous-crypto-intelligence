import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchCopySignals } from "@/lib/aether/api";
import { shortAddr } from "@/lib/aether/format";
import { ErrorState, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/copy-signals")({ component: CopySignalsPage });

function CopySignalsPage() {
  const q = useQuery({ queryKey: ["copySignals"], queryFn: () => fetchCopySignals() });
  return (
    <div>
      <PageHeader
        kicker="Context"
        title="Polymarket copy signals"
        description="Observed fills from scored Polymarket wallets. Copy is paper-only and delayed — observed prints are not executable."
      />
      {q.isLoading ? <Skeleton className="h-96 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2">Wallet</th>
              <th className="px-3 py-2">Side</th>
              <th className="px-3 py-2">Quality</th>
              <th className="px-3 py-2">Latency</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Expected value</th>
              <th className="px-3 py-2">Reasons</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No qualified Polymarket wallet signals yet. Wallets need ≥3 trades and a quality score above the threshold.
                </td>
              </tr>
            ) : (
              q.data?.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 font-mono text-xs">{shortAddr(s.address)}</td>
                  <td className="px-3 py-3">
                    <Badge variant={s.side === "buy" ? "up" : "down"}>{s.side}</Badge>
                  </td>
                  <td className="px-3 py-3 font-mono tabular">{(s.walletQualityScore * 100).toFixed(0)}</td>
                  <td className="px-3 py-3 font-mono tabular text-muted-foreground">{s.latencySeconds.toFixed(0)}s</td>
                  <td className="px-3 py-3 font-mono tabular">{(s.copyConfidence * 100).toFixed(0)}</td>
                  <td className={cn("px-3 py-3 font-mono tabular", s.expectedValue > 0 ? "text-up" : "text-down")}>
                    {s.expectedValue.toFixed(3)}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {s.reasons.slice(0, 3).join(" · ")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
