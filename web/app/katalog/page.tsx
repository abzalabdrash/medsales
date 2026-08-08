import { resolveCity } from "@/lib/cities";
import { getCategoryCounts } from "@/lib/db";
import { getDict, cityNameL } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { CategoryCard } from "@/components/CategoryCard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { withCity } from "@/lib/url";

export const dynamic = "force-dynamic";

const ORDER = ["laboratory", "diagnostics", "doctor_visit", "procedure"];

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const city = resolveCity((await searchParams).city);
  const cats = getCategoryCounts(city);
  const byCat = new Map(cats.map((c) => [c.category, c.services]));

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[
          { label: t.home, href: withCity("/", city) },
          { label: t.catalog },
        ]}
      />
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {t.catalogTitle}
      </h1>
      <p className="mt-1 text-muted">{cityNameL(locale, city)}</p>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ORDER.map((cat) => (
          <CategoryCard
            key={cat}
            category={cat}
            count={byCat.get(cat) ?? 0}
            city={city}
            locale={locale}
          />
        ))}
      </div>
    </main>
  );
}
