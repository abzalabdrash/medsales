import { getDict, type Locale } from "@/lib/i18n";

function ru(n: number): string {
  return n.toLocaleString("ru-RU").replace(/,/g, " ");
}

export function StatPills({
  prices,
  brands,
  pharmacies,
  cities,
  locale,
}: {
  prices: number;
  brands: number;
  pharmacies: number;
  cities: number;
  locale: Locale;
}) {
  const t = getDict(locale);
  const items = [
    { v: ru(prices), l: t.statPrices },
    { v: ru(brands), l: t.statClinics },
    { v: ru(pharmacies), l: t.statPharmacies },
    { v: String(cities), l: t.statCities },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-muted">
      {items.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-baseline gap-1 rounded-full border border-line bg-surface px-3 py-1.5"
        >
          <span className="font-bold tabular-nums text-ink">{s.v}</span> {s.l}
        </span>
      ))}
    </div>
  );
}
