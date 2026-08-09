import { pharmacyPrices, type PharmacyPrice } from "@/lib/drugs";

/**
 * Сборка маршрута покупок: что и в какой аптеке брать.
 *
 * Само по себе «где дешевле каждая позиция» бесполезно. По назначению на
 * восемь позиций самая дешёвая цена может оказаться в восьми разных аптеках
 * в разных концах города, и человек всё равно возьмёт всё в одной, потеряв
 * на этом больше, чем сэкономил бы.
 *
 * Поэтому считаем два ответа и показываем оба: сколько выйдет, если обойти
 * всё ради минимума, и сколько, если взять в одном месте. Правда обычно
 * посередине, и решает её человек, а не мы.
 *
 * Если известен адрес человека (lat/lng), one-stop и маршрут тянем к
 * ближним точкам с хорошим рейтингом 2GIS: покрытие рецепта важнее,
 * потом близость и оценка, потом цена.
 */

export type BasketRequestItem = {
  title: string;
  refId?: string | null;
  /** Сколько упаковок нужно на курс. Считается отдельно, здесь только множитель. */
  packs?: number | null;
};

export type BasketLine = {
  title: string;
  packs: number;
  pricePerPack: number;
  subtotal: number;
};

export type BasketStop = {
  pharmacy: string;
  address: string | null;
  phone: string | null;
  hours: string | null;
  twogisUrl: string | null;
  rating: number | null;
  reviews: number | null;
  distanceKm: number | null;
  lines: BasketLine[];
  subtotal: number;
};

export type Basket = {
  stops: BasketStop[];
  total: number;
  /** Если гнаться за минимумом по каждой позиции по всему городу. */
  cheapestTotal: number;
  /** Если взять всё в одной аптеке с лучшим покрытием. */
  oneStopTotal: number | null;
  oneStopName: string | null;
  oneStopAddress: string | null;
  oneStopDistanceKm: number | null;
  oneStopRating: number | null;
  /** Позиции, которых нет в наших данных. Молчать про них нельзя. */
  missing: string[];
};

export type NearPoint = { lat: number; lng: number; label?: string | null };

type Candidate = { key: string; row: PharmacyPrice; item: BasketRequestItem };

