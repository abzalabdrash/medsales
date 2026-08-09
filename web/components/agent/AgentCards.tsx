import Link from "next/link";
import { MapPin, Phone, Pill, Gift, Calculator, Building2, ChevronRight } from "lucide-react";
import type { Card } from "@/lib/agent/cards";
import { tenge } from "@/lib/format";

/**
 * Карточки ответа помощника.
 *
 * Помощник не рассказывает про цены словами, а показывает их карточками, по
 * которым можно нажать и попасть на страницу препарата. Так ответ это не
 * текст, который надо перечитывать, а список действий.
 *
 * Все числа и адреса приходят из базы. Компонент ничего не вычисляет: если
 * значения нет, показывается прочерк, а не догадка.
 */

const BOX = "rounded-xl border border-line bg-surface p-3";

export function AgentCard({ card }: { card: Card }) {
  switch (card.kind) {
    case "drug":
      return (
        <Link
          href={card.href}
          className={`${BOX} pressable flex items-start gap-3 transition hover:border-brand/40`}
        >
          <Pill size={16} className="mt-0.5 shrink-0 text-brand-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-medium text-ink">{card.title}</span>
              {card.price !== null && (
                <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                  {tenge(card.price)}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted">
              {[
                card.inn,
                card.packSize ? `${card.packSize} шт.` : null,
                card.manufacturer,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {card.isRx && (
              <span className="mt-1.5 inline-block rounded-md bg-brand-wash px-1.5 py-0.5 text-[11px] font-medium text-brand-ink">
                по рецепту
              </span>
            )}
          </div>
          <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
        </Link>
      );

    case "pharmacyPrice":
      return (
        <div className={BOX}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-ink">{card.title}</span>
            {card.cheapest !== null && (
              <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                от {tenge(card.cheapest)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {card.storesTotal && card.storesTotal > card.shown
              ? `${card.shown} самых дешевых из ${card.storesTotal} аптек`
              : `${card.shown} аптек`}
          </p>

          <ul className="mt-2 space-y-2">
            {card.rows.map((r, i) => (
              <li key={i} className="border-t border-line/60 pt-2 first:border-0 first:pt-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink">{r.pharmacy}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-ink">
                    {tenge(r.price)}
                  </span>
                </div>
                {r.address && (
                  <a
                    href={r.twogisUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 flex items-start gap-1 text-[11px] text-muted hover:text-brand-ink"
                  >
                    <MapPin size={11} className="mt-0.5 shrink-0" aria-hidden />
                    <span className="line-clamp-1">{r.address}</span>
                  </a>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                  {r.phone && (
                    <a href={`tel:${r.phone.split(",")[0].trim()}`} className="flex items-center gap-1 hover:text-brand-ink">
                      <Phone size={10} aria-hidden />
                      {r.phone.split(",")[0].trim()}
                    </a>
                  )}
                  {r.packSize && <span>{r.packSize} шт.</span>}
                  {r.updated && <span>{r.updated}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      );

    case "free":
      return (
        <div className="rounded-xl border border-fresh/40 bg-fresh/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Gift size={16} className="text-fresh" aria-hidden />
            Возможно, положено бесплатно
          </div>
          <p className="mt-1 text-xs text-muted">
            {card.matchedBy === "atc"
              ? "Совпадение по коду ATC в перечне Минздрава."
              : "Совпадение по названию вещества, поэтому только как предположение."}{" "}
            Зависит от диагноза и наблюдения, уточните у врача.
          </p>
          <ul className="mt-2 space-y-1">
            {card.items.map((x, i) => (
              <li key={i} className="text-xs text-ink">
                <span className="font-medium">{x.drugName}</span>
                {x.disease && <span className="text-muted"> · {x.disease}</span>}
                {x.mkb10 && <span className="text-muted"> · {x.mkb10}</span>}
              </li>
            ))}
          </ul>
        </div>
      );

    case "course":
      return (
        <div className={BOX}>
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Calculator size={16} className="text-brand-ink" aria-hidden />
            Расчет курса
          </div>
          <p className="mt-1 text-xs text-muted">{card.explainer}</p>
          {card.coursePrice !== null && (
            <p className="mt-1.5 text-sm font-semibold tabular-nums text-ink">
              {tenge(card.coursePrice)} за курс
              {card.packs !== null && (
                <span className="ml-1 text-xs font-normal text-muted">
                  ({card.packs} уп.)
                </span>
              )}
            </p>
          )}
          {card.warning && (
            <p className="mt-1 text-xs text-muted">{card.warning}</p>
          )}
        </div>
      );

    case "service":
      return (
        <Link href={card.href} className={`${BOX} pressable block transition hover:border-brand/40`}>
          <span className="text-sm font-medium text-ink">{card.title}</span>
          <ul className="mt-2 space-y-1">
            {card.rows.map((r, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate text-muted">{r.clinic}</span>
                {r.price !== null && (
                  <span className="shrink-0 font-semibold tabular-nums text-ink">
                    {tenge(r.price)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Link>
      );

    case "pharmacy":
      return (
        <div className={BOX}>
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Building2 size={16} className="text-brand-ink" aria-hidden />
            Аптеки рядом
          </div>
          <ul className="mt-2 space-y-1.5">
            {card.rows.map((r, i) => (
              <li key={i} className="text-xs">
                <span className="font-medium text-ink">{r.name}</span>
                {r.address && <div className="text-muted">{r.address}</div>}
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

/** Позиции, распознанные с фотографии назначения. */
export function PrescriptionCard({
  items,
}: {
  items: {
    name: string;
    dosage?: string | null;
    timesPerDay?: number | null;
    days?: number | null;
    confidence?: number | null;
  }[];
}) {
  return (
    <div className={BOX}>
      <span className="text-sm font-medium text-ink">
        С фото распознано: {items.length}
      </span>
      <ul className="mt-2 space-y-1.5">
        {items.map((x, i) => {
          // Низкую уверенность показываем честно: человек должен видеть,
          // где машина угадывала, а не узнать об этом в аптеке.
          const unsure = (x.confidence ?? 1) < 0.7;
          return (
            <li key={i} className="text-xs">
              <span className={unsure ? "text-muted" : "font-medium text-ink"}>
                {x.name}
              </span>
              {x.dosage && <span className="text-muted"> · {x.dosage}</span>}
              {x.timesPerDay && x.days && (
                <span className="text-muted">
                  {" "}
                  · {x.timesPerDay} р/день × {x.days} дн
                </span>
              )}
              {unsure && (
                <span className="ml-1 rounded bg-brand-wash px-1 text-[10px] text-brand-ink">
                  проверьте
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
