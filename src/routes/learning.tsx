import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchLearningDashboard } from "@/lib/aether/api";
import { ErrorState, Kpi, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/learning")({ component: LearningPage });

function LearningPage() {
  const q = useQuery({ queryKey: ["learning"], queryFn: () => fetchLearningDashboard() });
  const data = q.data;

  return (
    <div>
      <PageHeader
        kicker="Desk"
        title="Learning engine"
        description="Shadow-mode learner that studies paper-trading decisions and extracts reproducible lessons. The learner does not control execution."
      />
      {q.isLoading ? <Skeleton className="h-96 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      {!data ? null : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Learner version" value={data.overview.learnerVersion} hint={data.overview.status} />
            <Kpi
              label="Experiences"
              value={data.overview.experiences.toLocaleString()}
              hint={`+${data.overview.positiveRewards} / -${data.overview.negativeRewards}`}
            />
            <Kpi
              label="Avg reward"
              value={data.overview.averageReward != null ? data.overview.averageReward.toFixed(3) : "—"}
              tone={data.overview.averageReward != null && data.overview.averageReward > 0 ? "up" : data.overview.averageReward != null && data.overview.averageReward < 0 ? "down" : "plain"}
            />
            <Kpi
              label="Patterns"
              value={`${data.overview.approvedPatterns}/${data.overview.patterns}`}
              hint={`${data.overview.shadowPatterns} shadow`}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-medium">Learner status</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Champion: {data.overview.championVersion ?? "none"} · Challenger: {data.overview.challengerVersion ?? "none"}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                The learner is in shadow mode. It predicts and records what it would recommend, but it does not alter paper execution.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-medium">Lessons</h2>
              <p className="mt-1 text-2xl font-mono tabular">{data.overview.lessons.toLocaleString()}</p>
              <p className="mt-1 text-xs text-muted-foreground">Extracted from completed trades and discovered patterns.</p>
            </div>
          </div>

          <div className="mt-6">
            <h2 className="mb-3 text-sm font-medium">Discovered patterns</h2>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2">Pattern</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Samples</th>
                    <th className="px-3 py-2">Win rate</th>
                    <th className="px-3 py-2">Expectancy</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.patterns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                        No patterns discovered yet. Complete more paper round-trips to generate evidence.
                      </td>
                    </tr>
                  ) : (
                    data.patterns.slice(0, 50).map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-3 text-xs">{p.description}</td>
                        <td className="px-3 py-3">
                          <Badge variant={p.action === "ENTER" ? "up" : p.action === "REJECT" ? "down" : "outline"}>{p.action}</Badge>
                        </td>
                        <td className="px-3 py-3 font-mono tabular">{p.sampleCount}</td>
                        <td className="px-3 py-3 font-mono tabular">{p.winRate != null ? `${(p.winRate * 100).toFixed(0)}%` : "—"}</td>
                        <td className={cn("px-3 py-3 font-mono tabular", (p.expectancy ?? 0) > 0 ? "text-up" : (p.expectancy ?? 0) < 0 ? "text-down" : "")}>
                          {p.expectancy != null ? p.expectancy.toFixed(3) : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={p.status === "APPROVED" ? "up" : p.status === "REJECTED" ? "down" : "outline"}>{p.status}</Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <h2 className="mb-3 text-sm font-medium">Strong trades</h2>
              <div className="grid gap-3">
                {data.goodTrades.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No strong positive trades yet.</p>
                ) : (
                  data.goodTrades.slice(0, 10).map((t) => (
                    <div key={t.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{t.snapshot.symbol}</p>
                        <Badge variant="up">{t.totalReward.toFixed(2)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Return {t.outcome.realizedReturnPct.toFixed(2)}% · {t.decisionOutcomeClass}
                      </p>
                      {t.attributions.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.attributions
                            .filter((a) => a.contribution === "POSITIVE" || a.contribution === "STRONGLY_POSITIVE")
                            .slice(0, 4)
                            .map((a) => (
                              <Badge key={a.id} variant="outline" className="text-up">
                                {a.featureName}
                              </Badge>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-medium">Weak trades</h2>
              <div className="grid gap-3">
                {data.badTrades.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No strong negative trades yet.</p>
                ) : (
                  data.badTrades.slice(0, 10).map((t) => (
                    <div key={t.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{t.snapshot.symbol}</p>
                        <Badge variant="down">{t.totalReward.toFixed(2)}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Return {t.outcome.realizedReturnPct.toFixed(2)}% · {t.avoidableLoss ?? "unknown"} · {t.decisionOutcomeClass}
                      </p>
                      {t.attributions.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {t.attributions
                            .filter((a) => a.contribution === "NEGATIVE" || a.contribution === "STRONGLY_NEGATIVE")
                            .slice(0, 4)
                            .map((a) => (
                              <Badge key={a.id} variant="outline" className="text-down">
                                {a.featureName}
                              </Badge>
                            ))}
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