/** Ключ точки: у сетей адреса разные, а название часто одинаковое. */
function placeKey(r: PharmacyPrice): string {
  return r.pharmacyId ?? `${r.pharmacyName}|${r.address ?? ""}`;
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number | null; lng: number | null },
): number | null {
  if (b.lat == null || b.lng == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function emptyBasket(missing: string[]): Basket {
  return {
    stops: [],
    total: 0,
    cheapestTotal: 0,
    oneStopTotal: null,
    oneStopName: null,
    oneStopAddress: null,
    oneStopDistanceKm: null,
    oneStopRating: null,
    missing,
  };
}

export function buildBasket(
  items: BasketRequestItem[],
  city: string,
  opts: { premiumTolerance?: number; near?: NearPoint | null } = {},
): Basket {
  // Насколько дороже мы согласны взять позицию, чтобы не ехать в лишнюю
  // аптеку. Двадцать процентов это примерно цена дороги и часа времени.
  const tolerance = opts.premiumTolerance ?? 0.2;
  const near = opts.near ?? null;

  const missing: string[] = [];
  const byItem = new Map<string, PharmacyPrice[]>();
  const candidates: Candidate[] = [];

  for (const item of items) {
    // Берём шире и при near пересортируем: иначе при равных ценах Раузы
    // ближайший филиал (Навои) выпадает из топ-40 по алфавиту адреса.
    let rows = pharmacyPrices(item.refId ?? null, item.title, city, 80);
    if (rows.length === 0) {
      missing.push(item.title);
      continue;
    }
    if (near) {
      rows = [...rows].sort((a, b) => {
        const da = haversineKm(near, a) ?? 999;
        const db = haversineKm(near, b) ?? 999;
        if (Math.abs(da - db) > 0.2) return da - db;
        const ra = (a.rating ?? 0) - (b.rating ?? 0);
        if (Math.abs(ra) > 0.05) return -ra;
        return a.price - b.price;
      });
    }
    byItem.set(item.title, rows);
    for (const row of rows) candidates.push({ key: placeKey(row), row, item });
  }
  if (byItem.size === 0) return emptyBasket(missing);

  const packsOf = (i: BasketRequestItem) => Math.max(1, i.packs ?? 1);

  // самый дешёвый вариант каждой позиции по всему городу
  const cheapest = new Map<string, PharmacyPrice>();
  for (const [title, rows] of byItem) cheapest.set(title, rows[0]);
  const cheapestTotal = [...byItem.keys()].reduce((sum, title) => {
    const row = cheapest.get(title)!;
    const item = items.find((i) => i.title === title)!;
    return sum + row.price * packsOf(item);
  }, 0);

  // точка -> позиция -> самая дешёвая строка в этой точке
  const places = new Map<string, Map<string, Candidate>>();
  for (const c of candidates) {
    const perPlace = places.get(c.key) ?? new Map<string, Candidate>();
    const cur = perPlace.get(c.item.title);
    if (!cur || c.row.price < cur.row.price) perPlace.set(c.item.title, c);
    places.set(c.key, perPlace);
  }

  const placeMeta = (m: Map<string, Candidate>) => {
    const sample = m.values().next().value!.row;
    const dist = near ? haversineKm(near, sample) : null;
    return {
      rating: sample.rating,
      reviews: sample.reviews,
      distanceKm: dist,
      address: sample.address,
      name: sample.pharmacyName,
      sum: [...m.values()].reduce((s, c) => s + c.row.price * packsOf(c.item), 0),
    };
  };

  // покрытие → близость → рейтинг → цена
  const ranked = [...places.entries()].sort((a, b) => {
    const cover = b[1].size - a[1].size;
    if (cover !== 0) return cover;
    const ma = placeMeta(a[1]);
    const mb = placeMeta(b[1]);
    if (near) {
      const da = ma.distanceKm ?? 999;
      const db = mb.distanceKm ?? 999;
      if (Math.abs(da - db) > 0.1) return da - db;
    }
    const ra = (ma.rating ?? 0) * Math.log10(1 + (ma.reviews ?? 0));
    const rb = (mb.rating ?? 0) * Math.log10(1 + (mb.reviews ?? 0));
    if (Math.abs(rb - ra) > 0.01) return rb - ra;
    return ma.sum - mb.sum;
  });
  const best = ranked[0];
  const oneStopComplete = best && best[1].size === byItem.size;
  const bestMeta = best ? placeMeta(best[1]) : null;
  const oneStopTotal = oneStopComplete
    ? [...best[1].values()].reduce((s, c) => s + c.row.price * packsOf(c.item), 0)
    : null;
  const oneStopName = oneStopComplete ? bestMeta!.name : null;
  const oneStopAddress = oneStopComplete ? bestMeta!.address : null;
  const oneStopDistanceKm =
    oneStopComplete && bestMeta!.distanceKm != null
      ? Math.round(bestMeta!.distanceKm * 10) / 10
      : null;
  const oneStopRating = oneStopComplete ? bestMeta!.rating : null;

  // Если одна аптека закрывает весь список — она и есть маршрут.
  // Переплата в сотни тенге лучше пяти остановок через полгорода.
  const chosen = new Map<string, Candidate>();
  const ABS_SAVE_MIN = 300; // тенге: меньше — не едем далеко
  const FAR_KM = 5;

  if (oneStopComplete && best) {
    for (const [title, cand] of best[1]) chosen.set(title, cand);
  } else {
    // Идём от лучшего покрытия / близости, берём в допуск.
    for (const [, perPlace] of ranked) {
      for (const [title, cand] of perPlace) {
        if (chosen.has(title)) continue;
        const floor = cheapest.get(title)!.price;
        const dist = near ? (haversineKm(near, cand.row) ?? 999) : 0;
        const overpay = cand.row.price - floor;
        if (near && dist > FAR_KM && overpay > -ABS_SAVE_MIN) continue;
        if (cand.row.price <= floor * (1 + tolerance) || overpay <= ABS_SAVE_MIN) {
          chosen.set(title, cand);
        }
      }
      if (chosen.size === byItem.size) break;
    }
    // leftover: ближайший вариант, не абсолютный cheapest в 13 км
    for (const [title, rows] of byItem) {
      if (chosen.has(title)) continue;
      const floor = cheapest.get(title)!.price;
      let pick = rows[0];
      if (near) {
        const nearOk = rows.find(
          (r) => (haversineKm(near, r) ?? 999) <= FAR_KM && r.price <= floor + ABS_SAVE_MIN,
        );
        pick = nearOk ?? rows[0];
        if (!nearOk) {
          const nearest = [...rows].sort(
            (a, b) => (haversineKm(near, a) ?? 999) - (haversineKm(near, b) ?? 999),
          )[0];
          if (
            nearest &&
            (haversineKm(near, nearest) ?? 999) + 0.5 < (haversineKm(near, pick) ?? 999)
          ) {
            pick = nearest;
          }
        }
      }
      chosen.set(title, {
        key: placeKey(pick),
        row: pick,
        item: items.find((i) => i.title === title)!,
      });
    }
  }

  const stopsMap = new Map<string, BasketStop>();
  for (const [title, cand] of chosen) {
    const item = items.find((i) => i.title === title)!;
    const packs = packsOf(item);
    const dist = near ? haversineKm(near, cand.row) : null;
    const stop = stopsMap.get(cand.key) ?? {
      pharmacy: cand.row.pharmacyName,
      address: cand.row.address,
      phone: cand.row.phone,
      hours: cand.row.hours,
      twogisUrl: cand.row.twogisUrl,
      rating: cand.row.rating,
      reviews: cand.row.reviews,
      distanceKm: dist == null ? null : Math.round(dist * 10) / 10,
      lines: [],
      subtotal: 0,
    };
    stop.lines.push({
      title,
      packs,
      pricePerPack: cand.row.price,
      subtotal: cand.row.price * packs,
    });
    stop.subtotal += cand.row.price * packs;
    stopsMap.set(cand.key, stop);
  }

  const stops = [...stopsMap.values()].sort((a, b) => {
    const cover = b.lines.length - a.lines.length;
    if (cover !== 0) return cover;
    if (near) {
      const da = a.distanceKm ?? 999;
      const db = b.distanceKm ?? 999;
      if (Math.abs(da - db) > 0.3) return da - db;
    }
    return b.subtotal - a.subtotal;
  });
  const total = stops.reduce((s, x) => s + x.subtotal, 0);

  return {
    stops,
    total: Math.round(total),
    cheapestTotal: Math.round(cheapestTotal),
    oneStopTotal: oneStopTotal === null ? null : Math.round(oneStopTotal),
    oneStopName,
    oneStopAddress,
    oneStopDistanceKm,
    oneStopRating,
    missing,
  };
}
