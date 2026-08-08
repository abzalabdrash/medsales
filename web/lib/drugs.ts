import { db } from "./db";

/**
 * Слой данных по лекарствам.
 *
 * Три вещи, которых нет у обычного каталога аптеки и ради которых всё
 * собиралось:
 *   1. pack_size -> можно посчитать, сколько УПАКОВОК нужно на курс;
 *   2. price_cap_group_max -> предельная розничная цена МЗ РК, то есть
 *      объективный признак переплаты;
 *   3. free_drug -> препарат может быть положен бесплатно, и тогда
 *      разговор о цене вообще не нужен.
 */

export type DrugListItem = {
  offerId: string;
  refId: string | null;
  title: string;
  inn: string | null;
  atc: string | null;
  price: number | null;
  isRx: boolean;
  packSize: number | null;
  form: string | null;
  manufacturer: string | null;
  chain: string;
  priceCap: number | null;
  overpayPct: number | null;
  capIsStale: boolean;
};

export type DrugDetail = DrugListItem & {
  formRaw: string | null;
  strength: number | null;
  strengthUnit: string | null;
  isDivisible: boolean;
  regNumber: string | null;
  sourceUrl: string | null;
  capSource: string | null;
};

export type Analog = {
  refId: string;
  title: string;
  inn: string | null;
  packSize: number | null;
  form: string | null;
  manufacturer: string | null;
  priceCap: number | null;
  offerId: string | null;
  price: number | null;
};

export type FreeDrugHit = {
  drugName: string;
  mkb10: string | null;
  disease: string | null;
  citizenCategory: string | null;
  indication: string | null;
  sourceUrl: string | null;
};

/**
 * Приказ 2019 года всё ещё формально действует, но сравнивать с ним цену
 * 2026 года бессмысленно: получаются «переплаты» в сотни процентов там,
 * где их нет. Флаг доезжает до интерфейса, чтобы такие случаи можно было
 * показать мягче или не показывать вовсе.
 */
const STALE_CAP_DOCS = new Set(["V1900019037"]);

function overpay(price: number | null, cap: number | null): number | null {
  if (!price || !cap || cap <= 0) return null;
  return Math.round((price / cap - 1) * 100);
}

const LIST_SELECT = `
  SELECT o.id AS offerId, o.drug_ref_id AS refId,
         COALESCE(r.tn, o.name_raw) AS title,
         r.inn, r.atc, o.price_kzt AS price, o.is_rx AS isRx,
         r.pack_size AS packSize, r.form, r.form_raw AS formRaw,
         r.strength, r.strength_unit AS strengthUnit,
         r.is_divisible AS isDivisible, r.reg_number AS regNumber,
         COALESCE(o.manufacturer, r.manufacturer) AS manufacturer,
         o.chain, o.source_url AS sourceUrl,
         r.price_cap_group_max AS priceCap, r.price_cap_source AS capSource
  FROM drug_offer o
  LEFT JOIN drug_ref r ON r.id = o.drug_ref_id
`;

type Raw = Record<string, unknown>;

function shape(x: Raw): DrugDetail {
  const price = (x.price as number) ?? null;
  const cap = (x.priceCap as number) ?? null;
  const capSource = (x.capSource as string) ?? null;
  return {
    offerId: x.offerId as string,
    refId: (x.refId as string) ?? null,
    title: x.title as string,
    inn: (x.inn as string) ?? null,
    atc: (x.atc as string) ?? null,
    price,
    isRx: Boolean(x.isRx),
    packSize: (x.packSize as number) ?? null,
    form: (x.form as string) ?? null,
    formRaw: (x.formRaw as string) ?? null,
    strength: (x.strength as number) ?? null,
    strengthUnit: (x.strengthUnit as string) ?? null,
    isDivisible: Boolean(x.isDivisible),
    regNumber: (x.regNumber as string) ?? null,
    manufacturer: (x.manufacturer as string) ?? null,
    chain: (x.chain as string) ?? "",
    sourceUrl: (x.sourceUrl as string) ?? null,
    priceCap: cap,
    capSource,
    overpayPct: overpay(price, cap),
    capIsStale: capSource ? STALE_CAP_DOCS.has(capSource) : false,
  };
}

export function searchDrugs(q: string, limit = 40): DrugListItem[] {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const rows = db()
    .prepare(
      `${LIST_SELECT}
       WHERE o.price_kzt > 0
         AND (LOWER(o.name_raw) LIKE ? OR LOWER(r.tn) LIKE ? OR LOWER(r.inn) LIKE ?)
       ORDER BY (LOWER(COALESCE(r.tn, o.name_raw)) LIKE ?) DESC, o.price_kzt ASC
       LIMIT ?`,
    )
    .all(like, like, like, `${term}%`, limit) as Raw[];
  return rows.map(shape);
}

