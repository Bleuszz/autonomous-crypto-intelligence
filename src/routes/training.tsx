import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { fetchTrainingDashboard } from "@/lib/aether/api";
import { EmptyState, ErrorState, Kpi, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtPct } from "@/lib/aether/format";

export const Route = createFileRoute("/training")({ component: TrainingPage });

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "INSUFFICIENT EVIDENCE";
  return n.toFixed(digits);
}

function TrainingPage() {
  const q = useQuery({
    queryKey: ["training"],
    queryFn: () => fetchTrainingDashboard(),
    staleTime: 20_000,
  });

  if (q.error && !q.data) return <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} />;
  if (!q.data) {
    return (
      <div>
        <PageHeader kicker="Training" title="Research laboratory" description="Loading training, data-quality and capital-scale state." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }
  const d = q.data;
  const gate = d.scale.gate;

  return (
    <div>
      <PageHeader
        kicker="Training"
        title="Paper training laboratory"
        description="£100,000 is a research book for experience throughput. The realistic deployment gate is £100. Live execution stays compiled out."
        action={
          <Link to="/learning" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Learner dashboard
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Badge variant="paper">PAPER ONLY</Badge>
        <Badge variant="outline">Research £{d.capital.researchEquityGbp.toLocaleString()}</Badge>
        <Badge variant="outline">Realistic £{d.capital.realisticEquityGbp}</Badge>
        <Badge variant={d.capital.fxStatus === "live" ? "outline" : "warn"}>
          GBPUSD {d.capital.gbpUsd != null ? d.capital.gbpUsd.toFixed(4) : "DATA UNAVAILABLE"}
        </Badge>
        <Badge variant={gate.ready ? "up" : "warn"}>{gate.label}</Badge>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Data-quality samples" value={String(d.quality.samples)} hint={d.quality.avgScore != null ? `avg ${d.quality.avgScore.toFixed(0)}` : "awaiting ingest"} />
        <Kpi label="ENTER / WAIT / REJECT" value={`${d.decisions.enter} / ${d.decisions.wait} / ${d.decisions.reject}`} hint="WAIT is a real decision" />
        <Kpi label="Independent experiences" value={fmt(d.experiences.independent, 1)} hint={`${d.experiences.total} raw`} />
        <Kpi label="Capital class" value={d.scale.classification} hint="£100 gate overrides £100k" />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data quality</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Conflict rate {fmtPct(d.quality.conflictRate * 100)} · delayed {fmtPct(d.quality.delayedRate * 100)} · stale {fmtPct(d.quality.staleRate * 100)} · fake-move {fmtPct(d.quality.fakeMoveRate * 100)} · missing {fmtPct(d.quality.missingRate * 100)}</p>
            <p className="text-muted-foreground">One source is never treated as truth. Delayed data lowers confidence. Unconfirmed pumps are blocked or down-weighted.</p>
            {d.quality.latest.length === 0 ? (
              <EmptyState title="No quality samples yet" body="They appear after the next market ingest." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1">Asset</th>
                      <th>Score</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.quality.latest.map((r) => (
                      <tr key={`${r.assetId}:${r.observedAt}`} className="border-t border-border/60">
                        <td className="py-1 font-medium">{r.symbol}</td>
                        <td>{r.score.toFixed(0)}{r.blockEntry ? " · BLOCK" : ""}</td>
                        <td className="text-muted-foreground">{r.flags.slice(0, 3).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Capital scale</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">{d.scale.classificationReason}</p>
            <p>{gate.reasons[0]}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="py-1">Book</th>
                    <th>Trades</th>
                    <th>Rejected</th>
                    <th>Return</th>
                    <th>DD</th>
                    <th>Sharpe</th>
                    <th>Expectancy</th>
                  </tr>
                </thead>
                <tbody>
                  {d.scale.reports.map((r) => (
                    <tr key={r.equityGbp} className="border-t border-border/60">
                      <td className="py-1">£{r.equityGbp.toLocaleString()}</td>
                      <td>{r.nTrades}</td>
                      <td>{r.nRejected}</td>
                      <td>{r.notes === "INSUFFICIENT EVIDENCE" ? "—" : `${r.returnPct.toFixed(2)}%`}</td>
                      <td>{r.notes === "INSUFFICIENT EVIDENCE" ? "—" : `${r.maxDrawdownPct.toFixed(1)}%`}</td>
                      <td>{r.notes === "INSUFFICIENT EVIDENCE" ? "—" : r.sharpe.toFixed(2)}</td>
                      <td>{r.notes === "INSUFFICIENT EVIDENCE" ? "INSUFFICIENT EVIDENCE" : r.expectancy.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Experience diversity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Unique assets {d.experiences.uniqueAssets} · regimes {d.experiences.uniqueRegimes}</p>
            <p>WAIT {d.experiences.wait} · REJECT {d.experiences.reject} · negative {d.experiences.negative}</p>
            <p>Train {d.experiences.train} · val {d.experiences.validation} · OOS {d.experiences.oos} · walk-forward {d.experiences.walkForward}</p>
            <p>Historical {d.experiences.historical} · live {d.experiences.live} · duplicate rate {fmtPct(d.experiences.duplicateRate * 100)}</p>
            <p>Calibration: {d.calibration.notes} {d.calibration.avgReward != null ? `(avg reward ${d.calibration.avgReward.toFixed(3)})` : ""}</p>
            <p className={d.contamination.ok ? "text-muted-foreground" : "text-destructive"}>{d.contamination.reason}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Survivorship · clusters · decay</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>{d.survivorship.note}</p>
            <p>Event clusters {d.clusters.n} ({d.clusters.multiSource} multi-source — duplicates do not multiply evidence)</p>
            <p>Information decay samples {d.decay.samples} · remaining edge {d.decay.avgRemainingEdge == null ? "INSUFFICIENT EVIDENCE" : fmtPct(d.decay.avgRemainingEdge * 100)}</p>
            <p>Latency — detect {d.latency.detectionMs == null ? "DATA UNAVAILABLE" : `${Math.round(d.latency.detectionMs / 1000)}s`} · analyse {d.latency.analysisMs == null ? "DATA UNAVAILABLE" : `${Math.round(d.latency.analysisMs / 1000)}s`} · reaction {d.latency.reactionMs == null ? "DATA UNAVAILABLE" : `${Math.round(d.latency.reactionMs / 1000)}s`}</p>
            <p>Last replay: {d.replay.lastNotes ?? "none yet"} {d.replay.lookaheadFailures ? `· lookahead failures ${d.replay.lookaheadFailures}` : ""}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Honesty</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {d.honesty.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
