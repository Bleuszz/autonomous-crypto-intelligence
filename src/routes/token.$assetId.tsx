import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchToken, postPaperTrade, postResearch } from "@/lib/aether/api";
import { fmtPct, fmtUsd, signedClass } from "@/lib/aether/format";
import { formatAge } from "@/lib/aether/time";
import { ErrorState, Kpi, PageHeader } from "@/components/desk";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/token/$assetId")({ component: TokenPage });

function TokenPage() {
  const { assetId } = Route.useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["token", assetId],
    queryFn: () => fetchToken({ data: { id: assetId } }),
  });
  const research = useMutation({
    mutationFn: () => postResearch({ data: { assetId } }),
    onSuccess: (res) => {
      if ("error" in res) toast.error(res.error);
      else {
        toast.message("Research filed");
        void qc.invalidateQueries({ queryKey: ["token", assetId] });
      }
    },
  });
  const trade = useMutation({
    mutationFn: (side: "buy" | "sell") => postPaperTrade({ data: { assetId, side, notionalUsd: 250 } }),
    onSuccess: (res) => {
      if (!res.ok) toast.error(res.error);
      else toast.message("Paper fill recorded");
      void qc.invalidateQueries();
    },
  });

  if (q.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (q.error) return <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} />;
  if (!q.data) return <ErrorState message="Asset not in the current universe." />;
  const t = q.data;
  const a = t.asset;
  const report = t.reports[0];

  return (
    <div>
      <PageHeader
        kicker={a.chainId ?? a.kind}
        title={`${a.symbol} · ${a.name}`}
        description={`${a.id} · observed ${formatAge(a.dataAgeMs)} ago · source ${a.source ?? "—"}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => trade.mutate("buy")} disabled={trade.isPending}>
              Paper buy $250
            </Button>
            <Button variant="outline" onClick={() => research.mutate()} disabled={research.isPending}>
              Run research
            </Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Badge variant="outline">{a.kind}</Badge>
        {t.rugRisk != null ? <Badge variant={t.rugRisk > 0.55 ? "down" : "outline"}>rug {t.rugRisk.toFixed(2)}</Badge> : null}
        {t.score != null ? <Badge variant="paper">score {(t.score * 100).toFixed(0)}</Badge> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Price" value={fmtUsd(a.priceUsd)} />
        <Kpi label="24h" value={fmtPct(a.change24hPct)} tone={(a.change24hPct ?? 0) >= 0 ? "up" : "down"} />
        <Kpi label="Liquidity" value={fmtUsd(a.liquidityUsd)} />
        <Kpi label="Volume 24h" value={fmtUsd(a.volume24hUsd)} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-medium">7d sparkline</p>
          <div className="mt-4">
            <Sparkline values={a.sparkline7d} className="h-16 w-full" />
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {(t.reasons ?? []).map((r) => (
              <li key={r} className="text-muted-foreground">
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-sm font-medium">Risk notes</p>
          <p className="mt-2 text-xs text-muted-foreground">Probabilistic language only. Never “safe”.</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            {t.risks.length === 0 ? <li>No dedicated security scan stored for this asset.</li> : null}
            {t.risks.map((r, i) => (
              <li key={i}>
                {r.kind} · {r.score.toFixed(2)} · {r.severity}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Research (FACT / INFERENCE / UNCERTAINTY / SPECULATION)</h2>
        <p className="mt-1 text-xs text-muted-foreground">User-initiated. The model may only use evidence supplied above.</p>
        {report ? (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Block title="FACT" body={report.fact} />
            <Block title="INFERENCE" body={report.inference} />
            <Block title="UNCERTAINTY" body={report.uncertainty} />
            <Block title="SPECULATION" body={report.speculation} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">No report yet.</p>
        )}
      </section>
      {a.contractAddress ? (
        <p className={cn("mt-4 font-mono text-xs text-muted-foreground", signedClass(0))}>{a.contractAddress}</p>
      ) : null}
    </div>
  );
}

function Block({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed">{body || "—"}</p>
    </div>
  );
}
