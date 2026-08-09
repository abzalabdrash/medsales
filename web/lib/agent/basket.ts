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
 * Логика режимов взята из пакета AI-инженера команды (pharma/agent/optimizer.py)
 * и переписана на наши данные по конкретным аптекам.
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
  /** Позиции, которых нет в наших данных. Молчать про них нельзя. */
  missing: string[];
};

type Candidate = { key: string; row: PharmacyPrice; item: BasketRequestItem };

/** Ключ точки: у сетей адреса разные, а название часто одинаковое. */
function placeKey(r: PharmacyPrice): string {
  return r.pharmacyId ?? `${r.pharmacyName}|${r.address ?? ""}`;
}

export function buildBasket(
  items: BasketRequestItem[],
  city: string,
  opts: { premiumTolerance?: number } = {},
): Basket {
  // Насколько дороже мы согласны взять позицию, чтобы не ехать в лишнюю
  // аптеку. Двадцать процентов это примерно цена дороги и часа времени.
  const tolerance = opts.premiumTolerance ?? 0.2;

  const missing: string[] = [];
  const byItem = new Map<string, PharmacyPrice[]>();
  const candidates: Candidate[] = [];

  for (const item of items) {
    const rows = pharmacyPrices(item.refId ?? null, item.title, city, 20);
    if (rows.length === 0) {
      missing.push(item.title);
      continue;
    }
    byItem.set(item.title, rows);
    for (const row of rows) candidates.push({ key: placeKey(row), row, item });
  }
  if (byItem.size === 0) {
    return { stops: [], total: 0, cheapestTotal: 0, oneStopTotal: null, oneStopName: null, missing };
  }

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

  // «взять всё в одном месте»: точка с лучшим покрытием, при равенстве дешевле
  const ranked = [...places.entries()].sort((a, b) => {
    const cover = b[1].size - a[1].size;
    if (cover !== 0) return cover;
    const sum = (m: Map<string, Candidate>) =>
      [...m.values()].reduce((s, c) => s + c.row.price * packsOf(c.item), 0);
    return sum(a[1]) - sum(b[1]);
  });
  const best = ranked[0];
  const oneStopComplete = best && best[1].size === byItem.size;
  const oneStopTotal = oneStopComplete
    ? [...best[1].values()].reduce((s, c) => s + c.row.price * packsOf(c.item), 0)
    : null;
  const oneStopName = oneStopComplete ? best[1].values().next().value!.row.pharmacyName : null;

  // Собираем маршрут: идём от точки с лучшим покрытием и берём в ней всё,
  // что не дороже самого дешёвого варианта больше чем на допуск.
  const chosen = new Map<string, Candidate>();
  for (const [, perPlace] of ranked) {
    for (const [title, cand] of perPlace) {
      if (chosen.has(title)) continue;
      const floor = cheapest.get(title)!.price;
      if (cand.row.price <= floor * (1 + tolerance)) chosen.set(title, cand);
    }
    if (chosen.size === byItem.size) break;
  }
  // всё, что не влезло в допуск, берём там, где дешевле всего
  for (const [title, row] of cheapest) {
    if (chosen.has(title)) continue;
    chosen.set(title, { key: placeKey(row), row, item: items.find((i) => i.title === title)! });
  }

  const stopsMap = new Map<string, BasketStop>();
  for (const [title, cand] of chosen) {
    const item = items.find((i) => i.title === title)!;
    const packs = packsOf(item);
    const stop = stopsMap.get(cand.key) ?? {
      pharmacy: cand.row.pharmacyName,
      address: cand.row.address,
      phone: cand.row.phone,
      hours: cand.row.hours,
      twogisUrl: cand.row.twogisUrl,
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

  const stops = [...stopsMap.values()].sort((a, b) => b.lines.length - a.lines.length);
  const total = stops.reduce((s, x) => s + x.subtotal, 0);

  return {
    stops,
    total: Math.round(total),
    cheapestTotal: Math.round(cheapestTotal),
    oneStopTotal: oneStopTotal === null ? null : Math.round(oneStopTotal),
    oneStopName,
    missing,
  };
}
