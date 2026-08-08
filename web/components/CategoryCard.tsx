import Link from "next/link";
import { FlaskConical, ScanLine, Stethoscope, Syringe } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { categoryLabel, servicesLabel, type Locale } from "@/lib/i18n";
import { withCity } from "@/lib/url";

const ICONS: Record<string, LucideIcon> = {
  laboratory: FlaskConical,
  diagnostics: ScanLine,
  doctor_visit: Stethoscope,
  procedure: Syringe,
};

export function CategoryCard({
  category,
  count,
  city,
  locale,
}: {
  category: string;
  count: number;
  city: string;
  locale: Locale;
}) {
  const Icon = ICONS[category] ?? FlaskConical;
  return (
    <Link
      href={withCity(`/katalog/${category}`, city)}
      className="pressable flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4"
    >
      <span className="grid size-12 place-items-center rounded-xl bg-brand-wash text-brand-ink">
        <Icon size={24} strokeWidth={2} aria-hidden />
      </span>
      <span className="mt-1 text-lg font-semibold">
        {categoryLabel(locale, category)}
      </span>
      <span className="text-sm text-muted">{servicesLabel(locale, count)}</span>
    </Link>
  );
}
