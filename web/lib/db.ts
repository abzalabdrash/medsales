import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PickCandidate } from "./picks";

// Read-only connection to the parser's SQLite DB. node:sqlite is built into
// Node 24 -> no native module to compile (deploys cleanly on Railway/Render).
let _db: DatabaseSync | null = null;
// Exported so lib/drugs.ts reuses the same read-only handle instead of
// opening a second connection to the same file.
export function db(): DatabaseSync {
  if (!_db) {
    // Accepts MEDPRICE_DB (raw path) or MEDPRICE_DB_URL (sqlite:///data/medsales.db).
    // Tries several locations so local (repo/data) and Vercel (web/data) both work.
    const url = process.env.MEDPRICE_DB_URL || "";
    const fromUrl = url ? url.replace(/^sqlite:\/+/i, "") : "";
    const candidates: string[] = [];
    if (process.env.MEDPRICE_DB) candidates.push(process.env.MEDPRICE_DB);
    if (fromUrl) {
      candidates.push(
        path.isAbsolute(fromUrl) ? fromUrl : path.resolve(process.cwd(), fromUrl),
      );
      candidates.push(path.resolve(process.cwd(), "..", fromUrl));
    }
    candidates.push(
      path.resolve(process.cwd(), "data", "medsales.db"),
      path.resolve(process.cwd(), "..", "data", "medsales.db"),
    );
    const p =
      candidates.find((c) => c && existsSync(c)) ??
      candidates[candidates.length - 1];
    _db = new DatabaseSync(p, { readOnly: true });
  }
  return _db;
}

// ── types ────────────────────────────────────────────────────────────
export type ServiceHit = { id: string; name: string; category: string };
export type Offer = {
  brandId: string;
  brand: string;
  city: string;
  minPrice: number;
  maxPrice: number;
  branches: number;
  parsedAt: string;
  rating: number | null; // /5
  reviews: number | null;
  logo: string | null;
  sentiment: number | null; // 0..1 by review text
  reviewSummary: string | null;
  onlineBooking: boolean; // any branch of the brand books online
};
export type Canonical = {
  id: string;
  code: string;
  name_ru: string;
  category: string;
  specialty: string | null;
  tarificator_code: string | null;
};

// ── search index (loaded once) ───────────────────────────────────────
type IdxRow = { id: string; name: string; category: string; hay: string };
let _idx: IdxRow[] | null = null;
function index(): IdxRow[] {
  if (_idx) return _idx;
  const rows = db()
    .prepare("SELECT id, name_ru, category, synonyms FROM canonical_service")
    .all() as {
    id: string;
    name_ru: string;
    category: string;
    synonyms: string | null;
  }[];
  _idx = rows.map((r) => {
    let syn: string[] = [];
    try {
      syn = JSON.parse(r.synonyms || "[]");
    } catch {}
    return {
      id: r.id,
      name: r.name_ru,
      category: r.category,
      hay: (r.name_ru + " " + syn.join(" ")).toLowerCase(),
    };
  });
  return _idx;
}

