import { resolveCity, CITIES } from "@/lib/cities";
import { getDict } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PharmacyCard } from "@/components/PharmacyCard";
import { listPharmacies, pharmacyCities } from "@/lib/pharmacies";
import { LazyMap } from "@/components/LazyMap";
import { withCity } from "@/lib/url";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PharmaciesPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const city = resolveCity((await searchParams).city);
  const available = pharmacyCities();
  const has = available.some((c) => c.city === city);
  const items = listPharmacies(has ? city : "");

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[{ label: t.home, href: withCity("/", city) }, { label: "Аптеки" }]}
      />

      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Аптеки</h1>
      <p className="mt-2 max-w-[620px] text-muted">
        Рейтинги и адреса из 2GIS. Нажмите на карточку — откроется 2GIS с
        маршрутом до аптеки.
      </p>

      {!has && (
        <p className="mt-4 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
          По городу {CITIES.find((c) => c.slug === city)?.ru ?? city} аптеки ещё
          не собраны — показываем все города. Доступны:{" "}
          {available.map((c, i) => (
            <span key={c.city}>
              {i > 0 && ", "}
              <Link
                href={withCity("/apteki", c.city)}
                className="text-brand-ink hover:underline"
              >
                {CITIES.find((x) => x.slug === c.city)?.ru ?? c.city}
              </Link>{" "}
              ({c.n})
            </span>
          ))}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-xl border border-line">
        <LazyMap
          height={420}
          points={items
            .filter((p) => p.lat != null && p.lng != null)
            .map((p) => ({
              id: p.id,
              label: p.name,
              lat: p.lat as number,
              lng: p.lng as number,
              address: p.address,
              rating: p.rating,
              reviews: p.reviews,
              twogisId: p.twogisId,
              city: p.city,
            }))}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <PharmacyCard key={p.id} p={p} />
        ))}
      </div>
    </main>
  );
}
