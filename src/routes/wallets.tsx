import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { fetchWallets } from "@/lib/aether/api";
import { fmtUsd, shortAddr } from "@/lib/aether/format";
import { ErrorState, PageHeader } from "@/components/desk";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/wallets")({ component: WalletsPage });

function WalletsPage() {
  const q = useQuery({ queryKey: ["wallets"], queryFn: () => fetchWallets() });
  return (
    <div>
      <PageHeader
        kicker="Context"
        title="Wallet intelligence"
        description="Addresses observed on recent pool prints. They are not assumed to be smart money. Classification stays unknown until a scored track record exists."
      />
      {q.isLoading ? <Skeleton className="h-80 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-3 text-sm font-medium">Observed wallets</p>
          <ul>
            {q.data?.wallets.map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-0">
                <div>
                  <p className="font-mono text-sm">{shortAddr(w.address)}</p>
                  <p className="text-[11px] text-muted-foreground">{w.chainId}</p>
                </div>
                <Badge variant="outline">{w.classification}</Badge>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card">
          <p className="border-b border-border px-4 py-3 text-sm font-medium">Recent prints</p>
          <ul>
            {q.data?.txs.map((t) => (
              <li key={t.id} className="border-b border-border px-4 py-3 last:border-0">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono">{shortAddr(t.address ?? t.walletId)}</span>
                  <span className="font-mono tabular">{fmtUsd(t.notionalUsd)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t.side ?? "—"} · {t.chainId} · copy-at-print is not assumed executable
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
