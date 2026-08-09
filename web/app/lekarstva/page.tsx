import Link from "next/link";
import { resolveCity } from "@/lib/cities";
import { getDict } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DrugCard } from "@/components/DrugCard";
import { DrugSearch } from "@/components/DrugSearch";
import {
  listDrugs,
  searchDrugs,
  drugTotals,
  listByAtcGroup,
  atcGroupCounts,
  ATC_GROUPS,
} from "@/lib/drugs";
import { withCity } from "@/lib/url";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;

export default async function DrugsPage({
  searchParams,
}: {
  searchParams: Promise<{
    city?: string;
    q?: string;
    rx?: string;
    page?: string;
    g?: string;
  }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const sp = await searchParams;
  const city = resolveCity(sp.city);
  const q = (sp.q ?? "").trim();
  const onlyRx = sp.rx === "1";
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const group = (sp.g ?? "").toUpperCase().slice(0, 1);

  const items = q
    ? searchDrugs(q, PAGE_SIZE)
    : group
      ? listByAtcGroup(group, PAGE_SIZE, (page - 1) * PAGE_SIZE)
      : listDrugs({
          onlyRx,
          onlyMatched: true,
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        });
  const totals = drugTotals();
  const counts = atcGroupCounts();

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[{ label: t.home, href: withCity("/", city) }, { label: "Лекарства" }]}
      />

      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        Лекарства и цены
      </h1>
      <p className="mt-2 max-w-[620px] text-muted">
        {totals.offers.toLocaleString("ru-RU")} наименований с ценами,{" "}
        {totals.withCap.toLocaleString("ru-RU")} сверяются с предельной ценой
        Минздрава. Считаем стоимость всего курса, а не одной упаковки.
      </p>

      <div className="mt-6">
        <DrugSearch initial={q} city={city} />
      </div>

      {!q && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <FilterChip href={withCity("/lekarstva", city)} active={!onlyRx && !group}>
              Все
            </FilterChip>
            <FilterChip href={withCity("/lekarstva?rx=1", city)} active={onlyRx}>
              Только по рецепту
            </FilterChip>
          </div>

          {/* Группы ATC — классификация ВОЗ, а не выдуманные нами рубрики.
              Показываем только те, где действительно есть товары с ценой. */}
          <div className="mt-3 flex flex-wrap gap-2">
            {ATC_GROUPS.filter((gr) => (counts[gr.code] ?? 0) > 0).map((gr) => (
              <FilterChip
                key={gr.code}
                href={withCity(`/lekarstva?g=${gr.code}`, city)}
                active={group === gr.code}
              >
                {gr.name}{" "}
                <span className="opacity-60">{counts[gr.code]}</span>
              </FilterChip>
            ))}
          </div>
        </>
      )}

      {items.length === 0 ? (
        <p className="mt-10 text-center text-muted">
          {q ? `По запросу «${q}» ничего не нашлось.` : "Пока пусто."}
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((d) => (
            <DrugCard key={d.offerId} d={d} />
          ))}
        </div>
      )}

      {!q && items.length === PAGE_SIZE && (
        <div className="mt-8 flex justify-center gap-3">
          {page > 1 && (
            <Link
              className="pressable rounded-lg border border-line px-4 py-2 text-sm"
              href={withCity(
                `/lekarstva?page=${page - 1}${onlyRx ? "&rx=1" : ""}${group ? `&g=${group}` : ""}`,
                city,
              )}
            >
              Назад
            </Link>
          )}
          <Link
            className="pressable rounded-lg border border-line px-4 py-2 text-sm"
            href={withCity(
              `/lekarstva?page=${page + 1}${onlyRx ? "&rx=1" : ""}${group ? `&g=${group}` : ""}`,
              city,
            )}
          >
            Дальше
          </Link>
        </div>
      )}
    </main>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`pressable rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "border-brand bg-brand-wash text-brand-ink"
          : "border-line text-muted hover:border-brand/40"
      }`}
    >
      {children}
    </Link>
  );
}
