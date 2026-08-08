import { MapPin, Star } from "lucide-react";
import type { PharmacyItem } from "@/lib/pharmacies";
import { firmUrlById, pointUrl } from "@/lib/maps";
import { formatRating } from "@/lib/format";

/**
 * Карточка аптеки. Вся карточка — ссылка в 2GIS: пользователю нужна не
 * страница про аптеку, а маршрут до неё. На телефоне 2GIS сам предложит
 * открыть приложение и построить дорогу.
 */
export function PharmacyCard({ p }: { p: PharmacyItem }) {
  const href = p.twogisId
    ? firmUrlById(p.city || "almaty", p.twogisId)
    : p.lat && p.lng
      ? pointUrl(p.city || "almaty", p.lat, p.lng)
      : null;

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-medium leading-snug text-ink">{p.name}</h3>
        {p.rating !== null && (
          <span className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-ink">
            <Star size={14} className="fill-brand text-brand" aria-hidden />
            {formatRating(p.rating)}
          </span>
        )}
      </div>

      {p.address && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-muted">
          <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden />
          <span className="line-clamp-2">{p.address}</span>
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className="text-xs text-muted">
          {p.reviews ? `${p.reviews.toLocaleString("ru-RU")} отзывов` : " "}
        </span>
        {p.hasCompounding && (
          <span
            className="rounded-md bg-brand-wash px-1.5 py-0.5 text-[11px] font-medium text-brand-ink"
            title="Здесь изготавливают препараты по рецепту врача — болтушки, мази"
          >
            производственный отдел
          </span>
        )}
        {href && (
          <span className="text-xs font-medium text-brand-ink">
            открыть в 2GIS →
          </span>
        )}
      </div>
    </>
  );

  const cls =
    "pressable flex h-full flex-col rounded-xl border border-line bg-surface p-4 transition hover:border-brand/40";

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {inner}
    </a>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
