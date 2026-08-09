import { MapPin } from "lucide-react";
import type { PharmacyPrice } from "@/lib/drugs";
import { tenge } from "@/lib/format";

/**
 * Цены на препарат по конкретным аптекам, от дешёвой к дорогой.
 *
 * Это ответ на вопрос, ради которого человек и заходит: не «сколько стоит
 * вообще», а «куда идти, чтобы не переплатить». Разница между первой и
 * последней строкой обычно и есть та экономия, которую обещает сервис.
 *
 * Три вещи показываем честно, потому что иначе таблица врёт:
 *   — фасовку рядом с ценой: 5 500 ₸ за 21 капсулу и за 42 это разные цены;
 *   — дату обновления у каждой строки: прайсы аптеки грузят сами;
 *   — сколько аптек в выдаче из скольких всего.
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
        Наличие уточняйте по телефону — прайсы аптеки обновляют сами.
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
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/60 last:border-0">
                <td className="py-2.5 pr-3">
                  <span className="font-medium text-ink">{r.pharmacyName}</span>
                  {r.address && (
                    <a
                      href={r.twogisUrl ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-0.5 flex items-start gap-1.5 text-xs text-muted hover:text-brand-ink"
                    >
                      <MapPin size={12} className="mt-0.5 shrink-0" aria-hidden />
                      <span>{r.address}</span>
                    </a>
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
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted">
        Источник цен — агрегатор apteka.103.kz, {city}. Аптеки публикуют прайсы
        сами, поэтому у каждой строки своя дата.
      </p>
    </section>
  );
}
