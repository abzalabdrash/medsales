/**
 * Карточки выдачи: единственная форма, в которой помощник показывает факты.
 *
 * Карточки собирает КОД из ответа инструмента, а не модель. Поэтому цену,
 * адрес и ссылку невозможно выдумать: их просто негде взять, кроме как из
 * строки базы. Модель пишет только связный текст вокруг карточек.
 *
 * Каждая карточка, у которой есть href, это переход на существующую страницу
 * продукта. Помощник не отдельный чат в углу, а способ дойти до нужной
 * страницы быстрее, чем через поиск.
 */

export type DrugCardData = {
  kind: "drug";
  offerId: string;
  href: string;
  title: string;
  inn: string | null;
  atc: string | null;
  price: number | null;
  packSize: number | null;
  form: string | null;
  manufacturer: string | null;
  isRx: boolean;
};

export type PharmacyPriceCardData = {
  kind: "pharmacyPrice";
  title: string;
  city: string;
  cheapest: number | null;
  priciest: number | null;
  shown: number;
  storesTotal: number | null;
  rows: {
    pharmacy: string;
    address: string | null;
    phone: string | null;
    hours: string | null;
    price: number;
    packSize: number | null;
    updated: string | null;
    twogisUrl: string | null;
    rating: number | null;
    reviews: number | null;
  }[];
};

export type FreeCardData = {
  kind: "free";
  matchedBy: "atc" | "inn";
  items: {
    drugName: string;
    mkb10: string | null;
    disease: string | null;
    citizenCategory: string | null;
    sourceUrl: string | null;
  }[];
};

export type CourseCardData = {
  kind: "course";
  units: number | null;
  packs: number | null;
  leftover: number | null;
  explainer: string;
  coursePrice: number | null;
  warning: string | null;
};

export type ServiceCardData = {
  kind: "service";
  title: string;
  href: string;
  rows: {
    placeId: string;
    clinic: string;
    branch: string | null;
    address: string | null;
    phone: string | null;
    price: number | null;
    rating: number | null;
    reviews: number | null;
    twogisUrl: string | null;
  }[];
};

export type RouteCardData = {
  kind: "route";
  total: number;
  cheapestTotal: number;
  oneStopTotal: number | null;
  oneStopName: string | null;
  missing: string[];
  stops: {
    pharmacy: string;
    address: string | null;
    phone: string | null;
    hours: string | null;
    twogisUrl: string | null;
    subtotal: number;
    lines: { title: string; packs: number; pricePerPack: number; subtotal: number }[];
  }[];
};

export type ReviewsCardData = {
  kind: "reviews";
  items: { rating: number | null; text: string; source: string; date: string | null }[];
};

export type PharmacyCardData = {
  kind: "pharmacy";
  rows: {
    name: string;
    address: string | null;
    rating: number | null;
    reviews: number | null;
  }[];
};

export type Card =
  | DrugCardData
  | PharmacyPriceCardData
  | FreeCardData
  | CourseCardData
  | ServiceCardData
  | PharmacyCardData
  | RouteCardData
  | ReviewsCardData;

/** Ссылка на карточку организации в 2GIS: там маршрут, отзывы и телефоны. */
function twogisFirm(city: string, twogisId: string | null): string | null {
  return twogisId ? `https://2gis.kz/${city}/firm/${twogisId}` : null;
}

type Row = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const n = (v: unknown): number | null => (typeof v === "number" ? v : null);

/**
 * Ответ инструмента в карточки. Возвращает пустой массив, когда показывать
 * нечего: пустая карточка хуже её отсутствия, человек начинает искать в ней
 * смысл.
 */