export function searchServices(q: string, limit = 8): ServiceHit[] {
  const s = q.trim().toLowerCase();
  if (s.length < 2) return [];
  const scored: { r: IdxRow; score: number }[] = [];
  for (const r of index()) {
    const name = r.name.toLowerCase();
    let score = -1;
    if (name === s) score = 100;
    else if (name.startsWith(s)) score = 80;
    else if (name.includes(" " + s)) score = 60;
    else if (name.includes(s)) score = 40;
    else if (r.hay.includes(s)) score = 20;
    if (score >= 0) scored.push({ r, score: score - r.name.length * 0.01 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, limit)
    .map((x) => ({ id: x.r.id, name: x.r.name, category: x.r.category }));
}

// Stopwords stripped from natural-language questions before matching.
const NL_STOP = new Set([
  "что",
  "такое",
  "как",
  "где",
  "для",
  "или",
  "это",
  "можно",
  "сделать",
  "цена",
  "цены",
  "стоит",
  "сколько",
  "нужно",
  "надо",
  "хочу",
  "есть",
  "мне",
  "про",
  "чем",
  "why",
  "the",
  "and",
  "под",
  "при",
  "без",
]);

// Natural-language search: a full question like
// "Что такое УЗИ щитовидной железы и где сделать?" still matches the service
// "УЗИ щитовидной железы". Tries the strict substring search first, then falls
// back to per-word overlap scoring over name + synonyms.
export function searchServicesNL(q: string, limit = 5): ServiceHit[] {
  const strict = searchServices(q, limit);
  if (strict.length > 0) return strict;
  const tokens = q
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((t) => t.length >= 3 && !NL_STOP.has(t));
  if (tokens.length === 0) return [];
  const scored: { r: IdxRow; score: number }[] = [];
  for (const r of index()) {
    const name = r.name.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (name.includes(t)) score += 2;
      else if (r.hay.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ r, score: score - r.name.length * 0.005 });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, limit)
    .map((x) => ({ id: x.r.id, name: x.r.name, category: x.r.category }));
}

export function getCanonical(id: string): Canonical | null {
  const result = db()
    .prepare(
      "SELECT id, code, name_ru, category, specialty, tarificator_code FROM canonical_service WHERE id = ?",
    )
    .get(id) as Canonical;
  return result ? { ...result } : null;
}

// All clinics offering a service in a city, grouped by brand, cheapest first.
export function getOffers(canonicalId: string, city: string): Offer[] {
  const rows = db()
    .prepare(
      `
    SELECT b.id brandId, b.name brand, br.city city,
           MIN(p.price_kzt) minPrice, MAX(p.price_kzt) maxPrice,
           COUNT(DISTINCT br.id) branches, MAX(p.parsed_at) parsedAt,
           b.rating rating, b.reviews_count reviews, b.logo_url logo,
           b.sentiment sentiment, b.review_summary reviewSummary,
           MAX(COALESCE(br.online_booking, 0)) onlineBooking
    FROM price p
    JOIN branch br ON p.branch_id = br.id
    JOIN brand  b  ON br.brand_id = b.id
    WHERE p.canonical_service_id = ? AND p.price_kzt >= 100 AND br.city = ?
    GROUP BY b.id
    ORDER BY minPrice ASC
  `,
    )
    .all(canonicalId, city) as (Omit<Offer, "onlineBooking"> & {
    onlineBooking: number;
  })[];
  return rows.map((r) => ({ ...r, onlineBooking: !!r.onlineBooking }));
}

export function getServiceStats(canonicalId: string, city: string) {
  const result = db()
    .prepare(
      `
    SELECT MIN(p.price_kzt) min, MAX(p.price_kzt) max, ROUND(AVG(p.price_kzt)) avg,
           COUNT(DISTINCT br.brand_id) brands
    FROM price p JOIN branch br ON p.branch_id = br.id
    WHERE p.canonical_service_id = ? AND p.price_kzt >= 100 AND br.city = ?
  `,
    )
    .get(canonicalId, city) as {
    min: number;
    max: number;
    avg: number;
    brands: number;
  };
  return { ...result };
}

// Cities where this service is actually offered (for the picker on a service page).
export function getServiceCities(
  canonicalId: string,
): { city: string; brands: number; min: number }[] {
  const rows = db()
    .prepare(
      `
    SELECT br.city city, COUNT(DISTINCT br.brand_id) brands, MIN(p.price_kzt) min
    FROM price p JOIN branch br ON p.branch_id = br.id
    WHERE p.canonical_service_id = ? AND p.price_kzt >= 100
    GROUP BY br.city ORDER BY brands DESC
  `,
    )
    .all(canonicalId) as { city: string; brands: number; min: number }[];
  return rows.map((r) => ({ ...r }));
}

export function getPopularServices(city: string, limit = 8): ServiceHit[] {
  const rows = db()
    .prepare(
      `
    SELECT cs.id id, cs.name_ru name, cs.category category,
           COUNT(DISTINCT br.brand_id) brands
    FROM canonical_service cs
    JOIN price p ON p.canonical_service_id = cs.id
    JOIN branch br ON p.branch_id = br.id
    WHERE p.price_kzt >= 100 AND br.city = ?
    GROUP BY cs.id ORDER BY brands DESC, LENGTH(cs.name_ru) ASC
    LIMIT ?
  `,
    )
    .all(city, limit) as ServiceHit[];
  return rows.map((r) => ({ ...r }));
}

export function getCategoryCounts(
  city: string,
): { category: string; services: number }[] {
  const rows = db()
    .prepare(
      `
    SELECT cs.category category, COUNT(DISTINCT cs.id) services
    FROM canonical_service cs
    JOIN price p ON p.canonical_service_id = cs.id
    JOIN branch br ON p.branch_id = br.id
    WHERE p.price_kzt >= 100 AND br.city = ?
    GROUP BY cs.category
  `,
    )
    .all(city) as { category: string; services: number }[];
  return rows.map((r) => ({ ...r }));
}

export function getTotals() {
  const result = db()
    .prepare(
      `
    SELECT (SELECT COUNT(*) FROM brand) brands,
           (SELECT COUNT(*) FROM branch) branches,
           (SELECT COUNT(*) FROM price WHERE price_kzt >= 100) prices,
           (SELECT COUNT(*) FROM pharmacy) pharmacies
  `,
    )
    .get() as {
      brands: number;
      branches: number;
      prices: number;
      pharmacies: number;
    };
  return { ...result };
}

// ── extended queries (clinic card, catalog, map, price history) ───────
export type ServiceLocation = {
  brandId: string;
  brand: string;
  branchId: string;
  branch: string;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  price: number;
  parsedAt: string;
  sourceUrl: string | null;
  source: string | null;
  workingHours: string | null;
  onlineBooking: boolean;
  durationDays: number | null;
  rating: number | null; // branch rating /5
  reviews: number | null;
  // id организации в 2GIS — с ним «Как добраться» ведёт на карточку филиала,
  // а не на голую точку по координатам
  twogisId: string | null;
  city: string | null;
};

// Branch-level rows for a service in a city (powers the map + route/call buttons).
export function getServiceLocations(
  canonicalId: string,
  city: string,
): ServiceLocation[] {
  const rows = db()
    .prepare(
      `
    SELECT br.id branchId, b.id brandId, b.name brand, br.name branch,
           br.address address, br.phone phone, br.lat lat, br.lng lng,
           br.source_url sourceUrl, br.source source,
           br.working_hours workingHours, br.rating rating,
           br.reviews_count reviews, br.twogis_id twogisId, br.city city,
           COALESCE(br.online_booking, 0) onlineBooking,
           MIN(p.price_kzt) price, MAX(p.parsed_at) parsedAt,
           MAX(p.duration_days) durationDays
    FROM price p
    JOIN branch br ON p.branch_id = br.id
    JOIN brand  b  ON br.brand_id = b.id
    WHERE p.canonical_service_id = ? AND p.price_kzt >= 100 AND br.city = ?
    GROUP BY br.id
    ORDER BY price ASC
  `,
    )
    .all(canonicalId, city) as (Omit<ServiceLocation, "onlineBooking"> & {
    onlineBooking: number;
  })[];
  return rows.map((r) => ({ ...r, onlineBooking: !!r.onlineBooking }));
}

// Per-brand candidates for the three picks + the compare table: the CHEAPEST
// branch of each brand offering the service in the city, with brand-level
// rating / sentiment / summary attached. Cheapest first.
export function getServicePicks(canonicalId: string, city: string) {
  const rows = db()
    .prepare(
      `
    SELECT b.id brandId, b.name brand, b.logo_url logo,
           b.rating rating, b.sentiment sentiment,
           b.review_summary reviewSummary, b.reviews_count reviews,
           br.id branchId, br.address address, br.phone phone,
           br.lat lat, br.lng lng, br.working_hours workingHours,
           COALESCE(br.online_booking, 0) onlineBooking,
           p.price_kzt price, p.parsed_at parsedAt, p.duration_days durationDays
    FROM price p
    JOIN branch br ON p.branch_id = br.id
    JOIN brand  b  ON br.brand_id = b.id
    WHERE p.canonical_service_id = ? AND p.price_kzt >= 100 AND br.city = ?
    ORDER BY p.price_kzt ASC
  `,
    )
    .all(canonicalId, city) as (Omit<PickCandidate, "onlineBooking"> & {
    onlineBooking: number;
  })[];

  // reduce to the cheapest branch per brand
  const byBrand = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (!byBrand.has(r.brandId)) byBrand.set(r.brandId, r);
  }
  return [...byBrand.values()].map((r) => ({
    ...r,
    onlineBooking: !!r.onlineBooking,
  }));
}

