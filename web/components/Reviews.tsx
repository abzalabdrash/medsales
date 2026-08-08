"use client";

import { useState } from "react";
import type { Review } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import { ReviewStars } from "./ReviewStars";

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export function Reviews({
  reviews,
  locale,
  initial = 5,
}: {
  reviews: Review[];
  locale: Locale;
  initial?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (reviews.length === 0) return null;
  const shown = expanded ? reviews : reviews.slice(0, initial);
  const anon = locale === "kk" ? "Жасырын" : "Аноним";
  const more = locale === "kk" ? "Барлық пікірлер" : "Показать все отзывы";
  const less = locale === "kk" ? "Жасыру" : "Свернуть";

  return (
    <div className="flex flex-col gap-3">
      {shown.map((r, i) => (
        <div key={i} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-semibold">{r.author || anon}</span>
            <div className="flex items-center gap-2">
              <ReviewStars value={r.rating} />
              {fmtDate(r.createdAt) && (
                <span className="text-sm tabular-nums text-muted">
                  {fmtDate(r.createdAt)}
                </span>
              )}
            </div>
          </div>
          <p className="mt-2 whitespace-pre-line text-[17px] leading-relaxed text-ink">
            {r.text}
          </p>
        </div>
      ))}
      {reviews.length > initial && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="pressable min-h-[48px] self-start rounded-xl border border-line bg-paper px-4 text-sm font-medium"
        >
          {expanded ? less : `${more} (${reviews.length})`}
        </button>
      )}
    </div>
  );
}
