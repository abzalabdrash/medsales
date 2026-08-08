import { TrendingDown } from "lucide-react";
import type { HistoryPoint } from "@/lib/db";
import { tenge } from "@/lib/format";
import { getDict, type Locale } from "@/lib/i18n";

export function PriceHistory({
  points,
  locale,
}: {
  points: HistoryPoint[];
  locale: Locale;
}) {
  const t = getDict(locale);
  if (points.length < 2) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-5">
        <h3 className="font-semibold">{t.historyTitle}</h3>
        <p className="mt-1 text-muted">{t.historyEmpty}</p>
      </div>
    );
  }
  const w = 640;
  const h = 170;
  const pad = 30;
  const ys = points.map((p) => p.min_price);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || 1;
  const X = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const Y = (v: number) => pad + (1 - (v - minY) / spanY) * (h - pad * 2);
  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${X(i).toFixed(1)} ${Y(p.min_price).toFixed(1)}`,
    )
    .join(" ");
  const last = points[points.length - 1].min_price;
  const first = points[0].min_price;
  const down = last <= first;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-semibold">{t.historyMinTitle}</h3>
        <span
          className={`inline-flex items-center gap-1 text-sm ${down ? "text-fresh" : "text-brand-ink"}`}
        >
          <TrendingDown size={16} aria-hidden /> {t.nowPrice} {tenge(last)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-auto w-full"
        role="img"
        aria-label={t.chartAria}
      >
        <path
          d={d}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={X(i)}
            cy={Y(p.min_price)}
            r="3"
            fill="var(--color-brand)"
          />
        ))}
        <text x={pad} y={h - 6} fill="var(--color-muted)" fontSize="12">
          {points[0].date}
        </text>
        <text
          x={w - pad}
          y={h - 6}
          textAnchor="end"
          fill="var(--color-muted)"
          fontSize="12"
        >
          {points[points.length - 1].date}
        </text>
      </svg>
    </div>
  );
}
