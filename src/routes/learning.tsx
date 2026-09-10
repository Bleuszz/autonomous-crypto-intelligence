import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchLearningDashboard, postLearnerMode } from "@/lib/aether/api";
import { EmptyState, ErrorState, Kpi, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LearnerOperatingMode, LearnerPrediction } from "@/lib/aether/learning/types";

export const Route = createFileRoute("/learning")({ component: LearningPage });

type SortKey = "actionAt" | "confidence" | "expectedReward" | "actualReward" | "correct";
type SortDir = "asc" | "desc";

function modeBadge(mode: LearnerOperatingMode) {
  switch (mode) {
    case "ACTIVE":
      return <Badge variant="up">ACTIVE</Badge>;
    case "SHADOW":
      return <Badge variant="paper">SHADOW</Badge>;
    case "DISABLED":
    default:
      return <Badge variant="outline">DISABLED</Badge>;
  }
}

function modeDescription(mode: LearnerOperatingMode) {
  switch (mode) {
    case "ACTIVE":
      return "The learner is ACTIVE inside the paper-trading research system. It may influence paper decisions, but it cannot execute live orders or bypass risk rules.";
    case "SHADOW":
      return "The learner is in SHADOW mode. It predicts and records what it would recommend, but it does not alter paper execution.";
    case "DISABLED":
      return "The learner is DISABLED. The baseline deterministic trading system continues normally; no learner predictions are recorded.";
  }
}

function fmtReward(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;
}

function fmtAccuracy(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "INSUFFICIENT EVIDENCE";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtConfidence(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function sortPredictions(rows: LearnerPrediction[], key: SortKey, dir: SortDir): LearnerPrediction[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let av: number | string | null;
    let bv: number | string | null;
    switch (key) {
      case "actionAt":
        av = a.actionAt;
        bv = b.actionAt;
        break;
      case "confidence":
        av = a.confidence;
        bv = b.confidence;
        break;
      case "expectedReward":
        av = a.expectedReward;
        bv = b.expectedReward;
        break;
      case "actualReward":
        av = a.actualReward ?? -Infinity;
        bv = b.actualReward ?? -Infinity;
        break;
      case "correct":
        av = a.correct === true ? 1 : a.correct === false ? 0 : -1;
        bv = b.correct === true ? 1 : b.correct === false ? 0 : -1;
        break;
    }
    if (av == null || bv == null) return 0;
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  });
  return sorted;
}

