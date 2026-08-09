import Link from "next/link";
import { Sparkles } from "lucide-react";
import { resolveCity, CITIES } from "@/lib/cities";
import { withCity } from "@/lib/url";
import { getPopularServices, getCategoryCounts, getTotals } from "@/lib/db";
import { getDict, cityNameL, heroTitle } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { SearchBox } from "@/components/SearchBox";
import { ServiceTile } from "@/components/ServiceTile";
import { CategoryCard } from "@/components/CategoryCard";
import { StatPills } from "@/components/StatPills";

export const dynamic = "force-dynamic";

const CATEGORY_ORDER = [
  "laboratory",
  "diagnostics",
  "doctor_visit",
  "procedure",
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const city = resolveCity((await searchParams).city);
  const popular = getPopularServices(city, 8);
  const cats = getCategoryCounts(city);
  const totals = getTotals();
  const countByCat = new Map(cats.map((c) => [c.category, c.services]));

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6 sm:py-12">
      <section className="mx-auto max-w-[760px] text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          {heroTitle(locale, cityNameL(locale, city))}
        </h1>
        <p className="mt-3 text-lg text-muted">{t.heroSubtitle}</p>
        <div className="mt-6 text-left">
          <SearchBox city={city} variant="hero" initialPopular={popular} />
        </div>

        {/* Ядро продукта по ТЗ хакатона: ИИ в основной функции, не в подвале. */}
        <div className="mt-5 rounded-3xl border border-brand/40 bg-gradient-to-b from-brand-wash to-paper p-5 text-left shadow-sm sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-ink">
            {t.assistantCoreEyebrow}
          </p>
          <div className="mt-2 flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white">
              <Sparkles size={22} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
                {t.assistantCoreTitle}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted sm:text-base">
                {t.assistantCoreBody}
              </p>
            </div>
          </div>
          <Link
            href={withCity("/pomoshnik", city)}
            className="pressable mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-2xl bg-brand px-5 text-base font-semibold text-white sm:w-auto"
          >
            {t.assistantCoreCta}
          </Link>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold">{t.categories}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {CATEGORY_ORDER.map((cat) => (
            <CategoryCard
              key={cat}
              category={cat}
              count={countByCat.get(cat) ?? 0}
              city={city}
              locale={locale}
            />
          ))}
        </div>
      </section>

      {popular.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-3 text-lg font-semibold">{t.popular}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {popular.map((hit) => (
              <ServiceTile
                key={String(hit.id)}
                hit={hit}
                city={city}
                locale={locale}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-10">
        <StatPills
          prices={totals.prices}
          brands={totals.brands}
          cities={CITIES.length}
          locale={locale}
        />
      </section>
    </main>
  );
}
