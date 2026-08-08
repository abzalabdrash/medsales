// Server-side retrieval for the chat assistant. Pulls a COMPACT, relevant slice
// of MedPrice data for the user's question (RAG) instead of dumping the whole
// city — keeps the model fast, grounded and cheap. Imports db.ts (node:sqlite),
// so this is server-only. Handles BOTH service questions ("сколько стоит МРТ")
// and clinic questions ("лучшая клиника/поликлиника", "что за клиника X").

import {
  searchServicesNL,
  getServicePicks,
  getCategoryCounts,
  getTotals,
  getBrandsInCity,
  getBrand,
} from "./db";
import { cityName } from "./cities";
import { haversineKm, type Coords } from "./picks";

// A few well-known landmarks so "рядом с Есентаем" actually yields distances.
const LANDMARKS: Record<string, Coords> = {
  есентай: { lat: 43.2207, lng: 76.9286 },
  esentai: { lat: 43.2207, lng: 76.9286 },
  "мега алматы": { lat: 43.2007, lng: 76.8923 },
  "мега парк": { lat: 43.2533, lng: 76.9445 },
  достык: { lat: 43.2389, lng: 76.9556 },
  "площадь республики": { lat: 43.2399, lng: 76.9457 },
  ауэзова: { lat: 43.2317, lng: 76.8847 },
  сатпаева: { lat: 43.238, lng: 76.916 },
};

function landmarkCoords(message: string): Coords | null {
  const m = message.toLowerCase();
  for (const [name, c] of Object.entries(LANDMARKS)) {
    if (m.includes(name)) return c;
  }
  return null;
}

// Words that signal a CLINIC-level question rather than a specific service.
const CLINIC_HINTS = [
  "клиник",
  "поликлиник",
  "больниц",
  "лаборатор",
  "медцентр",
  "мед центр",
  "лучш",
  "рейтинг",
  "отзыв",
  "надёжн",
  "надежн",
  "качеств",
  "посоветуй",
  "порекоменд",
  "куда сходить",
  "куда пойти",
  "какая клиника",
  "какую клинику",
];
function clinicIntent(message: string): boolean {
  const s = message.toLowerCase();
  return CLINIC_HINTS.some((h) => s.includes(h));
}

// Generic words we must NOT treat as a clinic NAME when matching by name.
const NAME_STOP = new Set([
  "клиника",
  "клинику",
  "клиники",
  "поликлиника",
  "поликлинику",
  "поликлиники",
  "больница",
  "больницу",
  "больницы",
  "лаборатория",
  "лабораторию",
  "медцентр",
  "центр",
  "центры",
  "лучшая",
  "лучший",
  "лучшие",
  "рейтинг",
  "отзывы",
  "город",
  "городская",
  "городские",
  "какая",
  "какую",
  "какие",
  "нужна",
  "нужен",
  "самая",
  "самый",
  "надёжная",
  "надежная",
  "качественная",
  "посоветуй",
  "порекомендуй",
  "найди",
]);
function nameTokens(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((t) => t.length >= 4 && !NAME_STOP.has(t));
}

// Clinic-level retrieval: matches clinics by name AND lists the best-rated
// clinics in the city (with review summary). This is what makes the bot answer
// "лучшая клиника / поликлиника" or "что за клиника X" from our DB instead of
// falling back to generic web advice.
function clinicBlock(message: string, city: string): string[] {
  const lines: string[] = [];
  let cards: ReturnType<typeof getBrandsInCity>;
  try {
    cards = getBrandsInCity(city, 300);
  } catch {
    return lines;
  }
  if (!cards || cards.length === 0) return lines;

  const toks = nameTokens(message);
  const named = toks.length
    ? cards.filter((c) => toks.some((t) => c.name.toLowerCase().includes(t)))
    : [];
  const rated = cards.filter((c) => c.rating != null);
  const top = (rated.length ? rated : cards).slice(0, 6);

  const seen = new Set<string>();
  const chosen: typeof cards = [];
  for (const c of [...named, ...top]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    chosen.push(c);
    if (chosen.length >= 8) break;
  }
  if (chosen.length === 0) return lines;

  const cn = cityName(city);
  lines.push(
    `\nКЛИНИКИ в ${cn} (рейтинг и отзывы из нашей базы; "лучшая" = высокий рейтинг + заметное число отзывов):`,
  );
  for (const c of chosen) {
    const rating = c.rating != null ? `★${c.rating}/5` : "без рейтинга";
    const revN = c.reviews ? ` (${c.reviews} отз.)` : "";
    let summary = "";
    try {
      const b = getBrand(c.id);
      if (b && b.reviewSummary) summary = ` Отзывы: ${b.reviewSummary}.`;
    } catch {}
    const price = c.minPrice != null ? `, цены от ${c.minPrice} ₸` : "";
    const svc = c.services ? `, услуг: ${c.services}` : "";
    const brn = c.branches ? `, филиалов: ${c.branches}` : "";
    lines.push(
      `- ${c.name}: ${rating}${revN}${price}${svc}${brn}.${summary} Ссылка /klinika/${c.id}?city=${city}`,
    );
  }
  return lines;
}

