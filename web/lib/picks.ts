// Scoring for the service picks (cheapest / optimal [+ optional closest]).
// Single source of truth: used server-side (no geo) AND client-side (with geo),
// so the "optimal" verdict is identical on the offers list and in the compare
// table. Fully covered by lib/picks.test.mts (run: npx tsx lib/picks.test.mts).
//
// WHY THIS FORMULA:
//  1) BAYESIAN rating — a clinic with 5.0★ from 1 review must NOT beat 4.9★ from
//     99 reviews. We shrink each rating toward a global average, weighted by how
//     many reviews back it up. Few reviews => pulled toward average; many
//     reviews => trusted as-is.
//  2) QUALITY GATE — a cheap but badly-rated clinic (e.g. 1500₸ / 2.7★) is never
//     crowned "optimal". Only clinics whose Bayesian rating clears the gate are
//     eligible; "optimal" is the best price/quality VALUE among those.
//  "Cheapest" stays purely the lowest price (honest), "optimal" = best value
//  among acceptable-quality clinics.

export type PickCandidate = {
  brandId: string;
  brand: string;
  logo: string | null;
  price: number;
  rating: number | null; // /5
  sentiment: number | null; // 0..1 by review text, null = unknown
  reviewSummary: string | null; // one short RU line about the reviews
  reviews: number | null;
  parsedAt: string;
  // representative (cheapest) branch — for distance, route, call:
  branchId: string;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  workingHours: string | null;
  onlineBooking: boolean;
  durationDays: number | null;
};

export type Coords = { lat: number; lng: number };

export type Picks = {
  cheapest: PickCandidate | null;
  closest: PickCandidate | null; // only when coords are available
  optimal: PickCandidate | null;
};

// ── tunable constants (documented; all covered by picks.test.mts) ──
export const PRIOR_M = 15; // pseudo-reviews of an "average" clinic (shrinkage strength)
export const PRIOR_MEAN5 = 4.0; // assumed average rating (/5) before we trust reviews
export const QUALITY_GATE5 = 3.8; // min Bayesian rating (/5) to be eligible as "optimal"
export const W_NO_GEO = { price: 0.45, quality: 0.55 }; // quality-leaning by design
export const W_GEO = { price: 0.4, quality: 0.45, near: 0.15 };
export const NEAR_KM = 15; // distance (km) that maps to near = 0

export function haversineKm(a: Coords, b: Coords): number {
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

export function hasCoords(c: PickCandidate): c is PickCandidate & Coords {
  return typeof c.lat === "number" && typeof c.lng === "number";
}

// Bayesian-shrunk rating on the /5 scale:
//   (n*rating + M*PRIOR_MEAN) / (n + M)
// n = review count. Small n => pulled toward PRIOR_MEAN5; large n => ~= rating.
// Examples: 5.0★/1rev -> ~4.06 ; 4.9★/99rev -> ~4.78 (so 4.9/99 beats 5.0/1).
export function bayesRating5(c: PickCandidate): number {
  const r = c.rating != null ? c.rating : PRIOR_MEAN5;
  const n = c.reviews != null && c.reviews > 0 ? c.reviews : 0;
  return (n * r + PRIOR_M * PRIOR_MEAN5) / (n + PRIOR_M);
}

// Quality 0..1: mostly the Bayesian rating, nudged by review-text sentiment.
export function quality(c: PickCandidate): number {
  const ratingPart = bayesRating5(c) / 5;
  const sentPart = c.sentiment != null ? c.sentiment : ratingPart;
  return 0.8 * ratingPart + 0.2 * sentPart;
}

// Price score 0..1 within the offer band (cheapest = 1, most expensive = 0).
export function priceScore(price: number, minP: number, maxP: number): number {
  return maxP > minP ? 1 - (price - minP) / (maxP - minP) : 1;
}

// VALUE score (price + quality [+ proximity]). Does NOT apply the quality gate;
// computePicks applies the gate when choosing the single "optimal" pick.
export function optimalScore(
  c: PickCandidate,
  minP: number,
  maxP: number,
  coords?: Coords | null,
): number {
  const ps = priceScore(c.price, minP, maxP);
  const q = quality(c);
  if (coords && hasCoords(c)) {
    const near = 1 - Math.min(haversineKm(coords, c) / NEAR_KM, 1);
    return W_GEO.price * ps + W_GEO.quality * q + W_GEO.near * near;
  }
  return W_NO_GEO.price * ps + W_NO_GEO.quality * q;
}

// Eligible to be "optimal" = Bayesian rating clears the quality gate.
export function isQualityAcceptable(c: PickCandidate): boolean {
  return bayesRating5(c) >= QUALITY_GATE5;
}

export function computePicks(
  candidates: PickCandidate[],
  coords?: Coords | null,
): Picks {
  const withPrice = candidates.filter((c) => c.price != null);
  if (withPrice.length === 0)
    return { cheapest: null, closest: null, optimal: null };

  const prices = withPrice.map((c) => c.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);

  const cheapest = withPrice.reduce((a, b) => (b.price < a.price ? b : a));

  let closest: PickCandidate | null = null;
  if (coords) {
    const geo = withPrice.filter(hasCoords);
    if (geo.length) {
      closest = geo.reduce((a, b) =>
        haversineKm(coords, b) < haversineKm(coords, a) ? b : a,
      );
    }
  }

  // Quality gate: only acceptable-quality clinics compete for "optimal".
  // If none clear the gate, fall back to the whole set so we always return one.
  const acceptable = withPrice.filter(isQualityAcceptable);
  const pool = acceptable.length ? acceptable : withPrice;
  const optimal = pool.reduce((a, b) =>
    optimalScore(b, minP, maxP, coords) > optimalScore(a, minP, maxP, coords)
      ? b
      : a,
  );

  return { cheapest, closest, optimal };
}

// Distance label, e.g. "1,2 км" / "850 м". null when no coords/geo.
export function distanceLabel(
  c: PickCandidate,
  coords: Coords | null | undefined,
): string | null {
  if (!coords || !hasCoords(c)) return null;
  const km = haversineKm(coords, c);
  if (km < 1) return `${Math.round(km * 1000)} м`;
  return `${km.toFixed(1).replace(".", ",")} км`;
}
