import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { fetchScanner } from "@/lib/aether/api";
import { fmtPct, fmtUsd, signedClass } from "@/lib/aether/format";
import { ErrorState, PageHeader } from "@/components/desk";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/scanner")({ component: ScannerPage });

function ScannerPage() {
  const q = useQuery({ queryKey: ["scanner"], queryFn: () => fetchScanner() });
  const [qtext, setQtext] = useState("");
  const [chain, setChain] = useState("all");
  const rows = useMemo(() => {
    const list = q.data ?? [];
    return list.filter((a) => {
      if (chain !== "all" && a.chainId !== chain && a.kind !== chain) return false;
      if (!qtext) return true;
      const hay = `${a.symbol} ${a.name} ${a.id}`.toLowerCase();
      return hay.includes(qtext.toLowerCase());
    });
  }, [q.data, qtext, chain]);
  const chains = useMemo(() => {
    const s = new Set<string>();
    for (const a of q.data ?? []) if (a.chainId) s.add(a.chainId);
    return [...s].sort();
  }, [q.data]);

  return (
    <div>
      <PageHeader
        kicker="Intel"
        title="Scanner"
        description="Majors from CoinGecko plus newly liquid DEX pools. Filters are deterministic and cheap — no LLM on this path."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <Input value={qtext} onChange={(e) => setQtext(e.target.value)} placeholder="Search symbol, name, id" className="sm:max-w-xs" />
        <select
          value={chain}
          onChange={(e) => setChain(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All chains</option>
          <option value="major">Listed majors</option>
          {chains.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {q.isLoading ? <Skeleton className="h-96 rounded-xl" /> : null}
      {q.error ? <ErrorState message={q.error instanceof Error ? q.error.message : "Failed"} /> : null}
      {q.data ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">Asset</th>
                <th className="px-3 py-2 font-medium">Price</th>
                <th className="px-3 py-2 font-medium">24h</th>
                <th className="px-3 py-2 font-medium">Volume</th>
                <th className="px-3 py-2 font-medium">Liquidity / mcap</th>
                <th className="px-3 py-2 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50">
                  <td className="px-3 py-2">
                    <Link to="/token/$assetId" params={{ assetId: a.id }} className="font-medium">
                      {a.symbol}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{a.name}</p>
                  </td>
                  <td className="px-3 py-2 font-mono tabular">{fmtUsd(a.priceUsd)}</td>
                  <td className={cn("px-3 py-2 font-mono tabular", signedClass(a.change24hPct))}>{fmtPct(a.change24hPct)}</td>
                  <td className="px-3 py-2 font-mono tabular text-muted-foreground">{fmtUsd(a.volume24hUsd)}</td>
                  <td className="px-3 py-2 font-mono tabular text-muted-foreground">{fmtUsd(a.liquidityUsd ?? a.marketCapUsd)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{a.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
