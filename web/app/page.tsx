import Link from "next/link";
import { Sparkles, ChevronRight } from "lucide-react";
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

        {/* Вход в помощника рядом с поиском, а не поверх страницы.
            Поиск отвечает на «сколько стоит», помощник на «что мне со всем
            этим делать»: это разные вопросы, и оба должны быть видны сразу. */}
        <Link
          href={withCity("/pomoshnik", city)}
          className="pressable mt-3 flex items-center gap-3 rounded-2xl border border-brand/30 bg-brand-wash px-4 py-3.5 text-left transition hover:border-brand/50"
        >
          <Sparkles size={22} className="shrink-0 text-brand-ink" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-ink">
              Сфотографируйте назначение врача
            </span>
            <span className="block text-sm text-muted">
              Помощник найдёт, где купить дешевле рядом, и посчитает курс
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0 text-brand-ink" aria-hidden />
        </Link>
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
