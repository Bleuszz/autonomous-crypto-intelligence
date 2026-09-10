import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Beaker,
  BookOpen,
  Brain,
  Briefcase,
  CalendarDays,
  Landmark,
  LayoutDashboard,
  Menu,
  Newspaper,
  Radar,
  Radio,
  ShieldAlert,
  Siren,
  Wallet,
  X,
} from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  {
    label: "Intel",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/opportunities", label: "Opportunities", icon: Radar },
      { to: "/scanner", label: "Scanner", icon: Activity },
    ],
  },
  {
    label: "Context",
    items: [
      { to: "/events", label: "Events", icon: CalendarDays },
      { to: "/news", label: "News", icon: Newspaper },
      { to: "/social", label: "Social", icon: BookOpen },
      { to: "/polymarket", label: "Polymarket", icon: Landmark },
      { to: "/wallets", label: "Wallets", icon: Wallet },
      { to: "/copy-signals", label: "Copy signals", icon: Activity },
      { to: "/x-intelligence", label: "X intelligence", icon: Radio },
    ],
  },
  {
    label: "Desk",
    items: [
      { to: "/paper", label: "Paper desk", icon: Briefcase },
      { to: "/learning", label: "Learning", icon: Brain },
      { to: "/backtests", label: "Backtests", icon: Beaker },
      { to: "/strategies", label: "Strategies", icon: ShieldAlert },
      { to: "/system", label: "System", icon: Siren },
    ],
  },
];

function NavLinks({ onGo, pathname }: { onGo?: () => void; pathname: string }) {
  return (
    <nav className="flex flex-col gap-5">
      {NAV.map((g) => (
        <div key={g.label}>
          <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {g.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    onClick={onGo}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().replace("T", " ").slice(0, 19));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="flex min-h-dvh">
        <aside className="hidden w-60 shrink-0 border-r border-border bg-card/40 lg:flex lg:flex-col">
          <div className="flex items-center gap-3 px-4 py-5">
            <div className="flex size-8 items-center justify-center rounded-md border border-border">
              <span className="font-mono text-xs tracking-tight">Ae</span>
            </div>
            <div>
              <p className="text-sm font-medium tracking-tight">Aether</p>
              <p className="text-[11px] text-muted-foreground">Intelligence desk</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-6">
            <NavLinks pathname={pathname} />
          </div>
          <div className="border-t border-border px-4 py-4">
            <Badge variant="paper">PAPER</Badge>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Live execution is locked. Paper fills include fees, latency and slippage.
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/90 px-4 backdrop-blur">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </Button>
            <p className="hidden truncate font-mono text-xs text-muted-foreground sm:block">
              {clock ? `${clock} UTC` : "UTC"}
            </p>
            <p className="truncate font-mono text-[11px] text-muted-foreground sm:hidden">Aether</p>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="paper">PAPER</Badge>
            </div>
          </header>
          <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" className="absolute inset-0 bg-background/70" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div className="absolute inset-y-0 left-0 flex w-[min(18rem,88vw)] flex-col border-r border-border bg-card">
            <div className="flex items-center justify-between px-4 py-4">
              <p className="text-sm font-medium">Aether</p>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-8">
              <NavLinks pathname={pathname} onGo={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