export function cardsFrom(
  tool: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  city: string,
): Card[] {
  const items = (result.items as Row[]) ?? [];
  if (result.error || items.length === 0) return [];

  switch (tool) {
    case "find_drug":
      return items.slice(0, 6).map((x) => ({
        kind: "drug" as const,
        offerId: String(x.offerId ?? ""),
        href: `/lekarstvo/${String(x.offerId ?? "")}?city=${city}`,
        title: String(x.title ?? ""),
        inn: s(x.inn),
        atc: s(x.atc),
        price: n(x.price),
        packSize: n(x.packSize),
        form: s(x.form),
        manufacturer: s(x.manufacturer),
        isRx: Boolean(x.isRx),
      }));

    case "drug_prices_by_pharmacy":
      return [
        {
          kind: "pharmacyPrice",
          title: String(args.title ?? "Цены по аптекам"),
          city,
          cheapest: n(result.cheapest),
          priciest: n(result.priciest),
          shown: items.length,
          storesTotal: n(result.storesTotal),
          rows: items.map((x) => ({
            pharmacy: String(x.pharmacy ?? ""),
            address: s(x.address),
            phone: s(x.phone),
            hours: s(x.hours),
            price: n(x.price) ?? 0,
            packSize: n(x.packSize),
            updated: s(x.updated),
            twogisUrl: s(x.twogisUrl),
            rating: n(x.rating),
            reviews: n(x.reviews),
          })),
        },
      ];

    case "check_free_coverage":
      return [
        {
          kind: "free",
          matchedBy: result.matchedBy === "atc" ? "atc" : "inn",
          items: items.slice(0, 4).map((x) => ({
            drugName: String(x.drugName ?? ""),
            mkb10: s(x.mkb10),
            disease: s(x.disease),
            citizenCategory: s(x.citizenCategory),
            sourceUrl: s(x.sourceUrl),
          })),
        },
      ];

    case "find_analogs":
      return items.slice(0, 6).map((x) => ({
        kind: "drug" as const,
        offerId: String(x.offerId ?? ""),
        href: `/lekarstvo/${String(x.offerId ?? "")}?city=${city}`,
        title: String(x.title ?? ""),
        inn: s(x.inn),
        atc: null,
        price: n(x.price),
        packSize: n(x.packSize),
        form: null,
        manufacturer: s(x.manufacturer),
        isRx: false,
      }));

    case "find_service": {
      const svc = result.service as Row | undefined;
      if (!svc) return [];
      return [
        {
          kind: "service",
          title: String(svc.name ?? ""),
          href: `/usluga/${String(svc.id ?? "")}?city=${city}`,
          rows: items.slice(0, 6).map((x) => ({
            placeId: String(x.placeId ?? ""),
            clinic: String(x.clinic ?? ""),
            branch: s(x.branch),
            address: s(x.address),
            phone: s(x.phone),
            price: n(x.price),
            rating: n(x.rating),
            reviews: n(x.reviews),
            twogisUrl: twogisFirm(s(x.city) ?? city, s(x.twogisId)),
          })),
        },
      ];
    }

    case "place_reviews":
      return [
        {
          kind: "reviews",
          items: items.slice(0, 5).map((x) => ({
            rating: n(x.rating),
            text: String(x.text ?? ""),
            source: String(x.source ?? ""),
            date: s(x.date),
          })),
        },
      ];

    case "list_pharmacies":
      return [
        {
          kind: "pharmacy",
          rows: items.slice(0, 8).map((x) => ({
            name: String(x.name ?? ""),
            address: s(x.address),
            rating: n(x.rating),
            reviews: n(x.reviews),
          })),
        },
      ];

    default:
      return [];
  }
}

/** Маршрут покупок: не список позиций, а одна сборка, поэтому отдельно. */
export function routeCard(result: Record<string, unknown>): Card[] {
  const stops = (result.stops as Row[]) ?? [];
  if (result.error || stops.length === 0) return [];
  return [
    {
      kind: "route",
      total: n(result.total) ?? 0,
      cheapestTotal: n(result.cheapestTotal) ?? 0,
      oneStopTotal: n(result.oneStopTotal),
      oneStopName: s(result.oneStopName),
      missing: Array.isArray(result.missing) ? (result.missing as string[]) : [],
      stops: stops.map((st) => ({
        pharmacy: String(st.pharmacy ?? ""),
        address: s(st.address),
        phone: s(st.phone),
        hours: s(st.hours),
        twogisUrl: s(st.twogisUrl),
        subtotal: n(st.subtotal) ?? 0,
        lines: ((st.lines as Row[]) ?? []).map((l) => ({
          title: String(l.title ?? ""),
          packs: n(l.packs) ?? 1,
          pricePerPack: n(l.pricePerPack) ?? 0,
          subtotal: n(l.subtotal) ?? 0,
        })),
      })),
    },
  ];
}

/** compute_course отдаёт не список, а один расчёт, поэтому отдельно. */
export function courseCard(result: Record<string, unknown>): Card[] {
  if (result.error || result.explainer === undefined) return [];
  return [
    {
      kind: "course",
      units: n(result.units),
      packs: n(result.packs),
      leftover: n(result.leftover),
      explainer: String(result.explainer ?? ""),
      coursePrice: n(result.coursePrice),
      warning: s(result.warning),
    },
  ];
}