export type HistoryPoint = { date: string; min_price: number };

// Min price per day from snapshots (honest: shows only what we have).
export function getPriceHistory(
  canonicalId: string,
  city: string,
): HistoryPoint[] {
  const rows = db()
    .prepare(
      `
    SELECT substr(ps.captured_at, 1, 10) date, MIN(ps.price_kzt) min_price
    FROM price_snapshot ps
    JOIN branch br ON ps.branch_id = br.id
    WHERE ps.canonical_service_id = ? AND ps.price_kzt >= 100 AND br.city = ?
    GROUP BY date
    ORDER BY date ASC
  `,
    )
    .all(canonicalId, city) as HistoryPoint[];
  return rows.map((r) => ({ ...r }));
}

export type BrandRow = {
  id: string;
  name: string;
  rating: number | null;
  ratingSource: string | null;
  reviews: number | null;
  sentiment: number | null;
  reviewSummary: string | null;
  description: string | null;
  descriptionSource: string | null;
  logo: string | null;
  photo: string | null;
};

export function getBrand(brandId: string): BrandRow | null {
  const result = db()
    .prepare(
      `SELECT id, name, rating, rating_source ratingSource, reviews_count reviews,
              sentiment, review_summary reviewSummary,
              description, description_source descriptionSource,
              logo_url logo, photo_url photo
       FROM brand WHERE id = ?`,
    )
    .get(brandId) as BrandRow;
  return result ? { ...result } : null;
}

