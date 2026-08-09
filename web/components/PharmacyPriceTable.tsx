import { MapPin } from "lucide-react";
import type { PharmacyPrice } from "@/lib/drugs";
import { tenge } from "@/lib/format";

/**
 * Цены на препарат по конкретным аптекам, от дешёвой к дорогой.
 *
 * Ссылка только на карточку фирмы 2GIS (/firm/id). Поиск по строке адреса
 * даёт «точных совпадений нет» и открывает что попало — так нельзя.
 */
export function PharmacyPriceTable({
  rows,
  city,
}: {
  rows: PharmacyPrice[];
  city: string;
}) {
  if (rows.length === 0) return null;

  const min = rows[0].price;
  const max = rows[rows.length - 1].price;
  const total = rows.find((r) => r.storesTotal)?.storesTotal ?? null;
  const save = max > min ? max - min : null;

  function firmHref(r: PharmacyPrice): string | null {
    if (r.twogisUrl && /\/firm\//.test(r.twogisUrl)) return r.twogisUrl;
    return null;
  }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Цены по аптекам</h2>
      <p className="mt-1 text-sm text-muted">
        {save !== null ? (
          <>
            От {tenge(min)} до {tenge(max)} — разница {tenge(save)}.{" "}
          </>
        ) : (
          <>Цена {tenge(min)}. </>
        )}
        {total && total > rows.length ? (
          <>
            Показаны {rows.length} из {total} аптек: самые дешёвые.{" "}
          </>
        ) : null}
        Нажмите на название — откроется карточка аптеки в 2GIS. Наличие
        уточняйте по телефону.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3 font-medium">Аптека</th>
              <th className="py-2 pr-3 font-medium">Фасовка</th>
              <th className="py-2 pr-3 font-medium">Обновлено</th>
              <th className="py-2 text-right font-medium">Цена</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const href = firmHref(r);
              const nameEl = (
                <span className={href ? "font-medium text-ink group-hover:text-brand-ink group-hover:underline" : "font-medium text-ink"}>
                  {r.pharmacyName}
                </span>
              );
              return (
                <tr key={r.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2.5 pr-3">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="group block">
                        {nameEl}
                        {r.address && (
                          <span className="mt-0.5 flex items-start gap-1.5 text-xs text-muted">
                            <MapPin size={12} className="mt-0.5 shrink-0" aria-hidden />
                            <span>{r.address}</span>
                          </span>
                        )}
                      </a>
                    ) : (
                      <div>
                        {nameEl}
                        {r.address && (
                          <span className="mt-0.5 flex items-start gap-1.5 text-xs text-muted">
                            <MapPin size={12} className="mt-0.5 shrink-0" aria-hidden />
                            <span>{r.address}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-muted">
                    {r.packSize ? `${r.packSize} шт.` : "—"}
                    {r.dosage && <div>{r.dosage}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs text-muted">
                    {r.updatedLabel ?? "—"}
                  </td>
                  <td className="py-2.5 text-right font-semibold tabular-nums text-ink">
                    {tenge(r.price)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        Источник цен — агрегатор apteka.103.kz и сети, {city}. Карточки 2GIS —
        по id организации из справочника Places API.
      </p>
    </section>
  );
}
