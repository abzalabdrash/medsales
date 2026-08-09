import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveCity } from "@/lib/cities";
import { getDict } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CourseCalculator } from "@/components/CourseCalculator";
import { getAnalogs, getDrug, getFreeCoverage, pharmacyPrices } from "@/lib/drugs";
import { tenge } from "@/lib/format";
import { PharmacyCard } from "@/components/PharmacyCard";
import { PharmacyPriceTable } from "@/components/PharmacyPriceTable";
import { pharmaciesForChain } from "@/lib/pharmacies";
import { withCity } from "@/lib/url";

export const dynamic = "force-dynamic";

export default async function DrugPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const city = resolveCity((await searchParams).city);
  const drug = getDrug((await params).id);
  if (!drug) notFound();

  const analogs = getAnalogs(drug.atc, drug.refId);
  const free = getFreeCoverage(drug.atc, drug.inn);
  // Цены по конкретным точкам, если они есть; иначе — адреса сети с её
  // единым ценником. Одновременно показывать оба блока незачем: они
  // отвечают на один вопрос, просто с разной точностью.
  const prices = pharmacyPrices(drug.refId, drug.title, city);
  const branches = prices.length > 0 ? [] : pharmaciesForChain(drug.chain, city);
  const cheaper = analogs.filter(
    (a) => a.price !== null && drug.price !== null && a.price < drug.price,
  );
  const showOverpay =
    drug.overpayPct !== null && drug.overpayPct >= 15 && !drug.capIsStale;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[
          { label: t.home, href: withCity("/", city) },
          { label: "Лекарства", href: withCity("/lekarstva", city) },
          { label: drug.title },
        ]}
      />

      {/* Бесплатное обеспечение — выше цены: если положено, покупать не нужно */}
      {free.length > 0 && (
        <section className="mt-4 rounded-xl border border-fresh/40 bg-fresh/5 p-4">
          <h2 className="text-sm font-semibold text-ink">
            Возможно, положено бесплатно
          </h2>
          <p className="mt-1 text-sm text-muted">
            Действующее вещество есть в перечне бесплатного амбулаторного
            обеспечения Минздрава. Это зависит от диагноза и от того, состоите
            ли вы на динамическом наблюдении — уточните у врача.
          </p>
          <ul className="mt-3 space-y-2">
            {free.slice(0, 3).map((f, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{f.drugName}</span>
                {f.mkb10 && <span className="text-muted"> · МКБ {f.mkb10}</span>}
                {f.disease && (
                  <div className="text-xs text-muted">{f.disease}</div>
                )}
              </li>
            ))}
          </ul>
          {free[0]?.sourceUrl && (
            <a
              href={free[0].sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-xs text-brand-ink underline"
            >
              Приказ Минздрава РК
            </a>
          )}
        </section>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex flex-wrap items-start gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {drug.title}
            </h1>
            {drug.isRx && (
              <span className="mt-1 rounded-md bg-brand-wash px-2 py-1 text-xs font-medium text-brand-ink">
                по рецепту
              </span>
            )}
          </div>

          {drug.inn && (
            <p className="mt-2 text-muted">
              Действующее вещество: <span className="text-ink">{drug.inn}</span>
              {drug.atc && <span className="text-muted"> · ATC {drug.atc}</span>}
            </p>
          )}

          <div className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="text-3xl font-semibold tabular-nums">
                {tenge(drug.price)}
              </div>
              <div className="text-sm text-muted">
                {drug.chain}
                {drug.packSize ? ` · упаковка №${drug.packSize}` : ""}
              </div>
            </div>

            {drug.priceCap !== null && !drug.capIsStale && (
              <div className="rounded-lg border border-line px-3 py-2">
                <div className="text-xs text-muted">Предельная цена Минздрава</div>
                <div className="text-sm font-medium tabular-nums">
                  {tenge(drug.priceCap)}
                  {showOverpay && (
                    <span className="ml-2 font-normal text-muted">
                      цена выше на {drug.overpayPct}%
                    </span>
                  )}
                </div>
                <p className="mt-1 max-w-[280px] text-[11px] leading-snug text-muted">
                  Потолок указан для этого наименования и фасовки. У разных
                  производителей он различается, поэтому расхождение не всегда
                  означает нарушение.
                </p>
              </div>
            )}
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Row label="Форма выпуска" value={drug.formRaw} />
            <Row label="Производитель" value={drug.manufacturer} />
            <Row
              label="Дозировка"
              value={
                drug.strength
                  ? `${drug.strength} ${drug.strengthUnit ?? ""}`.trim()
                  : null
              }
            />
            <Row label="Рег. удостоверение" value={drug.regNumber} />
          </dl>

          {drug.sourceUrl && (
            <a
              href={drug.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-block text-sm text-brand-ink underline"
            >
              Открыть в аптеке
            </a>
          )}
        </div>

        <CourseCalculator
          packSize={drug.packSize}
          isDivisible={drug.isDivisible}
          form={drug.form}
          price={drug.price}
        />
      </div>

      <PharmacyPriceTable rows={prices} city={city} />

      {branches.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">
            Где купить — {branches.length} аптек сети «{drug.chain}»
          </h2>
          <p className="mt-1 text-sm text-muted">
            Цена одна на всю сеть. Наличие в конкретной аптеке уточняйте по
            телефону — нажмите на адрес, откроется карточка в 2GIS.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {branches.map((p) => (
              <PharmacyCard key={p.id} p={p} />
            ))}
          </div>
        </section>
      )}

      {analogs.length > 0 && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">
            Аналоги по действующему веществу
          </h2>
          <p className="mt-1 text-sm text-muted">
            То же вещество и код ATC, другой производитель.
            {cheaper.length > 0 && (
              <> Дешевле: {cheaper.length} из {analogs.length}.</>
            )}{" "}
            Замену согласуйте с врачом или фармацевтом.
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs uppercase text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">Препарат</th>
                  <th className="py-2 pr-3 font-medium">Фасовка</th>
                  <th className="py-2 pr-3 font-medium">Производитель</th>
                  <th className="py-2 text-right font-medium">Цена</th>
                </tr>
              </thead>
              <tbody>
                {analogs.map((a) => (
                  <tr key={a.refId} className="border-b border-line/60">
                    <td className="py-2.5 pr-3">
                      {a.offerId ? (
                        <Link
                          href={withCity(`/lekarstvo/${a.offerId}`, city)}
                          className="text-brand-ink hover:underline"
                        >
                          {a.title}
                        </Link>
                      ) : (
                        a.title
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {a.packSize ? `№${a.packSize}` : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-muted">
                      {a.manufacturer ?? "—"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">
                      {a.price ? (
                        <span
                          className={
                            drug.price && a.price < drug.price
                              ? "font-medium text-fresh"
                              : ""
                          }
                        >
                          {tenge(a.price)}
                        </span>
                      ) : (
                        <span className="text-muted" title="нет в наличии">
                          нет цены
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-10 text-xs text-muted">
        Информация справочная и не заменяет консультацию врача. Мы не ставим
        диагноз и не меняем назначения.
      </p>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}
