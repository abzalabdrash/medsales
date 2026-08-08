import { db } from "./db";

/** Аптеки: справочник из 2GIS с рейтингами, координатами и ссылкой на карточку. */

export type PharmacyItem = {
  id: string;
  chain: string;
  name: string;
  city: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviews: number | null;
  twogisId: string | null;
  hasCompounding: boolean;
};

type Raw = Record<string, unknown>;

function shape(x: Raw): PharmacyItem {
  return {
    id: x.id as string,
    chain: (x.chain as string) ?? "",
    name: (x.name as string) ?? (x.chain as string) ?? "",
    city: (x.city as string) ?? "",
    address: (x.address as string) ?? null,
    lat: (x.lat as number) ?? null,
    lng: (x.lng as number) ?? null,
    rating: (x.rating as number) ?? null,
    reviews: (x.reviews as number) ?? null,
    twogisId: (x.twogisId as string) ?? null,
    hasCompounding: Boolean(x.hasCompounding),
  };
}

export function listPharmacies(city: string, limit = 60): PharmacyItem[] {
  const rows = db()
    .prepare(
      `SELECT id, chain, name, city, address, lat, lng,
              rating, reviews_count AS reviews, twogis_id AS twogisId,
              has_compounding AS hasCompounding
       FROM pharmacy
       WHERE (? = '' OR city = ?)
       ORDER BY (rating IS NULL), rating DESC, reviews_count DESC
       LIMIT ?`,
    )
    .all(city, city, limit) as Raw[];
  return rows.map(shape);
}

export function pharmacyCities(): { city: string; n: number }[] {
  return db()
    .prepare(
      `SELECT city, COUNT(*) AS n FROM pharmacy
       WHERE city <> '' GROUP BY city ORDER BY n DESC`,
    )
    .all() as { city: string; n: number }[];
}

/** Отзывы о точке: 2GIS и 103.kz лежат рядом, источник всегда виден. */
export function placeReviews(placeId: string, limit = 6) {
  return db()
    .prepare(
      `SELECT rating, text, author, created_at AS createdAt, source
       FROM v_review WHERE place_id = ? AND LENGTH(text) > 40
       ORDER BY (rating IS NULL), LENGTH(text) DESC LIMIT ?`,
    )
    .all(placeId, limit) as {
    rating: number | null;
    text: string;
    author: string | null;
    createdAt: string | null;
    source: string;
  }[];
}
