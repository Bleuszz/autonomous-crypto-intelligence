import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { fmtPct, fmtUsd, signedClass } from "@/lib/aether/format";
import { formatAge } from "@/lib/aether/time";
import type { RankedOpportunity } from "@/lib/aether/types";
import { Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function PageHeader({
  kicker,
  title,
  description,
  action,
}: {
  kicker?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {kicker ? (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{kicker}</p>
        ) : null}
        <h1 className="text-2xl font-medium tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "up" | "down" | "warn" | "plain";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 font-mono text-xl tabular tracking-tight",
          tone === "up" && "text-up",
          tone === "down" && "text-down",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function FreshnessPill({ ageMs }: { ageMs: number | null | undefined }) {
  if (ageMs == null) return <Badge variant="outline">unknown</Badge>;
  const stale = ageMs > 120_000;
  return <Badge variant={stale ? "warn" : "outline"}>{formatAge(ageMs)} old</Badge>;
}

export function OpportunityRow({ row }: { row: RankedOpportunity }) {
  const a = row.asset;
  return (
    <Link
      to="/token/$assetId"
      params={{ assetId: a.id }}
      className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-3 py-3 transition-colors hover:bg-muted/60 sm:grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.6fr_88px]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-medium">{a.symbol}</p>
          <span className="truncate text-xs text-muted-foreground">{a.name}</span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {a.chainId ?? a.kind} · {row.reasons[0]}
        </p>
      </div>
      <p className="hidden font-mono text-sm tabular sm:block">{fmtUsd(a.priceUsd)}</p>
      <p className={cn("hidden font-mono text-sm tabular sm:block", signedClass(a.change24hPct))}>{fmtPct(a.change24hPct)}</p>
      <p className="hidden font-mono text-sm tabular text-muted-foreground sm:block">{fmtUsd(a.liquidityUsd)}</p>
      <div className="text-right sm:text-left">
        <p className="font-mono text-sm tabular">{(row.score * 100).toFixed(0)}</p>
        <p className="text-[11px] text-muted-foreground">conf {(row.confidence * 100).toFixed(0)}</p>
      </div>
      <div className="hidden sm:block">
        <Sparkline values={a.sparkline7d} up={(a.change7dPct ?? 0) >= 0} />
      </div>
    </Link>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-down/30 bg-down/10 px-5 py-6">
      <p className="text-sm font-medium">Could not load this view</p>
      <p className="mt-1 break-words text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
