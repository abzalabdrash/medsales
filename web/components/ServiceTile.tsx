import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { categoryLabel, type Locale } from "@/lib/i18n";
import { withCity } from "@/lib/url";
import type { ServiceHit } from "@/lib/db";

export function ServiceTile({
  hit,
  city,
  locale,
}: {
  hit: ServiceHit;
  city: string;
  locale: Locale;
}) {
  return (
    <Link
      href={withCity(`/usluga/${hit.id}`, city)}
      className="pressable flex min-h-[64px] items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3"
    >
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium leading-snug">{hit.name}</span>
        <span className="text-sm text-muted">
          {categoryLabel(locale, hit.category)}
        </span>
      </span>
      <ArrowUpRight size={20} className="shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
