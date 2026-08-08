"use client";

import { useMemo, useState } from "react";
import {
  Map as MapIcon,
  SlidersHorizontal,
  X,
  CalendarCheck,
  Scale,
} from "lucide-react";
import type { Offer, ServiceLocation } from "@/lib/db";
import type { PickCandidate } from "@/lib/picks";
import { computePicks, distanceLabel } from "@/lib/picks";
import { tenge } from "@/lib/format";
import { hasGeo } from "@/lib/maps";
import { clinicsLabel, type Dict } from "@/lib/i18n";
import { useUserCoords } from "@/lib/profile";
import { OfferRow } from "./OfferRow";
import { LazyMap } from "./LazyMap";
import type { MapPoint } from "./MapView";
import { CompareTable } from "./CompareTable";
import { useI18n } from "./I18nProvider";

const MAX_COMPARE = 4;

type Sort = "price" | "price_desc" | "rating" | "near";

// Quick price presets — they just set the [lo, hi] range below.
const PRESETS: { key: string; lo: number | null; hi: number | null }[] = [
  { key: "all", lo: null, hi: null },
  { key: "lt5000", lo: null, hi: 5000 },
  { key: "mid", lo: 5000, hi: 15000 },
  { key: "gt15000", lo: 15000, hi: null },
];

function presetLabel(t: Dict, key: string): string {
  if (key === "lt5000") return t.bandLt;
  if (key === "mid") return t.bandMid;
  if (key === "gt15000") return t.bandGt;
  return t.bandAny;
}

function sortText(t: Dict, key: Sort): string {
  if (key === "price_desc") return t.sortPriceDesc;
  if (key === "rating") return t.sortRating;
  if (key === "near") return t.sortNear;
  return t.sortPriceAsc;
}

