"use client";

import Link from "next/link";
import {
  Map as MapIcon,
  Phone,
  MessageCircle,
  CalendarCheck,
  Check,
  Plus,
  Wallet,
  Navigation,
  Award,
} from "lucide-react";
import type { Offer, ServiceLocation } from "@/lib/db";
import { tenge } from "@/lib/format";
import { branchesLabel } from "@/lib/i18n";
import { telUrl, whatsappUrl, hasGeo } from "@/lib/maps";
import { withCity } from "@/lib/url";
import { Avatar } from "./Avatar";
import { FreshnessBadge } from "./FreshnessBadge";
import { Rating } from "./Rating";
import { RouteMenu } from "./RouteMenu";
import { FavoriteButton } from "./FavoriteButton";
import { OfferWatchButton } from "./OfferWatchButton";
import { useI18n } from "./I18nProvider";

const WA_TEXT: Record<string, string> = {
  ru: "Здравствуйте! Пишу с сайта MedSales, хочу уточнить цену на услугу.",
  kk: "Сәлеметсіз бе! MedSales сайтынан жазып отырмын, қызмет бағасын білгім келеді.",
};

export function OfferRow({
  offer,
  loc,
  city,
  serviceId,
  serviceName,
  badges,
  distance,
  onShowMap,
  selected,
  onToggleCompare,
  compareFull,
}: {
  offer: Offer;
  loc?: ServiceLocation;
  city: string;
  serviceId: string;
  serviceName: string;
  badges?: ("cheapest" | "closest" | "optimal")[];
  distance?: string | null;
  onShowMap: (id: string) => void;
  selected: boolean;
  onToggleCompare: (id: string) => void;
  compareFull: boolean;
}) {
  const { locale, t } = useI18n();
  const brandId = String(offer.brandId);
  const priceLabel =
    offer.maxPrice && offer.maxPrice !== offer.minPrice
      ? `${tenge(offer.minPrice)} – ${tenge(offer.maxPrice)}`
      : tenge(offer.minPrice);

  const wa = whatsappUrl(loc?.phone, WA_TEXT[locale]);
  const btn =
    "pressable relative z-10 inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-line bg-paper px-3 text-sm font-medium";
  const moreLabel = locale === "kk" ? "толығырақ" : "подробнее";
  const compareDisabled = !selected && compareFull;

  return (
    <div
      className={`relative rounded-2xl border bg-surface p-4 transition-colors hover:bg-surface-2 ${
        selected ? "border-brand" : "border-line"
      }`}
    >
      <Link
        href={withCity(`/klinika/${brandId}`, city)}
        className="absolute inset-0 rounded-2xl"
        aria-label={`${offer.brand}: ${moreLabel}`}
      />
      <div className="pointer-events-none relative z-10 flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={offer.brand} logo={offer.logo} size={44} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-lg font-semibold">{offer.brand}</h3>
              <Rating value={offer.rating} reviews={offer.reviews} />
            </div>
            {badges && badges.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {badges.includes("optimal") && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-brand/40 bg-brand-wash px-2 py-0.5 text-xs font-semibold text-brand-ink">
                    <Award size={13} aria-hidden /> {t.pickOptimal}
                  </span>
                )}
                {badges.includes("cheapest") && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-fresh/40 px-2 py-0.5 text-xs font-semibold text-fresh">
                    <Wallet size={13} aria-hidden /> {t.pickCheapest}
                  </span>
                )}
                {badges.includes("closest") && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs font-semibold text-ink">
                    <Navigation size={13} aria-hidden /> {t.pickClosest}
                  </span>
                )}
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <FreshnessBadge parsedAt={offer.parsedAt} />
              <span className="text-sm text-muted">
                {branchesLabel(locale, offer.branches)}
              </span>
              {distance && (
                <span className="text-sm text-muted">{distance}</span>
              )}
              {offer.onlineBooking && (
                <span className="inline-flex items-center gap-1 text-sm font-medium text-fresh">
                  <CalendarCheck size={15} aria-hidden /> {t.onlineBookingYes}
                </span>
              )}
              {loc?.address ? (
                <span className="hidden max-w-[260px] truncate text-sm text-muted sm:inline">
                  {loc.address}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="pointer-events-auto mb-1 flex justify-end gap-1.5">
            <FavoriteButton
              variant="compact"
              fav={{
                kind: "offer",
                clinicId: brandId,
                clinicName: offer.brand,
                serviceId,
                serviceName,
                city,
                price: offer.minPrice,
              }}
            />
            <OfferWatchButton
              clinicId={brandId}
              serviceId={serviceId}
              clinicName={offer.brand}
              serviceName={serviceName}
              city={city}
              price={offer.minPrice}
            />
          </div>
          <div className="text-2xl font-bold tabular-nums text-brand-ink sm:text-[26px]">
            {priceLabel}
          </div>
        </div>
      </div>
      <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onToggleCompare(brandId)}
          disabled={compareDisabled}
          aria-pressed={selected}
          className={`pressable inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3 text-sm font-medium disabled:opacity-40 ${
            selected
              ? "border-brand bg-brand-wash text-brand-ink"
              : "border-line bg-paper"
          }`}
        >
          {selected ? (
            <Check size={18} aria-hidden />
          ) : (
            <Plus size={18} aria-hidden />
          )}
          {selected ? t.compareAdded : t.compareAdd}
        </button>
        {loc && hasGeo(loc) && (
          <>
            <button
              type="button"
              onClick={() => onShowMap(brandId)}
              className={btn}
            >
              <MapIcon size={18} aria-hidden /> {t.onMap}
            </button>
            <RouteMenu
              city={city}
              lat={loc.lat}
              lng={loc.lng}
              label={t.route}
              className={btn}
            />
          </>
        )}
        {offer.onlineBooking && loc?.sourceUrl && (
          <a
            href={loc.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${btn} border-brand bg-brand-wash text-brand-ink`}
          >
            <CalendarCheck size={18} aria-hidden /> {t.book}
          </a>
        )}
        {loc?.phone && (
          <a href={telUrl(loc.phone)} className={btn}>
            <Phone size={18} aria-hidden /> {loc.phone}
          </a>
        )}
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className={btn}
          >
            <MessageCircle size={18} aria-hidden /> {t.write}
          </a>
        )}
      </div>
    </div>
  );
}
