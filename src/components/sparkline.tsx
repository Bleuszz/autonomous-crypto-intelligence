import { cn } from "@/lib/utils";

export function Sparkline({
  values,
  className,
  up,
}: {
  values: number[] | null | undefined;
  className?: string;
  up?: boolean;
}) {
  if (!values || values.length < 2) {
    return <span className="text-muted-foreground">—</span>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 88;
  const h = 28;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const positive = up ?? values[values.length - 1]! >= values[0]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-7 w-[88px]", className)} aria-hidden>
      <polyline
        fill="none"
        stroke={positive ? "var(--color-up)" : "var(--color-down)"}
        strokeWidth="1.4"
        points={pts}
      />
    </svg>
  );
}