export type Review = {
  author: string | null;
  rating: number | null; // 1..5 as in the source
  text: string;
  createdAt: string | null;
  source: string | null;
};

// Public reviews of a brand, newest (with a date) first.
// 103 truncates non-featured reviews to a ~123-char preview ending in "…"/"...";
// only the JSON-LD featured reviews are full. We show FULL reviews only, so every
// review on the page is complete (truncated previews still feed sentiment).
export function getBrandReviews(brandId: string, limit = 20): Review[] {
  const full = db()
    .prepare(
      `SELECT author, rating, text, created_at createdAt, source
       FROM review
       WHERE brand_id = ? AND rtrim(text) NOT LIKE '%...' AND rtrim(text) NOT LIKE '%…'
       ORDER BY (created_at IS NULL), created_at DESC, rating DESC
       LIMIT ?`,
    )
    .all(brandId, limit) as Review[];
  if (full.length > 0) return full.map((r) => ({ ...r }));
  // fallback: a clinic with only truncated previews still shows something
  const any = db()
    .prepare(
      `SELECT author, rating, text, created_at createdAt, source
       FROM review WHERE brand_id = ?
       ORDER BY (created_at IS NULL), created_at DESC, rating DESC
       LIMIT ?`,
    )
    .all(brandId, limit) as Review[];
  return any.map((r) => ({ ...r }));
}

export type BranchRow = {
  id: string;
  name: string;
  city: string;
  address: string | null;
  phone: string | null;
  workingHours: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviews: number | null;
  sourceUrl: string | null;
  source: string | null;
};