function PredictionTable({ rows }: { rows: LearnerPrediction[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "actionAt", dir: "desc" });
  const sorted = useMemo(() => sortPredictions(rows, sort.key, sort.dir), [rows, sort]);

  function header(key: SortKey, label: string) {
    const active = sort.key === key;
    const nextDir = active && sort.dir === "desc" ? "asc" : "desc";
    return (
      <th className="cursor-pointer px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground" onClick={() => setSort({ key, dir: nextDir })}>
        <span className={cn(active && "text-foreground")}>{label}</span>
        {active ? <span className="ml-1">{sort.dir === "desc" ? "↓" : "↑"}</span> : null}
      </th>
    );
  }

  if (!rows.length) {
    return <EmptyState title="No predictions yet" body="Learner predictions appear once the learner is SHADOW or ACTIVE and paper decisions are recorded." />;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="border-b border-border">
          <tr>
            {header("actionAt", "Time")}
            <th className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Asset</th>
            <th className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Learner</th>
            {header("confidence", "Confidence")}
            {header("expectedReward", "Exp. Reward")}
            <th className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Baseline</th>
            <th className="px-3 py-2 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Agree</th>
            {header("actualReward", "Actual Reward")}
            {header("correct", "Correct")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.snapshotId} className="border-b border-border last:border-0">
              <td className="px-3 py-3 font-mono text-xs tabular text-muted-foreground">{new Date(p.actionAt).toLocaleString()}</td>
              <td className="px-3 py-3 font-medium">{p.symbol}</td>
              <td className="px-3 py-3">
                <Badge variant={p.predictedAction === "ENTER" ? "up" : p.predictedAction === "REJECT" ? "down" : "outline"}>{p.predictedAction}</Badge>
              </td>
              <td className="px-3 py-3 font-mono tabular">{fmtConfidence(p.confidence)}</td>
              <td className={cn("px-3 py-3 font-mono tabular", p.expectedReward >= 0 ? "text-up" : "text-down")}>{fmtReward(p.expectedReward)}</td>
              <td className="px-3 py-3 font-mono tabular">{p.baselineAction}</td>
              <td className="px-3 py-3">
                {p.predictedAction === p.baselineAction ? (
                  <Badge variant="up">yes</Badge>
                ) : (
                  <Badge variant="down">no</Badge>
                )}
              </td>
              <td className="px-3 py-3 font-mono tabular">
                {p.resolved ? (
                  <span className={cn(p.actualReward! >= 0 ? "text-up" : "text-down")}>{fmtReward(p.actualReward)}</span>
                ) : (
                  <span className="text-muted-foreground">unresolved</span>
                )}
              </td>
              <td className="px-3 py-3">
                {p.correct === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : p.correct ? (
                  <Badge variant="up">yes</Badge>
                ) : (
                  <Badge variant="down">no</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartPanel({ title, children, empty }: { title: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <Card className="col-span-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {empty ? <EmptyState title="No time-series data" body="Complete more round-trips to render this chart." /> : <div className="h-52">{children}</div>}
      </CardContent>
    </Card>
  );
}

function LearningPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["learning"], queryFn: () => fetchLearningDashboard() });
  const data = q.data;

  const [pendingMode, setPendingMode] = useState<LearnerOperatingMode | null>(null);
  const [password, setPassword] = useState("");
  const [modeError, setModeError] = useState<string | null>(null);

  const changeMode = useMutation({
    mutationFn: (input: { mode: LearnerOperatingMode; password: string }) => postLearnerMode({ data: input }),
    onSuccess: (res) => {
      if (res.ok) {
        setPendingMode(null);
        setPassword("");
        setModeError(null);
        void qc.invalidateQueries({ queryKey: ["learning"] });
        void qc.invalidateQueries({ queryKey: ["learner-mode"] });
      } else {
        setModeError(res.error ?? "Change failed");
      }
    },
    onError: () => setModeError("Request failed"),
  });

  if (q.isLoading) return <Skeleton className="h-96 rounded-xl" />;
  if (q.error || !data) return <ErrorState message={q.error instanceof Error ? q.error.message : "Failed to load learning dashboard"} />;

  const stats = data.stats;
  const mode = data.mode;

  return (
    <div>
      <PageHeader
        kicker="Desk"
        title="Learning engine"
        description="Learner observability, prediction accuracy, and password-protected controls. The learner stays inside the paper-trading research system only."
      />

      {mode.mode === "ACTIVE" ? (
        <div className="mb-6 rounded-xl border border-up/30 bg-up/10 px-4 py-3">
          <p className="text-sm font-medium text-up">PAPER TRADING ONLY</p>
          <p className="text-xs text-muted-foreground">
            The learner is active inside the paper-trading research system. No live exchange orders can be executed, and hard risk rules remain authoritative.
          </p>
        </div>
      ) : null}

      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Learner control</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Status</span>
                {modeBadge(mode.mode)}
              </div>
              <p className="mt-2 max-w-2xl text-xs text-muted-foreground">{modeDescription(mode.mode)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Changed {mode.updatedAt ? new Date(mode.updatedAt).toLocaleString() : "never"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {mode.mode === "DISABLED" ? (
                <Button onClick={() => setPendingMode("SHADOW")}>Enable Shadow Learning</Button>
              ) : null}
              {mode.mode === "SHADOW" ? (
                <>
                  <Button onClick={() => setPendingMode("ACTIVE")}>Enable Active Learning</Button>
                  <Button variant="outline" onClick={() => setPendingMode("DISABLED")}>
                    Disable Learner
                  </Button>
                </>
              ) : null}
              {mode.mode === "ACTIVE" ? (
                <>
                  <Button variant="outline" onClick={() => setPendingMode("SHADOW")}>
                    Switch to Shadow
                  </Button>
                  <Button variant="outline" onClick={() => setPendingMode("DISABLED")}>
                    Disable Learner
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          {pendingMode ? (
            <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm font-medium">Confirm learner control</p>
              <p className="text-xs text-muted-foreground">Change mode to {pendingMode.toLowerCase()}.</p>
              <div className="mt-3 flex max-w-sm flex-col gap-3 sm:flex-row sm:items-center">
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") changeMode.mutate({ mode: pendingMode, password });
                  }}
                />
                <div className="flex gap-2">
                  <Button
                    disabled={changeMode.isPending || !password}
                    onClick={() => changeMode.mutate({ mode: pendingMode, password })}
                  >
                    Confirm
                  </Button>
                  <Button variant="ghost" onClick={() => { setPendingMode(null); setPassword(""); setModeError(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
              {modeError ? (
                <p className="mt-2 text-xs text-down">{modeError}. No changes were made.</p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
        <Kpi label="Learner version" value={data.overview.learnerVersion} hint={data.overview.status} />
        <Kpi
          label="Total predictions"
          value={stats.totalPredictions.toLocaleString()}
          hint={`${stats.resolvedPredictions} resolved · ${stats.unresolvedPredictions} unresolved`}
        />
        <Kpi
          label="Prediction accuracy"
          value={stats.resolvedPredictions ? fmtAccuracy(stats.overallAccuracy) : "NO DATA"}
          hint={stats.resolvedPredictions ? `${stats.correctPredictions} correct / ${stats.incorrectPredictions} incorrect` : "No resolved predictions yet"}
          tone={stats.overallAccuracy != null && stats.overallAccuracy > 0.55 ? "up" : stats.overallAccuracy != null && stats.overallAccuracy < 0.45 ? "down" : "plain"}
        />
        <Kpi
          label="Avg learner reward"
          value={stats.avgReward != null ? fmtReward(stats.avgReward) : "NO DATA"}
          tone={stats.avgReward != null && stats.avgReward > 0 ? "up" : stats.avgReward != null && stats.avgReward < 0 ? "down" : "plain"}
        />
        <Kpi label="Cumulative reward" value={fmtReward(stats.cumulativeReward)} tone={stats.cumulativeReward > 0 ? "up" : stats.cumulativeReward < 0 ? "down" : "plain"} />
        <Kpi
          label="Experiences"
          value={data.overview.experiences.toLocaleString()}
          hint={`+${data.overview.positiveRewards} / -${data.overview.negativeRewards}`}
        />
        <Kpi
          label="Patterns"
          value={`${data.overview.approvedPatterns}/${data.overview.patterns}`}
          hint={`${data.overview.shadowPatterns} shadow`}
        />
        <Kpi label="Lessons" value={data.overview.lessons.toLocaleString()} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Action-specific accuracy</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.byAction.length ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Predictions</th>
                      <th className="px-3 py-2">Resolved</th>
                      <th className="px-3 py-2">Correct</th>
                      <th className="px-3 py-2">Accuracy</th>
                      <th className="px-3 py-2">Avg confidence</th>
                      <th className="px-3 py-2">Avg reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byAction.map((a) => (
                      <tr key={a.action} className="border-b border-border last:border-0">
                        <td className="px-3 py-3">
                          <Badge variant={a.action === "ENTER" ? "up" : a.action === "REJECT" ? "down" : "outline"}>{a.action}</Badge>
                        </td>
                        <td className="px-3 py-3 font-mono tabular">{a.predictions}</td>
                        <td className="px-3 py-3 font-mono tabular">{a.resolved}</td>
                        <td className="px-3 py-3 font-mono tabular">{a.correct}</td>
                        <td className="px-3 py-3 font-mono tabular">{a.resolved ? fmtAccuracy(a.accuracy) : "—"}</td>
                        <td className="px-3 py-3 font-mono tabular">{a.avgConfidence != null ? fmtConfidence(a.avgConfidence) : "—"}</td>
                        <td className="px-3 py-3 font-mono tabular">{a.avgReward != null ? fmtReward(a.avgReward) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No action data" body="Predictions will appear after the learner is consulted on paper decisions." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Confidence calibration</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.byConfidence.length ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Confidence</th>
                      <th className="px-3 py-2">Predictions</th>
                      <th className="px-3 py-2">Resolved</th>
                      <th className="px-3 py-2">Accuracy</th>
                      <th className="px-3 py-2">Avg reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byConfidence.map((b) => (
                      <tr key={b.bucket} className="border-b border-border last:border-0">
                        <td className="px-3 py-3 font-mono tabular">{b.bucket}</td>
                        <td className="px-3 py-3 font-mono tabular">{b.predictions}</td>
                        <td className="px-3 py-3 font-mono tabular">{b.resolved}</td>
                        <td className="px-3 py-3 font-mono tabular">{b.resolved ? fmtAccuracy(b.accuracy) : "—"}</td>
                        <td className="px-3 py-3 font-mono tabular">{b.avgReward != null ? fmtReward(b.avgReward) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No calibration data" body="Confidence buckets populate once predictions are resolved." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recent learner decisions</CardTitle>
        </CardHeader>
        <CardContent>
          <PredictionTable rows={data.recentPredictions} />
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <ChartPanel title="Accuracy over time" empty={!stats.timeSeries.length}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.timeSeries}>
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, 1]} hide />
              <Tooltip contentStyle={{ background: "#16161a", border: "1px solid rgb(244 244 245 / 0.12)", fontSize: 12 }} />
              <Area type="monotone" dataKey="accuracy" stroke="var(--color-up)" fill="var(--color-up)" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Prediction volume" empty={!stats.timeSeries.length}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.timeSeries}>
              <XAxis dataKey="t" hide />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "#16161a", border: "1px solid rgb(244 244 245 / 0.12)", fontSize: 12 }} />
              <Bar dataKey="volume" fill="var(--color-muted)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Average reward + cumulative reward" empty={!stats.timeSeries.length}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={stats.timeSeries}>
              <XAxis dataKey="t" hide />
              <YAxis yAxisId="left" hide />
              <YAxis yAxisId="right" orientation="right" hide />
              <Tooltip contentStyle={{ background: "#16161a", border: "1px solid rgb(244 244 245 / 0.12)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="left" dataKey="avgReward" fill="var(--color-foreground)" name="Avg reward" />
              <Line yAxisId="right" type="monotone" dataKey="cumulativeReward" stroke="var(--color-up)" name="Cumulative" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel title="Learner vs baseline" empty={stats.baselineComparison.insufficientEvidence}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[
                { name: "Accuracy", baseline: stats.baselineComparison.baselineAccuracy ?? 0, learner: stats.baselineComparison.learnerAccuracy ?? 0 },
                { name: "Avg reward", baseline: stats.baselineComparison.baselineAvgReward ?? 0, learner: stats.baselineComparison.learnerAvgReward ?? 0 },
              ]}
            >
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis hide />
              <Tooltip contentStyle={{ background: "#16161a", border: "1px solid rgb(244 244 245 / 0.12)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="baseline" fill="var(--color-muted)" name="Baseline" />
              <Bar dataKey="learner" fill="var(--color-up)" name="Learner ENTER" />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Performance by regime</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.byRegime.length ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Regime</th>
                      <th className="px-3 py-2">Predictions</th>
                      <th className="px-3 py-2">Resolved</th>
                      <th className="px-3 py-2">Accuracy</th>
                      <th className="px-3 py-2">Avg reward</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byRegime.map((r) => (
                      <tr key={r.regime} className="border-b border-border last:border-0">
                        <td className="px-3 py-3">{r.regime}</td>
                        <td className="px-3 py-3 font-mono tabular">{r.predictions}</td>
                        <td className="px-3 py-3 font-mono tabular">{r.resolved}</td>
                        <td className="px-3 py-3 font-mono tabular">{r.resolved ? fmtAccuracy(r.accuracy) : "—"}</td>
                        <td className="px-3 py-3 font-mono tabular">{r.avgReward != null ? fmtReward(r.avgReward) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No regime data" body="Regime statistics appear once predictions span multiple regimes." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Performance by asset</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.byAsset.length ? (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Asset</th>
                      <th className="px-3 py-2">Predictions</th>
                      <th className="px-3 py-2">Resolved</th>
                      <th className="px-3 py-2">Accuracy</th>
                      <th className="px-3 py-2">Avg reward</th>
                      <th className="px-3 py-2">Reliability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byAsset.map((a) => {
                      const reliable = a.predictions >= 20;
                      return (
                        <tr key={a.assetId} className="border-b border-border last:border-0">
                          <td className="px-3 py-3 font-medium">{a.symbol}</td>
                          <td className="px-3 py-3 font-mono tabular">{a.predictions}</td>
                          <td className="px-3 py-3 font-mono tabular">{a.resolved}</td>
                          <td className="px-3 py-3 font-mono tabular">{a.resolved ? fmtAccuracy(a.accuracy) : "—"}</td>
                          <td className="px-3 py-3 font-mono tabular">{a.avgReward != null ? fmtReward(a.avgReward) : "—"}</td>
                          <td className="px-3 py-3">
                            <Badge variant={reliable ? "up" : "warn"}>{reliable ? "reliable" : "insufficient evidence"}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No asset data" body="Asset statistics appear once predictions are recorded." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Learner vs baseline comparison</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.baselineComparison.insufficientEvidence ? (
            <EmptyState title="INSUFFICIENT EVIDENCE" body="Learner/baseline comparison requires at least 5 resolved predictions for both the baseline and the learner." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
              <Kpi label="Baseline accuracy" value={fmtAccuracy(stats.baselineComparison.baselineAccuracy)} hint={`${stats.baselineComparison.baselineResolved} resolved`} />
              <Kpi label="Learner accuracy" value={fmtAccuracy(stats.baselineComparison.learnerAccuracy)} hint={`${stats.baselineComparison.learnerResolved} resolved`} />
              <Kpi label="Agreement" value={stats.baselineComparison.agreement.toLocaleString()} hint={`${stats.baselineComparison.disagreement} disagreement`} />
              <Kpi
                label="Disagreement baseline reward"
                value={stats.baselineComparison.disagreementAvgBaselineReward != null ? fmtReward(stats.baselineComparison.disagreementAvgBaselineReward) : "NO OUTCOME"}
                hint="Reward on trades the learner disagreed with"
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Learning health</CardTitle>
        </CardHeader>
        <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
            <HealthKpi label="Experience ingestion" status={data.health.experienceIngestion} />
            <HealthKpi label="Outcome resolution" status={data.health.outcomeResolution} />
            <HealthKpi label="Pattern discovery" status={data.health.patternDiscovery} />
            <HealthKpi label="Learner evaluation" status={data.health.learnerEvaluation} />
            <Kpi label="Prediction resolution lag" value={data.health.predictionResolutionLag ?? "—"} />
            <Kpi label="Data freshness" value={data.health.dataFreshness ?? "—"} />
          </div>
          {data.health.diagnostics.length ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {data.health.diagnostics.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Discovered patterns</CardTitle>
        </CardHeader>
        <CardContent>
          {data.patterns.length === 0 ? (
            <EmptyState title="No patterns discovered" body="Complete more paper round-trips to generate conditional patterns." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Pattern</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Samples</th>
                    <th className="px-3 py-2">Win rate</th>
                    <th className="px-3 py-2">Expectancy</th>
                    <th className="px-3 py-2">OOS expectancy</th>
                    <th className="px-3 py-2">Walk-forward</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.patterns.slice(0, 50).map((p) => (
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
                      <td className="px-3 py-3 font-mono tabular">{p.oosExpectancy != null ? p.oosExpectancy.toFixed(3) : "—"}</td>
                      <td className="px-3 py-3 font-mono tabular">{p.walkForwardStability != null ? `${p.walkForwardStability.toFixed(1)}/6` : "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={p.status === "APPROVED" ? "up" : p.status === "REJECTED" ? "down" : "outline"}>{p.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Lessons</CardTitle>
          </CardHeader>
          <CardContent>
            {data.lessons.length === 0 ? (
              <EmptyState title="No lessons extracted" body="Lessons are generated from completed trades and discovered patterns." />
            ) : (
              <div className="space-y-3">
                {data.lessons.slice(0, 20).map((l) => (
                  <div key={l.id} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">{l.title}</p>
                      <Badge variant={l.confidence === "HIGH" ? "up" : l.confidence === "INSUFFICIENT_EVIDENCE" ? "warn" : "outline"}>{l.confidence}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{l.body}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Champion / challenger</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">Champion:</span>{" "}
                {data.overview.championVersion ?? <span className="text-muted-foreground">none</span>}
              </p>
              <p>
                <span className="text-muted-foreground">Challenger:</span>{" "}
                {data.overview.challengerVersion ?? <span className="text-muted-foreground">none</span>}
              </p>
              <Separator />
              {data.candidates.length === 0 ? (
                <p className="text-xs text-muted-foreground">No strategy candidates under evaluation.</p>
              ) : (
                <div className="space-y-2">
                  {data.candidates.slice(0, 5).map((c) => (
                    <div key={c.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                      <div>
                        <p className="text-xs font-medium">{c.learnerVersion}</p>
                        <p className="text-[11px] text-muted-foreground">{c.strategyVersion}</p>
                      </div>
                      <Badge variant={c.status === "APPROVED" ? "up" : c.status === "REJECTED" ? "down" : "outline"}>{c.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Control audit log</CardTitle>
        </CardHeader>
        <CardContent>
          {data.controlAudit.length === 0 ? (
            <p className="text-sm text-muted-foreground">No control changes recorded yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Previous</th>
                    <th className="px-3 py-2">New</th>
                    <th className="px-3 py-2">Result</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {data.controlAudit.map((a) => (
                    <tr key={a.id} className="border-b border-border last:border-0">
                      <td className="px-3 py-3 font-mono text-xs tabular text-muted-foreground">{new Date(a.changedAt).toLocaleString()}</td>
                      <td className="px-3 py-3">{a.action}</td>
                      <td className="px-3 py-3">{a.previousState}</td>
                      <td className="px-3 py-3">{a.newState}</td>
                      <td className="px-3 py-3">
                        <Badge variant={a.success ? "up" : "down"}>{a.success ? "success" : "failed"}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">{a.reason ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HealthKpi({ label, status }: { label: string; status: "HEALTHY" | "WARNING" | "ERROR" }) {
  return (
    <Kpi
      label={label}
      value={status}
      tone={status === "HEALTHY" ? "up" : status === "WARNING" ? "warn" : "down"}
    />
  );
}