function haversine(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function OffersView({
  offers,
  locations,
  candidates,
  city,
  serviceId,
  serviceName,
}: {
  offers: Offer[];
  locations: ServiceLocation[];
  candidates: PickCandidate[];
  city: string;
  serviceId: string;
  serviceName: string;
}) {
  const { locale, t } = useI18n();
  const { coords } = useUserCoords();
  const [sort, setSort] = useState<Sort>("price");
  const [lo, setLo] = useState<number | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [ratingOnly, setRatingOnly] = useState(false);
  const [bookingOnly, setBookingOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | undefined>();
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [geoState, setGeoState] = useState<"idle" | "loading" | "denied">(
    "idle",
  );

  // Price domain from the data, rounded to a friendly step for the slider.
  const [minP, maxP, step] = useMemo(() => {
    if (!offers.length) return [0, 100000, 100];
    const ps = offers.map((o) => o.minPrice);
    const lo0 = Math.min(...ps);
    const hi0 = Math.max(...ps);
    const st = Math.max(100, Math.round((hi0 - lo0) / 100 / 100) * 100 || 100);
    return [Math.floor(lo0 / st) * st, Math.ceil(hi0 / st) * st, st];
  }, [offers]);

  const effLo = lo ?? minP;
  const effHi = hi ?? maxP;
  const priceActive = lo != null || hi != null;

  const locByBrand = useMemo(() => {
    const m = new Map<string, ServiceLocation>();
    for (const l of locations) {
      const k = String(l.brandId);
      if (!m.has(k)) m.set(k, l);
    }
    return m;
  }, [locations]);

  const ratingAvailable = useMemo(
    () => offers.filter((o) => o.rating != null).length >= 2,
    [offers],
  );
  const bookingAvailable = useMemo(
    () => offers.some((o) => o.onlineBooking),
    [offers],
  );
  const geoAvailable = useMemo(
    () => locations.some((l) => hasGeo(l)),
    [locations],
  );

  const candByBrand = useMemo(() => {
    const m = new Map<string, PickCandidate>();
    for (const c of candidates) m.set(String(c.brandId), c);
    return m;
  }, [candidates]);

  // Pick badges shown on the list itself (replaces the separate top-3 cards).
  const geoForPicks = coords ?? userPos;
  const badgeByBrand = useMemo(() => {
    const picks = computePicks(candidates, geoForPicks);
    const m = new Map<string, ("cheapest" | "closest" | "optimal")[]>();
    const add = (id: string, k: "cheapest" | "closest" | "optimal") => {
      const key = String(id);
      const arr = m.get(key) ?? [];
      if (!arr.includes(k)) arr.push(k);
      m.set(key, arr);
    };
    if (picks.optimal) add(picks.optimal.brandId, "optimal");
    if (picks.cheapest) add(picks.cheapest.brandId, "cheapest");
    return m;
  }, [candidates, geoForPicks]);

  // Distance label per clinic (grey, minimalist) — shown when geo is available.
  const distByBrand = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const c of candidates)
      m.set(String(c.brandId), distanceLabel(c, geoForPicks));
    return m;
  }, [candidates, geoForPicks]);

  const visible = useMemo(() => {
    let r = offers.filter((o) => o.minPrice >= effLo && o.minPrice <= effHi);
    if (ratingOnly) r = r.filter((o) => (o.rating ?? 0) >= 4);
    if (bookingOnly) r = r.filter((o) => o.onlineBooking);
    r = [...r];
    if (sort === "price") r.sort((a, z) => a.minPrice - z.minPrice);
    else if (sort === "price_desc") r.sort((a, z) => z.minPrice - a.minPrice);
    else if (sort === "rating")
      r.sort((a, z) => (z.rating ?? -1) - (a.rating ?? -1));
    else if (sort === "near") {
      const dist = (o: Offer) => {
        if (!userPos) return Infinity;
        const l = locByBrand.get(String(o.brandId));
        if (!l || !hasGeo(l)) return Infinity;
        return haversine(userPos, { lat: l.lat, lng: l.lng });
      };
      r.sort((a, z) => dist(a) - dist(z));
    }
    return r;
  }, [
    offers,
    effLo,
    effHi,
    sort,
    ratingOnly,
    bookingOnly,
    userPos,
    locByBrand,
  ]);

  const mapPoints: MapPoint[] = useMemo(
    () =>
      visible
        .map((o) => locByBrand.get(String(o.brandId)))
        .filter((l): l is ServiceLocation => !!l && hasGeo(l))
        .map((l) => ({
          id: String(l.brandId),
          label: l.brand,
          price: l.price,
          lat: l.lat as number,
          lng: l.lng as number,
          address: l.address,
        })),
    [visible, locByBrand],
  );

  function onSortChange(v: Sort) {
    setSort(v);
    if (v === "near" && !userPos) {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        setGeoState("denied");
        return;
      }
      setGeoState("loading");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGeoState("idle");
        },
        () => setGeoState("denied"),
        { enableHighAccuracy: false, timeout: 8000 },
      );
    }
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setLo(p.lo);
    setHi(p.hi);
  }
  const activePreset =
    PRESETS.find((p) => p.lo === lo && p.hi === hi)?.key ??
    (priceActive ? "custom" : "all");

  const activeCount =
    (priceActive ? 1 : 0) + (ratingOnly ? 1 : 0) + (bookingOnly ? 1 : 0);

  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (priceActive)
    chips.push({
      key: "price",
      label: `${tenge(effLo)} – ${tenge(effHi)}`,
      clear: () => {
        setLo(null);
        setHi(null);
      },
    });
  if (ratingOnly)
    chips.push({
      key: "rating",
      label: t.ratingOnly,
      clear: () => setRatingOnly(false),
    });
  if (bookingOnly)
    chips.push({
      key: "booking",
      label: t.onlyOnlineBooking,
      clear: () => setBookingOnly(false),
    });
  if (sort !== "price")
    chips.push({
      key: "sort",
      label: sortText(t, sort),
      clear: () => setSort("price"),
    });

  function resetAll() {
    setLo(null);
    setHi(null);
    setSort("price");
    setRatingOnly(false);
    setBookingOnly(false);
  }

  // ── compare selection ──
  function toggleCompare(id: string) {
    setCompare((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length >= MAX_COMPARE
          ? prev
          : [...prev, id],
    );
  }
  const compareItems = useMemo(
    () =>
      compare
        .map((id) => candByBrand.get(id))
        .filter((c): c is PickCandidate => !!c),
    [compare, candByBrand],
  );

  function showOnMap(id: string) {
    setFocusId(id);
    setMapOpen(true);
    setTimeout(
      () =>
        document
          .getElementById("offers-map")
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      60,
    );
  }

  const pill = (active: boolean) =>
    `pressable min-h-[40px] rounded-full border px-3 text-sm font-medium ${
      active
        ? "border-brand bg-brand-wash text-brand-ink"
        : "border-line bg-paper text-ink"
    }`;

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(340px,400px)]">
        <div className="min-w-0">
          {/* control bar: sort is primary + a gear that opens price/rating filters */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              className={pill(filtersOpen || activeCount > 0)}
            >
              <span className="inline-flex items-center gap-1.5">
                <SlidersHorizontal size={16} aria-hidden /> {t.filters}
                {activeCount > 0 && (
                  <span className="rounded-full bg-brand px-1.5 text-xs text-white">
                    {activeCount}
                  </span>
                )}
              </span>
            </button>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-muted">
              {t.sortLabel}
              <select
                value={sort}
                onChange={(e) => onSortChange(e.target.value as Sort)}
                className="pressable min-h-[40px] rounded-full border border-line bg-paper px-3 text-sm font-medium text-ink"
              >
                <option value="price">{t.sortPriceAsc}</option>
                <option value="price_desc">{t.sortPriceDesc}</option>
                {ratingAvailable && (
                  <option value="rating">{t.sortRating}</option>
                )}
                {geoAvailable && <option value="near">{t.sortNear}</option>}
              </select>
            </label>
          </div>

          {filtersOpen && (
            <div className="mb-3 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
              <div>
                <div className="mb-2 text-sm font-medium text-muted">
                  {t.priceWord}
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => applyPreset(p)}
                      aria-pressed={activePreset === p.key}
                      className={pill(activePreset === p.key)}
                    >
                      {presetLabel(t, p.key)}
                    </button>
                  ))}
                </div>
                {/* single dual-handle range slider */}
                <div className="mt-4">
                  <div className="mb-2 text-sm tabular-nums text-ink">
                    {tenge(effLo)} – {tenge(effHi)}
                  </div>
                  <div className="dual-range relative h-5">
                    <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-surface-2" />
                    <div
                      className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand"
                      style={{
                        left: `${((effLo - minP) / (maxP - minP || 1)) * 100}%`,
                        right: `${100 - ((effHi - minP) / (maxP - minP || 1)) * 100}%`,
                      }}
                    />
                    <input
                      type="range"
                      min={minP}
                      max={maxP}
                      step={step}
                      value={effLo}
                      onChange={(e) => {
                        const v = Math.min(
                          Number(e.target.value),
                          effHi - step,
                        );
                        setLo(v <= minP ? null : v);
                      }}
                      aria-label={t.statFrom}
                    />
                    <input
                      type="range"
                      min={minP}
                      max={maxP}
                      step={step}
                      value={effHi}
                      onChange={(e) => {
                        const v = Math.max(
                          Number(e.target.value),
                          effLo + step,
                        );
                        setHi(v >= maxP ? null : v);
                      }}
                      aria-label={t.statTo}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {ratingAvailable && (
                  <button
                    type="button"
                    onClick={() => setRatingOnly((v) => !v)}
                    aria-pressed={ratingOnly}
                    className={pill(ratingOnly)}
                  >
                    {t.ratingOnly}
                  </button>
                )}
                {bookingAvailable && (
                  <button
                    type="button"
                    onClick={() => setBookingOnly((v) => !v)}
                    aria-pressed={bookingOnly}
                    className={`${pill(bookingOnly)} inline-flex items-center gap-1.5`}
                  >
                    <CalendarCheck size={16} aria-hidden />{" "}
                    {t.onlyOnlineBooking}
                  </button>
                )}
              </div>
            </div>
          )}

          {chips.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.clear}
                  className="pressable inline-flex min-h-[36px] items-center gap-1 rounded-full bg-surface-2 px-3 text-sm"
                >
                  {c.label} <X size={14} aria-hidden />
                </button>
              ))}
              <button
                type="button"
                onClick={resetAll}
                className="pressable min-h-[36px] rounded-full px-3 text-sm font-medium text-brand-ink"
              >
                {t.resetFilters}
              </button>
            </div>
          )}

          {sort === "near" && geoState === "loading" && (
            <p className="mb-3 text-sm text-muted">{t.geoLoading}</p>
          )}
          {sort === "near" && geoState === "denied" && (
            <p className="mb-3 text-sm text-brand-ink">{t.geoDenied}</p>
          )}

          <p className="mb-3 text-sm text-muted">
            {clinicsLabel(locale, visible.length)}
          </p>

          <button
            type="button"
            onClick={() => setMapOpen((v) => !v)}
            className="pressable mb-3 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper font-medium lg:hidden"
          >
            <MapIcon size={20} aria-hidden /> {mapOpen ? t.hideMap : t.showMap}
          </button>
          {mapOpen && mapPoints.length > 0 && (
            <div id="offers-map" className="mb-4 lg:hidden">
              <LazyMap points={mapPoints} activeId={focusId} />
            </div>
          )}

          {visible.length > 0 ? (
            <div className="flex flex-col gap-3">
              {visible.map((o) => (
                <OfferRow
                  key={String(o.brandId)}
                  offer={o}
                  loc={locByBrand.get(String(o.brandId))}
                  city={city}
                  serviceId={serviceId}
                  serviceName={serviceName}
                  badges={badgeByBrand.get(String(o.brandId))}
                  distance={distByBrand.get(String(o.brandId)) ?? null}
                  onShowMap={showOnMap}
                  selected={compare.includes(String(o.brandId))}
                  onToggleCompare={toggleCompare}
                  compareFull={compare.length >= MAX_COMPARE}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-line bg-surface px-6 py-10 text-center text-muted">
              {t.nothingByFilters}{" "}
              <button
                type="button"
                onClick={resetAll}
                className="font-medium text-brand-ink"
              >
                {t.resetFilters}
              </button>
            </div>
          )}
        </div>

        <aside className="hidden lg:block">
          {mapPoints.length > 0 ? (
            <div className="sticky top-20">
              <LazyMap points={mapPoints} height={520} activeId={focusId} />
            </div>
          ) : (
            <div className="sticky top-20 rounded-2xl border border-line bg-surface p-6 text-center text-muted">
              {t.noMapPointsClinics}
            </div>
          )}
        </aside>
      </div>

      {/* floating compare bar */}
      {compare.length > 0 && !compareOpen && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4">
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-paper/95 p-2 pl-4 shadow-lg backdrop-blur">
            <span className="text-sm font-medium text-muted">
              {compare.length < 2
                ? t.compareHint
                : `${compare.length} / ${MAX_COMPARE}`}
            </span>
            <button
              type="button"
              onClick={() => setCompare([])}
              className="pressable min-h-[44px] rounded-xl px-3 text-sm font-medium text-muted"
            >
              {t.compareClear}
            </button>
            <button
              type="button"
              onClick={() => setCompareOpen(true)}
              disabled={compare.length < 2}
              className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-40"
            >
              <Scale size={18} aria-hidden /> {t.compareOpen} ({compare.length})
            </button>
          </div>
        </div>
      )}

      {compareOpen && compareItems.length >= 2 && (
        <CompareTable
          items={compareItems}
          coords={coords}
          city={city}
          onClose={() => setCompareOpen(false)}
          onRemove={toggleCompare}
        />
      )}
    </>
  );
}