// Branches of a brand. Filters by city; falls back to the brand's primary city
// (most branches) if it has none in the requested one — so the page stays honest
// about which city it is actually showing (never silently mixes cities).
export function getBrandBranches(brandId: string, city?: string): BranchRow[] {
  const sel = `SELECT id, name, city, address, phone, working_hours workingHours,
                      lat, lng, rating, reviews_count reviews,
                      source_url sourceUrl, source source
               FROM branch WHERE brand_id = ?`;
  if (city) {
    const inCity = db()
      .prepare(sel + " AND city = ? ORDER BY name")
      .all(brandId, city) as BranchRow[];
    if (inCity.length) return inCity.map((r) => ({ ...r }));
  }
  // no branch in the requested city: pick the brand's primary city and show only it
  const primary = db()
    .prepare(
      "SELECT city FROM branch WHERE brand_id = ? GROUP BY city ORDER BY COUNT(*) DESC LIMIT 1",
    )
    .get(brandId) as { city: string } | undefined;
  if (!primary) return [];
  const rows = db()
    .prepare(sel + " AND city = ? ORDER BY name")
    .all(brandId, primary.city) as BranchRow[];
  return rows.map((r) => ({ ...r }));
}

export type ClinicCard = {
  id: string;
  name: string;
  rating: number | null;
  reviews: number | null;
  logo: string | null;
  services: number;
  minPrice: number | null;
  branches: number;
};

// All brands present in a city, for the "Клиники" catalog. Best-rated first.
export function getBrandsInCity(city: string, limit = 300): ClinicCard[] {
  const rows = db()
    .prepare(
      `
    SELECT b.id id, b.name name, b.rating rating, b.reviews_count reviews,
           b.logo_url logo,
           COUNT(DISTINCT cs.id) services, MIN(p.price_kzt) minPrice,
           COUNT(DISTINCT br.id) branches
    FROM brand b
    JOIN branch br ON br.brand_id = b.id AND br.city = ?
    JOIN price p ON p.branch_id = br.id AND p.price_kzt >= 100
    LEFT JOIN canonical_service cs ON p.canonical_service_id = cs.id
    GROUP BY b.id
    ORDER BY (b.rating IS NULL), b.rating DESC, b.reviews_count DESC, b.name
    LIMIT ?
  `,
    )
    .all(city, limit) as ClinicCard[];
  return rows.map((r) => ({ ...r }));
}

export type BrandService = {
  id: string;
  name: string;
  category: string;
  price: number;
  parsedAt: string;
};

export function getBrandServices(
  brandId: string,
  city: string,
): BrandService[] {
  const rows = db()
    .prepare(
      `
    SELECT cs.id id, cs.name_ru name, cs.category category,
           MIN(p.price_kzt) price, MAX(p.parsed_at) parsedAt
    FROM price p
    JOIN branch br ON p.branch_id = br.id
    JOIN canonical_service cs ON p.canonical_service_id = cs.id
    WHERE br.brand_id = ? AND br.city = ? AND p.price_kzt >= 100
    GROUP BY cs.id
    ORDER BY cs.category, price ASC
  `,
    )
    .all(brandId, city) as BrandService[];
  return rows.map((r) => ({ ...r }));
}

export type CategoryService = {
  id: string;
  name: string;
  category: string;
  brands: number;
  min: number;
};

export function getCategoryServices(
  category: string,
  city: string,
  limit = 200,
): CategoryService[] {
  const rows = db()
    .prepare(
      `
    SELECT cs.id id, cs.name_ru name, cs.category category,
           COUNT(DISTINCT br.brand_id) brands, MIN(p.price_kzt) min
    FROM canonical_service cs
    JOIN price p ON p.canonical_service_id = cs.id
    JOIN branch br ON p.branch_id = br.id
    WHERE p.price_kzt >= 100 AND br.city = ? AND cs.category = ?
    GROUP BY cs.id
    ORDER BY brands DESC, cs.name_ru ASC
    LIMIT ?
  `,
    )
    .all(city, category, limit) as CategoryService[];
  return rows.map((r) => ({ ...r }));
}