export function listDrugs(opts: {
  onlyRx?: boolean;
  onlyMatched?: boolean;
  maxPrice?: number;
  limit?: number;
  offset?: number;
}): DrugListItem[] {
  const where: string[] = ["o.price_kzt > 0"];
  const args: unknown[] = [];
  if (opts.onlyRx) where.push("o.is_rx = 1");
  if (opts.onlyMatched) where.push("o.drug_ref_id IS NOT NULL");
  if (opts.maxPrice) {
    where.push("o.price_kzt <= ?");
    args.push(opts.maxPrice);
  }
  const rows = db()
    .prepare(
      `${LIST_SELECT} WHERE ${where.join(" AND ")}
       ORDER BY o.price_kzt ASC LIMIT ? OFFSET ?`,
    )
    .all(...args, opts.limit ?? 48, opts.offset ?? 0) as Raw[];
  return rows.map(shape);
}

export function getDrug(offerId: string): DrugDetail | null {
  const row = db()
    .prepare(`${LIST_SELECT} WHERE o.id = ?`)
    .get(offerId) as Raw | undefined;
  return row ? shape(row) : null;
}

/** Аналоги по ATC — то же действующее вещество, другой производитель. */
export function getAnalogs(atc: string | null, excludeRefId: string | null, limit = 8): Analog[] {
  if (!atc) return [];
  const rows = db()
    .prepare(
      `SELECT r.id AS refId, r.tn AS title, r.inn, r.pack_size AS packSize,
              r.form, r.manufacturer, r.price_cap_group_max AS priceCap,
              o.id AS offerId, o.price_kzt AS price
       FROM drug_ref r
       LEFT JOIN drug_offer o ON o.drug_ref_id = r.id AND o.price_kzt > 0
       WHERE r.atc = ? AND r.id <> COALESCE(?, '')
       ORDER BY (o.price_kzt IS NULL), o.price_kzt ASC, r.price_cap_group_max ASC
       LIMIT ?`,
    )
    .all(atc, excludeRefId, limit) as Raw[];
  return rows.map((x) => ({
    refId: x.refId as string,
    title: x.title as string,
    inn: (x.inn as string) ?? null,
    packSize: (x.packSize as number) ?? null,
    form: (x.form as string) ?? null,
    manufacturer: (x.manufacturer as string) ?? null,
    priceCap: (x.priceCap as number) ?? null,
    offerId: (x.offerId as string) ?? null,
    price: (x.price as number) ?? null,
  }));
}

/**
 * Положен ли препарат бесплатно. Сначала по ATC (код либо совпадает, либо
 * нет — это надёжно), при отсутствии кода — по названию действующего
 * вещества. Совпадение по названию мягче, поэтому в интерфейсе такой ответ
 * подаётся как «возможно», а не как факт.
 */
export function getFreeCoverage(atc: string | null, inn: string | null): FreeDrugHit[] {
  const rows = atc
    ? (db()
        .prepare(
          `SELECT drug_name AS drugName, mkb10, disease,
                  citizen_category AS citizenCategory, indication, source_url AS sourceUrl
           FROM free_drug WHERE atc = ? LIMIT 6`,
        )
        .all(atc) as Raw[])
    : inn
      ? (db()
          .prepare(
            `SELECT drug_name AS drugName, mkb10, disease,
                    citizen_category AS citizenCategory, indication, source_url AS sourceUrl
             FROM free_drug WHERE drug_name_norm LIKE ? LIMIT 6`,
          )
          .all(`${inn.toLowerCase()}%`) as Raw[])
      : [];
  return rows.map((x) => ({
    drugName: x.drugName as string,
    mkb10: (x.mkb10 as string) ?? null,
    disease: (x.disease as string) ?? null,
    citizenCategory: (x.citizenCategory as string) ?? null,
    indication: (x.indication as string) ?? null,
    sourceUrl: (x.sourceUrl as string) ?? null,
  }));
}

export function drugTotals(): { offers: number; refs: number; free: number; withCap: number } {
  const one = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  return {
    offers: one("SELECT COUNT(*) AS n FROM drug_offer WHERE price_kzt > 0"),
    refs: one("SELECT COUNT(*) AS n FROM drug_ref"),
    free: one("SELECT COUNT(*) AS n FROM free_drug"),
    withCap: one("SELECT COUNT(*) AS n FROM drug_ref WHERE price_cap_group_max IS NOT NULL"),
  };
}
