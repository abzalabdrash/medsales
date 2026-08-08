import Link from "next/link";
import type { DrugListItem } from "@/lib/drugs";
import { tenge } from "@/lib/format";

/**
 * Карточка препарата в списке.
 *
 * Что здесь показано и почему именно это:
 *  - цена и фасовка рядом, потому что «1 400 ₸» без «№30» ничего не значит;
 *  - «по рецепту» — честное предупреждение, что без рецепта не продадут;
 *  - переплата над предельной ценой МЗ показывается ТОЛЬКО когда потолок
 *    свежий и превышение заметное: обвинять аптеку на шатких данных хуже,
 *    чем промолчать.
 */
export function DrugCard({ d }: { d: DrugListItem }) {
  // Показываем только приятный сигнал «ниже предельной» — он безопасен.
  // Обвинение в переплате в списке не выводим: матч по названию не знает
  // производителя, а потолки разных заводов отличаются в разы, и ярлык
  // «+184%» легко повесить на препарат, который ничего не нарушает.
  // Точную сверку с потолком показываем на карточке, как факт со ссылкой
  // на приказ, а не как приговор.
  const showGood = d.overpayPct !== null && d.overpayPct <= -10 && !d.capIsStale;

  return (
    <Link
      href={`/lekarstvo/${d.offerId}`}
      className="pressable group flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 transition hover:border-brand/40"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium leading-snug text-ink group-hover:text-brand-ink">
          {d.title}
        </h3>
        {d.isRx && (
          <span className="shrink-0 rounded-md bg-brand-wash px-1.5 py-0.5 text-[11px] font-medium text-brand-ink">
            рецепт
          </span>
        )}
      </div>

      {d.inn && (
        <p className="line-clamp-1 text-xs text-muted" title={d.inn}>
          {d.inn}
        </p>
      )}

      <div className="mt-auto flex items-end justify-between gap-2 pt-1">
        <div>
          <div className="text-lg font-semibold tabular-nums text-ink">
            {d.price ? tenge(d.price) : "—"}
          </div>
          {d.packSize && (
            <div className="text-xs text-muted">
              №{d.packSize}
              {d.price && d.packSize > 1 && (
                <> · {tenge(Math.round(d.price / d.packSize))}/шт</>
              )}
            </div>
          )}
        </div>

        {showGood && (
          <span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-fresh">
            ниже предельной
          </span>
        )}
      </div>
    </Link>
  );
}
