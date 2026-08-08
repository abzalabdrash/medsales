import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { resolveCity } from "@/lib/cities";
import {
  getCanonical,
  getOffers,
  getServiceStats,
  getServiceCities,
  getServiceLocations,
  getServicePicks,
  getPriceHistory,
} from "@/lib/db";
import { tenge } from "@/lib/format";
import {
  getDict,
  categoryLabel,
  cityNameL,
  fromPrice,
  noPriceInCity,
  type Locale,
} from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { withCity } from "@/lib/url";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { OffersView } from "@/components/OffersView";
import { PriceHistory } from "@/components/PriceHistory";
import { EmptyState } from "@/components/EmptyState";

export const dynamic = "force-dynamic";

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-sm text-muted">{label}</div>
      <div
        className={`mt-0.5 text-xl font-bold tabular-nums sm:text-2xl ${
          accent ? "text-brand-ink" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function OtherCities({
  id,
  city,
  locale,
}: {
  id: string;
  city: string;
  locale: Locale;
}) {
  const t = getDict(locale);
  const cities = getServiceCities(id).filter((c) => c.city !== city);
  if (cities.length === 0) {
    return <p className="text-muted">{t.notFoundAnyCity}</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-2">
      {cities.map((c) => (
        <Link
          key={c.city}
          href={withCity(`/usluga/${id}`, c.city)}
          className="pressable inline-flex min-h-[48px] items-center gap-2 rounded-xl border border-line bg-paper px-4 font-medium"
        >
          {cityNameL(locale, c.city)}{" "}
          <span className="text-brand-ink">
            {fromPrice(locale, tenge(c.min))}
          </span>
        </Link>
      ))}
    </div>
  );
}

export default async function ServicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const { id } = await params;
  const city = resolveCity((await searchParams).city);
  const svc = getCanonical(id);
  if (!svc) notFound();

  const offers = getOffers(id, city);
  const stats = getServiceStats(id, city);
  const locations = getServiceLocations(id, city);
  const candidates = getServicePicks(id, city);
  const history = getPriceHistory(id, city);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[
          { label: t.home, href: withCity("/", city) },
          {
            label: categoryLabel(locale, svc.category),
            href: withCity(`/katalog/${svc.category}`, city),
          },
          { label: svc.name_ru },
        ]}
      />
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {svc.name_ru}
      </h1>
      <p className="mt-1 text-muted">
        {categoryLabel(locale, svc.category)} · {cityNameL(locale, city)}
      </p>

      {offers.length > 0 ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t.statFrom} value={tenge(stats.min)} accent />
            <Stat label={t.statTo} value={tenge(stats.max)} />
            <Stat label={t.statAvg} value={tenge(stats.avg)} />
            <Stat label={t.statClinicsCount} value={String(stats.brands)} />
          </div>
          <div className="mt-6">
            <PriceHistory points={history} locale={locale} />
          </div>
          <div className="mt-6">
            <OffersView
              offers={offers}
              locations={locations}
              candidates={candidates}
              city={city}
              serviceId={svc.id}
              serviceName={svc.name_ru}
            />
          </div>
        </>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={MapPin}
            title={noPriceInCity(locale, cityNameL(locale, city))}
            hint={t.lookOtherCities}
          >
            <OtherCities id={id} city={city} locale={locale} />
          </EmptyState>
        </div>
      )}
    </main>
  );
}
