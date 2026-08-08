import Link from "next/link";
import { notFound } from "next/navigation";
import { PackageSearch } from "lucide-react";
import { resolveCity } from "@/lib/cities";
import { getCategoryServices } from "@/lib/db";
import { tenge } from "@/lib/format";
import {
  getDict,
  categoryLabel,
  cityNameL,
  clinicsLabel,
  fromPrice,
  isCategory,
  noServicesInCategory,
} from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { withCity } from "@/lib/url";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const { category } = await params;
  if (!isCategory(category)) notFound();
  const city = resolveCity((await searchParams).city);
  const services = getCategoryServices(category, city);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[
          { label: t.home, href: withCity("/", city) },
          { label: t.catalog, href: withCity("/katalog", city) },
          { label: categoryLabel(locale, category) },
        ]}
      />
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {categoryLabel(locale, category)}
      </h1>
      <p className="mt-1 text-muted">{cityNameL(locale, city)}</p>

      {services.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-2xl border border-line">
          {services.map((s, i) => (
            <Link
              key={String(s.id)}
              href={withCity(`/usluga/${s.id}`, city)}
              className={`flex min-h-[56px] items-center justify-between gap-3 bg-surface px-4 py-3 hover:bg-surface-2 ${
                i > 0 ? "border-t border-line" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate">{s.name}</span>
                <span className="text-sm text-muted">
                  {clinicsLabel(locale, s.brands)}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-brand-ink">
                {fromPrice(locale, tenge(s.min))}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={PackageSearch}
            title={noServicesInCategory(locale, cityNameL(locale, city))}
            hint={t.tryAnotherCity}
          />
        </div>
      )}
    </main>
  );
}
