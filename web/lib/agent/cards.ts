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
    clinic: string;
    address: string | null;
    price: number | null;
    rating: number | null;
  }[];
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
  | PharmacyCardData;

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
            clinic: String(x.brand_name ?? x.clinic ?? x.name ?? ""),
            address: s(x.address),
            price: n(x.price_kzt ?? x.price),
            rating: n(x.rating),
          })),
        },
      ];
    }

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
