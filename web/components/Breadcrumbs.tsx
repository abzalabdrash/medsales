import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getDict, type Locale } from "@/lib/i18n";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({
  items,
  locale,
}: {
  items: Crumb[];
  locale: Locale;
}) {
  const t = getDict(locale);
  return (
    <nav
      aria-label={t.crumbsAria}
      className="flex flex-wrap items-center gap-1 text-sm text-muted"
    >
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && (
            <ChevronRight size={14} aria-hidden className="text-muted" />
          )}
          {c.href ? (
            <Link
              href={c.href}
              className="pressable rounded px-1 hover:text-ink"
            >
              {c.label}
            </Link>
          ) : (
            <span className="px-1 text-ink">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
