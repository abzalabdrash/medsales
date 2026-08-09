"use client";

import { useEffect } from "react";
import Link from "next/link";
import { X, Phone, Check, CalendarCheck } from "lucide-react";
import type { PickCandidate, Coords } from "@/lib/picks";
import { computePicks, distanceLabel, haversineKm, hasCoords } from "@/lib/picks";
import { tenge } from "@/lib/format";
import { freshness } from "@/lib/i18n";
import { isOpenNow, termDaysLabel } from "@/lib/schedule";
import { telUrl } from "@/lib/maps";
import { withCity } from "@/lib/url";
import { Avatar } from "./Avatar";
import { Rating } from "./Rating";
import { RouteMenu } from "./RouteMenu";
import { useI18n } from "./I18nProvider";

const BEST = "color-mix(in oklch, var(--color-fresh) 16%, transparent)";

export function CompareTable({
  items,
  coords,
  city,
  onClose,
  onRemove,
}: {
  items: PickCandidate[];
  coords: Coords | null;
  city: string;
  onClose: () => void;
  onRemove: (id: string) => void;
}) {
  const { locale, t } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const winner = computePicks(items, coords).optimal?.brandId ?? null;

  // per-criterion best value
  const minPrice = Math.min(...items.map((c) => c.price));
  const ratings = items.map((c) => c.rating).filter((r): r is number => r != null);
  const maxRating = ratings.length ? Math.max(...ratings) : null;
  const dists = coords
    ? items.filter(hasCoords).map((c) => haversineKm(coords, c))
    : [];
  const minDist = dists.length ? Math.min(...dists) : null;
  const terms = items
    .map((c) => c.durationDays)
    .filter((d): d is number => d != null && d > 0);
  const minTerm = terms.length ? Math.min(...terms) : null;
  const days = (p: string) => {
    const ts = Date.parse(p.replace(" ", "T") + "Z");
    return Number.isNaN(ts) ? Infinity : (Date.now() - ts) / 86_400_000;
  };
  const freshest = Math.min(...items.map((c) => days(c.parsedAt)));

  const th =
    "sticky left-0 z-10 bg-surface px-3 py-3 text-left align-middle text-sm font-medium text-muted border-r border-line min-w-[150px]";
  const td =
    "px-3 py-3 align-middle text-center min-w-[180px] border-l border-line";

  function cell(best: boolean, children: React.ReactNode, key: string) {
    return (
      <td
        key={key}
        className={td}
        style={best ? { background: BEST } : undefined}
      >
        {children}
      </td>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t.compareTitle}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-t-3xl bg-paper shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-lg font-semibold">{t.compareTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            className="pressable grid h-11 w-11 place-items-center rounded-xl border border-line bg-paper"
            aria-label={t.cancel}
          >
            <X size={20} aria-hidden />
          </button>
        </div>

        <div className="overflow-auto">
          <table className="w-full border-collapse text-[15px]">
            <thead>
              <tr className="border-b border-line">
                <th className={`${th} bg-surface`}>{t.compareTitle}</th>
                {items.map((c) => (
                  <th key={c.brandId} className={`${td} border-l-0`}>
                    <div className="flex flex-col items-center gap-1.5">
                      <Avatar name={c.brand} logo={c.logo} size={40} />
                      <Link
                        href={withCity(`/klinika/${c.brandId}`, city)}
                        className="line-clamp-2 font-semibold leading-tight hover:text-brand-ink"
                      >
                        {c.brand}
                      </Link>
                      <button
                        type="button"
                        onClick={() => onRemove(c.brandId)}
                        aria-label={t.compareClear}
                        className="pressable inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2"
                      >
                        <X size={15} aria-hidden />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* price */}
              <tr className="border-b border-line">
                <td className={th}>{t.priceWord}</td>
                {items.map((c) =>
                  cell(
                    c.price === minPrice,
                    <span className="text-lg font-bold tabular-nums text-brand-ink">
                      {tenge(c.price)}
                    </span>,
                    c.brandId,
                  ),
                )}
              </tr>
              {/* rating */}
              <tr className="border-b border-line">
                <td className={th}>{t.rowRating}</td>
                {items.map((c) =>
                  cell(
                    maxRating != null && c.rating === maxRating,
                    c.rating != null ? (
                      <span className="inline-flex justify-center">
                        <Rating value={c.rating} reviews={c.reviews} />
                      </span>
                    ) : (
                      <span className="text-muted">{t.noData}</span>
                    ),
                    c.brandId,
                  ),
                )}
              </tr>
              {/* sentiment summary */}
              <tr className="border-b border-line">
                <td className={th}>{t.rowSentiment}</td>
                {items.map((c) =>
                  cell(
                    false,
                    c.reviewSummary ? (
                      <span className="text-sm text-ink">{c.reviewSummary}</span>
                    ) : (
                      <span className="text-muted">{t.noData}</span>
                    ),
                    c.brandId,
                  ),
                )}
              </tr>
              {/* distance */}
              {coords && (
                <tr className="border-b border-line">
                  <td className={th}>{t.rowDistance}</td>
                  {items.map((c) => {
                    const dl = distanceLabel(c, coords);
                    const isMin =
                      minDist != null &&
                      hasCoords(c) &&
                      Math.abs(haversineKm(coords, c) - minDist) < 1e-6;
                    return cell(
                      isMin,
                      dl ? (
                        <span className="tabular-nums">{dl}</span>
                      ) : (
                        <span className="text-muted">{t.noData}</span>
                      ),
                      c.brandId,
                    );
                  })}
                </tr>
              )}
              {/* schedule */}
              <tr className="border-b border-line">
                <td className={th}>{t.rowSchedule}</td>
                {items.map((c) => {
                  const open = isOpenNow(c.workingHours);
                  return cell(
                    open === true,
                    open == null ? (
                      <span className="text-muted">{t.scheduleUnknown}</span>
                    ) : open ? (
                      <span className="font-medium text-fresh">{t.openNow}</span>
                    ) : (
                      <span className="text-muted">{t.closedNow}</span>
                    ),
                    c.brandId,
                  );
                })}
              </tr>
              {/* online booking */}
              <tr className="border-b border-line">
                <td className={th}>{t.rowBooking}</td>
                {items.map((c) =>
                  cell(
                    c.onlineBooking,
                    c.onlineBooking ? (
                      <span className="inline-flex items-center gap-1 font-medium text-fresh">
                        <CalendarCheck size={16} aria-hidden /> {t.onlineBookingYes}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                    c.brandId,
                  ),
                )}
              </tr>
              {/* term */}
              {minTerm != null && (
                <tr className="border-b border-line">
                  <td className={th}>{t.rowTerm}</td>
                  {items.map((c) =>
                    cell(
                      c.durationDays != null && c.durationDays === minTerm,
                      termDaysLabel(c.durationDays) ? (
                        <span className="tabular-nums">
                          {termDaysLabel(c.durationDays)}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      ),
                      c.brandId,
                    ),
                  )}
                </tr>
              )}
              {/* Строка с датой обхода скрыта до следующего обновления
                  прайсов клиник, см. FreshnessBadge. */}
              {/* actions */}
              <tr className="border-b border-line">
                <td className={th}>{t.rowActions}</td>
                {items.map((c) => (
                  <td key={c.brandId} className={td}>
                    <div className="flex flex-col items-center gap-2">
                      {c.phone && (
                        <a
                          href={telUrl(c.phone)}
                          className="pressable inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-sm font-medium"
                        >
                          <Phone size={16} aria-hidden /> {t.call}
                        </a>
                      )}
                      {hasCoords(c) && (
                        <RouteMenu
                          city={city}
                          lat={c.lat}
                          lng={c.lng}
                          label={t.route}
                          className="pressable inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-line bg-paper px-3 text-sm font-medium"
                        />
                      )}
                    </div>
                  </td>
                ))}
              </tr>
              {/* verdict */}
              <tr className="bg-surface">
                <td className={`${th} bg-surface font-semibold text-ink`}>
                  {t.verdict}
                </td>
                {items.map((c) =>
                  cell(
                    c.brandId === winner,
                    c.brandId === winner ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-fresh">
                        <Check size={18} aria-hidden strokeWidth={2.5} />
                        {t.pickOptimal}
                      </span>
                    ) : (
                      <span className="text-muted">—</span>
                    ),
                    c.brandId,
                  ),
                )}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