// Service-level retrieval: cheapest clinics per matched service in the city.
function serviceBlock(
  message: string,
  city: string,
  geo: Coords | null,
): { lines: string[]; hasOffers: boolean } {
  const lines: string[] = [];
  let hits: { id: string; name: string; category: string }[] = [];
  try {
    hits = searchServicesNL(message, 8);
  } catch {
    hits = [];
  }
  if (hits.length === 0) return { lines, hasOffers: false };

  const available: {
    hit: { id: string; name: string; category: string };
    picks: ReturnType<typeof getServicePicks>;
  }[] = [];
  const empty: string[] = [];
  for (const hit of hits) {
    let picks: ReturnType<typeof getServicePicks> = [];
    try {
      picks = getServicePicks(hit.id, city);
    } catch {
      picks = [];
    }
    if (picks.length === 0) empty.push(hit.name);
    else available.push({ hit, picks });
    if (available.length >= 5) break;
  }

  if (available.length === 0) {
    lines.push(
      `В городе ${cityName(city)} цен по этим услугам в базе нет: ${empty.join(", ")}. Честно сообщи об этом и предложи другой город или уточнить услугу.`,
    );
    return { lines, hasOffers: false };
  }

  for (const { hit, picks } of available) {
    lines.push(
      `\nУслуга "${hit.name}" (${hit.category}) — ссылка /usluga/${hit.id}?city=${city}:`,
    );
    for (const c of picks.slice(0, 6)) {
      const dist =
        geo && typeof c.lat === "number" && typeof c.lng === "number"
          ? ` ~${haversineKm(geo, { lat: c.lat, lng: c.lng }).toFixed(1)} км`
          : "";
      const rating = c.rating != null ? `★${c.rating}/5` : "без рейтинга";
      const revN = c.reviews ? ` (${c.reviews} отз.)` : "";
      const summary = c.reviewSummary ? ` Отзывы: ${c.reviewSummary}.` : "";
      const booking = c.onlineBooking ? " Есть онлайн-запись." : "";
      lines.push(
        `- ${c.brand}: ${c.price} ₸, ${rating}${revN}${dist}.${booking}${summary} Ссылка /klinika/${c.brandId}?city=${city}`,
      );
    }
  }
  if (empty.length > 0) {
    lines.push(
      `\n(По этим близким услугам цен в ${cityName(city)} нет: ${empty.join(", ")}.)`,
    );
  }
  return { lines, hasOffers: true };
}

export function retrieveContext(
  message: string,
  city: string,
  coords?: Coords | null,
): string {
  const lines: string[] = [];
  const cn = cityName(city);
  const geo = landmarkCoords(message) ?? coords ?? null;

  try {
    const totals = getTotals();
    const cats = getCategoryCounts(city);
    const catStr = cats.map((c) => `${c.category}: ${c.services}`).join(", ");
    lines.push(
      `Город: ${cn}. По стране: ${totals.brands} клиник, ${totals.branches} филиалов, ${totals.prices} цен. Услуг в городе по категориям: ${catStr || "нет данных"}.`,
    );
  } catch {
    // db unavailable — model will rely on web search
  }

  const wantsClinics = clinicIntent(message);

  const svc = serviceBlock(message, city, geo);
  lines.push(...svc.lines);

  let clinicLines: string[] = [];
  if (wantsClinics || !svc.hasOffers) {
    clinicLines = clinicBlock(message, city);
    lines.push(...clinicLines);
  }

  if (!svc.hasOffers && clinicLines.length === 0) {
    lines.push(
      "По запросу пользователя ни конкретная услуга, ни клиника в базе не найдены. Если вопрос общемедицинский — кратко ответь из веб-поиска и предложи уточнить название услуги или клиники.",
    );
  }

  if (geo && svc.hasOffers) {
    lines.push("\n(Расстояния посчитаны от местоположения пользователя.)");
  }

  return lines.join("\n");
}
