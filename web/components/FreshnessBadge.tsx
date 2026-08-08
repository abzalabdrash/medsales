"use client";

import { freshness } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

export function FreshnessBadge({
  parsedAt,
}: {
  parsedAt: string | null | undefined;
}) {
  const { locale } = useI18n();
  const f = freshness(locale, parsedAt);
  const color = f.fresh
    ? "text-fresh"
    : f.stale
      ? "text-brand-ink"
      : "text-muted";
  const dot = f.fresh ? "bg-fresh" : f.stale ? "bg-brand" : "bg-muted";
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${color}`}>
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      {f.label}
      {f.stale ? f.staleSuffix : ""}
    </span>
  );
}
