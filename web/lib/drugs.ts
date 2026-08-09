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

/**
 * Тот же набор полей, но из каталога агрегатора.
 *
 * Каталог 103.kz в разы больше витрины одной сети, и главное — именно к нему
 * привязаны цены по конкретным аптекам. Без этого запроса помощник отвечал
 * «Орсотен не найден» на препарат, цены которого лежат у нас по 68 аптекам.
 *
 * Делимость берём у эталона МЗ, если позиция сматчена, иначе выводим из формы:
 * без этого нельзя посчитать курс, а таблетки и капсулы делимы почти всегда.
 */
const AGG_SELECT = `
  SELECT a.id AS offerId, a.drug_ref_id AS refId, a.name AS title,
         a.inn, a.atc, a.price_min AS price, a.is_rx AS isRx,
         a.pack_size AS packSize, a.base_form AS form,
         COALESCE(r.form_raw, a.base_form || ' ' || COALESCE(a.dosage, '')) AS formRaw,
         r.strength, r.strength_unit AS strengthUnit,
         COALESCE(r.is_divisible,
                  a.base_form IN ('Таблетки','Капсулы','Драже','Порошок','Гранулы')) AS isDivisible,
         r.reg_number AS regNumber,
         COALESCE(a.producer, r.manufacturer) AS manufacturer,
         '' AS chain, a.url AS sourceUrl,
         r.price_cap_group_max AS priceCap, r.price_cap_source AS capSource
  FROM agg_product a
  LEFT JOIN drug_ref r ON r.id = a.drug_ref_id
`;

type Raw = Record<string, unknown>;

function shape(x: Raw): DrugDetail {
  const price = (x.price as number) ?? null;
  // Потолки в приказах даны с копейками (6984.26). Формат tenge() рассчитан
  // на целые: он меняет запятую на пробел и превращает цену в «6 984 26».
  // Копейки в предельной цене всё равно ничего не решают — округляем здесь.
  const rawCap = (x.priceCap as number) ?? null;
  const cap = rawCap === null ? null : Math.round(rawCap);
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

/**
 * Поиск по витрине сетей.
 *
 * Сравнение идёт по нормализованным колонкам, а НЕ через LOWER(). Встроенный
 * LOWER() в SQLite работает только с латиницей: запрос «нурофен» строчными
 * буквами не находил ни одной строки из четырёх существующих, потому что в
 * базе лежит «Нурофен». Колонки name_norm, tn_norm и inn_norm приведены к
 * нижнему регистру ещё при загрузке, средствами Python.
 */
export function searchDrugs(q: string, limit = 40): DrugDetail[] {
  const term = normalizeName(q);
  if (term.length < 2) return [];
  const like = `%${term}%`;
  // Сжатая форма нужна и здесь: в назначении «Олигоцинк», а на витрине
  // «Олиго Цинк №270». Через пробел эти строки не сходятся.
  const compact = `%${term.replace(/[-\s.]/g, "")}%`;
  const C = (col: string) => `REPLACE(REPLACE(REPLACE(${col}, '-', ''), ' ', ''), '.', '')`;
  const rows = db()
    .prepare(
      `${LIST_SELECT}
       WHERE o.price_kzt > 0
         AND (o.name_norm LIKE ? OR r.tn_norm LIKE ? OR r.inn_norm LIKE ?
              OR ${C("o.name_norm")} LIKE ? OR ${C("r.tn_norm")} LIKE ?)
       ORDER BY (COALESCE(r.tn_norm, o.name_norm) LIKE ?) DESC, o.price_kzt ASC
       LIMIT ?`,
    )
    .all(like, like, like, compact, compact, `${term}%`, limit) as Raw[];
  return rows.map(shape);
}

/**
 * Поиск по всему, что у нас есть: сначала каталог агрегатора, потом витрина
 * сети. Именно этим ищет помощник.
 *
 * Порядок не случаен. У позиции агрегатора есть цены по конкретным аптекам, а
 * у позиции сети только один ценник на всю сеть. На вопрос «где дешевле»
 * первая отвечает, вторая нет, поэтому она и идёт первой.
 */
export function searchCatalog(q: string, city: string, limit = 8): DrugDetail[] {
  const term = normalizeName(q);
  if (term.length < 2) return [];

  // Сжатая форма: без пробелов и дефисов. В назначении пишут «Ае-вит», в
  // каталоге лежит «Аевит», и обычное сравнение их не сводит.
  const COMPACT = "REPLACE(REPLACE(REPLACE(a.name_norm, '-', ''), ' ', ''), '.', '')";

  // Короткие токены вроде «уголь» в inn дают Аллохол / Юниэнзим / Сорбикапс.
  // Для них ищем только по названию; INN — для запросов длиннее 5 букв.
  const askAgg = (t: string, compact = false) => {
    const useInn = t.replace(/\s/g, "").length > 5;
    if (useInn) {
      return db()
        .prepare(
          `${AGG_SELECT}
           WHERE a.city = ? AND a.price_min > 0
             AND (${compact ? `${COMPACT} LIKE ?` : "a.name_norm LIKE ?"} OR a.inn_norm LIKE ?)
           ORDER BY (a.name_norm LIKE ?) DESC, a.price_min ASC
           LIMIT ?`,
        )
        .all(city, `%${t}%`, `%${t}%`, `${t}%`, limit) as Raw[];
    }
    return db()
      .prepare(
        `${AGG_SELECT}
         WHERE a.city = ? AND a.price_min > 0
           AND (${compact ? `${COMPACT} LIKE ?` : "a.name_norm LIKE ?"})
         ORDER BY (a.name_norm LIKE ?) DESC, a.price_min ASC
         LIMIT ?`,
      )
      .all(city, `%${t}%`, `${t}%`, limit) as Raw[];
  };

  let agg: Raw[] = [];
  for (const [t, compact] of searchAttempts(term)) {
    agg = askAgg(t, compact);
    if (agg.length > 0) break;
  }

  // Витрину сетей опрашиваем ВСЕГДА, а не только когда у агрегатора пусто.
  // Иначе запрос «мыло Safeguard» тонет: у агрегатора находится «мыло
  // детское», лимит выбран, и настоящий Safeguard из витрины Биосферы уже не
  // доедет. То же с «олигоцинком»: агрегатор отдаёт цинковую мазь, а
  // «Витацинк» есть только у сети.
  const merged: DrugDetail[] = [];
  const seen = new Set<string>();
  for (const r of [...agg.map(shape), ...searchDrugs(q, limit)]) {
    const key = normalizeName(r.title);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }

  // Сначала то, где искомое слово реально стоит в названии: «мыло Safeguard»
  // важнее «мыла детского», даже если детское дешевле и нашлось первым.
  const compact = term.replace(/[-\s.]/g, "");
  const tokens = term.split(/\s+/).filter((w) => w.length >= 4);
  const hit = (t: string) => {
    const n = normalizeName(t);
    if (n.includes(term) || n.replace(/[-\s.]/g, "").includes(compact)) return true;
    if (
      tokens.length >= 2 &&
      tokens.every((tok) => n.includes(tok.slice(0, Math.min(5, tok.length))))
    ) {
      return true;
    }
    // Уголь в названии (не только в INN у Сорбикапса/Юниэнзима)
    if (term.includes("уголь") && n.includes("уголь")) return true;
    return false;
  };
  const multiInn = (inn: string | null) =>
    !!inn && (inn.includes("+") || inn.includes(",") || inn.split(/\s+/).length > 4);

  const ranked = merged
    .sort((a, b) => {
      const d = Number(hit(b.title)) - Number(hit(a.title));
      if (d !== 0) return d;
      const mi = Number(multiInn(a.inn)) - Number(multiInn(b.inn));
      if (mi !== 0) return mi;
      return (a.price ?? Infinity) - (b.price ?? Infinity);
    });
  // Если есть прямые попадания в название — не разбавляем Сорбикапсом/Юниэнзимом
  // из INN-матча.
  const named = ranked.filter((x) => hit(x.title));
  return (named.length > 0 ? named : ranked).slice(0, limit);
}

export function listDrugs(opts: {
  onlyRx?: boolean;
  onlyMatched?: boolean;
  maxPrice?: number;
  limit?: number;
  offset?: number;
}): DrugListItem[] {
  const where: string[] = ["o.price_kzt > 0"];
  // node:sqlite принимает только примитивы — держим массив строго типизированным,
  // иначе unknown[] не проходит проверку типов при раскрытии в .all()
  const args: (string | number)[] = [];
  if (opts.onlyRx) where.push("o.is_rx = 1");
  if (opts.onlyMatched) where.push("o.drug_ref_id IS NOT NULL");
  if (opts.maxPrice) {
    where.push("o.price_kzt <= ?");
    args.push(opts.maxPrice);
  }
  // Одна карточка на препарат (drug_ref), не на каждое предложение сети —
  // иначе витрина залита десятками «Аскорбиновая кислота» по 50–70 ₸.
  const partition = opts.onlyMatched
    ? "o.drug_ref_id"
    : "COALESCE(o.drug_ref_id, o.name_norm)";
  const rows = db()
    .prepare(
      `WITH ranked AS (
         SELECT o.id AS oid,
                ROW_NUMBER() OVER (
                  PARTITION BY ${partition}
                  ORDER BY o.price_kzt ASC, o.id
                ) AS rn
         FROM drug_offer o
         WHERE ${where.join(" AND ")}
       )
       ${LIST_SELECT}
       JOIN ranked ON ranked.oid = o.id AND ranked.rn = 1
       ORDER BY o.price_kzt ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...args, opts.limit ?? 48, opts.offset ?? 0) as Raw[];
  return rows.map(shape);
}

/**
 * Карточка позиции по идентификатору.
 *
 * Идентификаторы двух видов, и это видно по префиксу: `of_` — предложение
 * сети, `ag_` — позиция каталога агрегатора. Так у каждой позиции есть своя
 * страница, включая те тысячи наименований, которых у Еврофармы нет.
 */
export function getDrug(offerId: string): DrugDetail | null {
  const select = offerId.startsWith("ag_")
    ? `${AGG_SELECT} WHERE a.id = ?`
    : `${LIST_SELECT} WHERE o.id = ?`;
  const row = db().prepare(select).get(offerId) as Raw | undefined;
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
    priceCap: x.priceCap == null ? null : Math.round(x.priceCap as number),
    offerId: (x.offerId as string) ?? null,
    price: x.price == null ? null : Math.round(x.price as number),
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

export type PharmacyPrice = {
  id: string;
  price: number;
  pharmacyId: string | null;
  pharmacyName: string;
  address: string | null;
  chain: string | null;
  phone: string | null;
  hours: string | null;
  packSize: number | null;
  dosage: string | null;
  producer: string | null;
  updatedLabel: string | null;
  updatedOn: string | null;
  twogisUrl: string | null;
  rating: number | null;
  reviews: number | null;
  lat: number | null;
  lng: number | null;
  /** Сколько аптек продаёт позицию всего — источник отдаёт лишь первые. */
  storesTotal: number | null;
};

/**
 * Цены на препарат по КОНКРЕТНЫМ аптекам, от дешёвой к дорогой.
 *
 * Отличается от `pharmaciesForChain` принципиально. Там один ценник сети
 * разложен по её адресам: сети публикуют цену одну на все филиалы. Здесь
 * цена у каждой точки своя — Орсотен в Алматы стоит от 5 500 до 6 880 ₸ в
 * зависимости от аптеки, и это ровно тот вопрос, ради которого человек
 * приходит.
 *
 * Связываем сначала по эталону МЗ (refId): это точное совпадение препарата,
 * формы и фасовки. Название — запасной путь для позиций, которых в приказах
 * нет вовсе (БАДы, косметика): совпадение мягче, зато выдача не пустеет.
 *
 * `storesTotal` возвращается наружу не для красоты: источник отдаёт первую
 * десятку аптек, и интерфейс обязан сказать «8 из 177», а не выдать десятку
 * за весь город.
 */
export function pharmacyPrices(
  refId: string | null,
  title: string,
  city: string,
  limit = 12,
): PharmacyPrice[] {
  // Несколько кодов одной позиции (103 + Рауза), иначе one-stop на Навои
  // ломается на редком ugol_aktivirovannyy без филиала Раузы.
  const codes = pickProductCodes(refId, title, city);
  if (codes.length === 0) return [];

  const rows: Raw[] = [];
  const seenPh = new Set<string>();
  for (const code of codes) {
    const part = db()
      .prepare(
        `SELECT id, price_kzt AS price, pharmacy_id AS pharmacyId,
                pharmacy_name AS pharmacyName, address, chain_key AS chain,
                phone, working_hours AS hours, pack_size AS packSize, dosage, producer,
                updated_label AS updatedLabel, updated_on AS updatedOn,
                twogis_url AS twogisUrl, stores_total AS storesTotal,
                rating, reviews_count AS reviews, lat, lng
         FROM v_drug_price
         WHERE product_code = ? AND city = ?
         ORDER BY price_kzt`,
      )
      .all(code, city) as Raw[];
    for (const r of part) {
      const key = String(r.pharmacyId ?? "") + "|" + String(r.address ?? "");
      if (seenPh.has(key)) continue;
      seenPh.add(key);
      rows.push(r);
    }
  }

  return dropPlaceholderPrices(rows)
    .sort((a, b) => (a.price as number) - (b.price as number))
    .slice(0, limit)
    .map((x) => ({
    id: x.id as string,
    price: x.price as number,
    pharmacyId: (x.pharmacyId as string) ?? null,
    pharmacyName: (x.pharmacyName as string) ?? "",
    address: (x.address as string) ?? null,
    chain: (x.chain as string) ?? null,
    phone: (x.phone as string) ?? null,
    hours: (x.hours as string) ?? null,
    packSize: (x.packSize as number) ?? null,
    dosage: (x.dosage as string) ?? null,
    producer: (x.producer as string) ?? null,
    updatedLabel: (x.updatedLabel as string) ?? null,
    updatedOn: (x.updatedOn as string) ?? null,
      twogisUrl: (x.twogisUrl as string) ?? null,
      storesTotal: (x.storesTotal as number) ?? null,
      rating: (x.rating as number) ?? null,
      reviews: (x.reviews as number) ?? null,
      lat: (x.lat as number) ?? null,
      lng: (x.lng as number) ?? null,
    }));
}

/**
 * Выбрать ОДИН товар агрегатора, цены которого показывать.
 *
 * Привязываться только к эталону МЗ нельзя: он слишком крупный. Под одной
 * его строкой у нас лежат и «Стрепсилс Original», и «Стрепсилс Ментол», и
 * «Стрепсилс Интенсив», а это разные товары по разной цене. Показать их
 * вперемешку значит заявить разброс 900 до 2535 тенге там, где на деле
 * три разных леденца.
 *
 * Поэтому эталон сужает круг кандидатов, а внутри круга выбирается товар,
 * чьё название ближе всего к тому, что человек открыл.
 */
function pickProductCode(
  refId: string | null,
  title: string,
  city: string,
): string | null {
  const want = normalizeName(title);
  let candidates = (
    refId
      ? (db()
          .prepare(
            `SELECT product_code AS code, name_norm AS name, COUNT(*) AS n
             FROM v_drug_price WHERE drug_ref_id = ? AND city = ?
             GROUP BY product_code`,
          )
          .all(refId, city) as Raw[])
      : []
  ).concat(
    db()
      .prepare(
        `SELECT product_code AS code, name_norm AS name, COUNT(*) AS n
         FROM v_drug_price WHERE name_norm = ? AND city = ?
         GROUP BY product_code`,
      )
      .all(want, city) as Raw[],
  );

  // Сеть (of_) и агрегатор (103) часто пишут одно и то же по-разному:
  // «цитрамон-боримед no6 табл» vs «цитрамон боримед табл n6». Если точного
  // совпадения нет, берём кандидатов по первому слову марки.
  if (candidates.length === 0) {
    const token = want.split(" ")[0]?.replace(/-/g, "") ?? "";
    if (token.length >= 4) {
      candidates = db()
        .prepare(
          `SELECT product_code AS code, name_norm AS name, COUNT(*) AS n
           FROM v_drug_price
           WHERE city = ? AND (name_norm LIKE ? OR replace(name_norm,'-','') LIKE ?)
           GROUP BY product_code
           LIMIT 30`,
        )
        .all(city, `${token}%`, `${token}%`) as Raw[];
    }
  }
  if (candidates.length === 0) return null;

  const wantCompact = want.replace(/-/g, "").replace(/\s+/g, "");
  let best: { code: string; score: number; n: number } | null = null;
  for (const c of candidates) {
    const name = (c.name as string) ?? "";
    const n = (c.n as number) ?? 0;
    const nameCompact = name.replace(/-/g, "").replace(/\s+/g, "");
    // Точное совпадение названия важнее числа аптек: больше строк у более
    // популярной формы, а нужна та, которую человек открыл.
    let score = 0;
    if (name === want || nameCompact === wantCompact) score = 3;
    else if (want.startsWith(name) || name.startsWith(want)) score = 2;
    else if (nameCompact.includes(wantCompact.slice(0, 10)) || wantCompact.includes(nameCompact.slice(0, 10)))
      score = 1;
    if (!best || score > best.score || (score === best.score && n > best.n)) {
      best = { code: c.code as string, score, n };
    }
  }
  return best && best.score > 0 ? best.code : null;
}

/** До 3 кодов одной позиции (агрегатор + сети), чтобы маршрут видел Раузу. */
function pickProductCodes(
  refId: string | null,
  title: string,
  city: string,
): string[] {
  const want = normalizeName(title);
  let candidates = (
    refId
      ? (db()
          .prepare(
            `SELECT product_code AS code, name_norm AS name, COUNT(*) AS n
             FROM v_drug_price WHERE drug_ref_id = ? AND city = ?
             GROUP BY product_code`,
          )
          .all(refId, city) as Raw[])
      : []
  ).concat(
    db()
      .prepare(
        `SELECT product_code AS code, name_norm AS name, COUNT(*) AS n
         FROM v_drug_price WHERE name_norm = ? AND city = ?
         GROUP BY product_code`,
      )
      .all(want, city) as Raw[],
  );
  // Всегда добираем по марке: иначе «Олиго цинк» цепляет редкий 103,
  // а Рауза «ОЛИГО ЦИНК N90…» с 54 филиалами не попадает в маршрут.
  {
    const token = want.split(" ")[0]?.replace(/-/g, "") ?? "";
    if (token.length >= 4) {
      const extra = db()
        .prepare(
          `SELECT product_code AS code, name_norm AS name, COUNT(*) AS n
           FROM v_drug_price
           WHERE city = ? AND (name_norm LIKE ? OR replace(name_norm,'-','') LIKE ?)
           GROUP BY product_code
           LIMIT 30`,
        )
        .all(city, `${token}%`, `${token}%`) as Raw[];
      candidates = candidates.concat(extra);
    }
  }
  const wantCompact = want.replace(/-/g, "").replace(/\s+/g, "");
  const scored: { code: string; score: number; n: number }[] = [];
  for (const c of candidates) {
    const name = (c.name as string) ?? "";
    const n = (c.n as number) ?? 0;
    const nameCompact = name.replace(/-/g, "").replace(/\s+/g, "");
    let score = 0;
    if (name === want || nameCompact === wantCompact) score = 3;
    else if (want.startsWith(name) || name.startsWith(want)) score = 2;
    else if (
      nameCompact.includes(wantCompact.slice(0, 10)) ||
      wantCompact.includes(nameCompact.slice(0, 10))
    )
      score = 1;
    if (score > 0) scored.push({ code: c.code as string, n, score });
  }
  scored.sort((a, b) => b.score - a.score || b.n - a.n);
  const out: string[] = [];
  for (const s of scored) {
    if (!out.includes(s.code)) out.push(s.code);
    if (out.length >= 3) break;
  }
  return out;
}

/**
 * Убрать цены-заглушки.

 *
 * Часть аптек вместо «цены по запросу» ставит единицу или десятку: в базе
 * лежит «Диспорт за 1 тенге» при настоящей цене 72 тысячи. Показать такую
 * строку первой значит соврать в самом главном месте.
 *
 * Отсекаем по медиане, а не по фиксированному порогу: препараты стоят от
 * сорока тенге до девятисот тысяч, и один порог для всех тут невозможен.
 */
function dropPlaceholderPrices(rows: Raw[]): Raw[] {
  // Порог 30 тенге взят из провала в распределении: ниже 15 лежат только
  // заглушки, между 15 и 30 нет ничего, а самая дешёвая настоящая позиция
  // стоит 40. Тот же порог применяется при сборке базы, см. merge.py.
  const above = rows.filter((r) => {
    const p = r.price as number;
    return typeof p === "number" && p >= 30;
  });
  const kept = above.length > 0 ? above : rows;

  const prices = kept
    .map((r) => r.price as number)
    .filter((p) => typeof p === "number" && p > 0)
    .sort((a, b) => a - b);
  if (prices.length < 3) return kept;
  const median = prices[Math.floor(prices.length / 2)];
  const floor = median * 0.15;
  return kept.filter((r) => (r.price as number) >= floor);
}

/**
 * Попытки поиска, от точной к самой широкой. Возвращает пары
 * [строка поиска, сравнивать ли в сжатой форме].
 *
 * Порядок продиктован тем, как назначения пишут на бумаге:
 *
 *   «Ае-вит»                -> в каталоге «Аевит», спасает сжатая форма
 *   «Активир. уголь»        -> сокращение, спасает самое длинное слово
 *   «Орсотен 120 мг»        -> дозировка отдельной колонкой, спасает марка
 *
 * Каждая следующая попытка шире предыдущей, поэтому первая непустая и есть
 * самая точная из возможных.
 */
function searchAttempts(term: string): [string, boolean][] {
  const compact = term.replace(/[-\s.]/g, "");
  const words = term.split(/[\s.]+/).filter((w) => w.length >= 4);
  const longest = words.sort((a, b) => b.length - a.length)[0];

  // Ручные алиасы: как пишут в назначении vs как лежит в прайсе.
  const ALIASES: Record<string, string[]> = {
    олигоцинк: ["олиго цинк"],
    санпласт: ["санипласт"],
    sanplast: ["санипласт"],
    сейфгард: ["safeguard"],
    сейфгардсромашкой: ["safeguard"],
    уголь: ["уголь активированный"],
    активируголь: ["уголь активированный"],
    активированныйуголь: ["уголь активированный"],
  };

  const out: [string, boolean][] = [[term, false]];
  for (const a of ALIASES[compact] ?? []) {
    out.push([a, false]);
    const ac = a.replace(/[-\s.]/g, "");
    if (ac !== a) out.push([ac, true]);
  }
  if (compact !== term) out.push([compact, true]);
  const head = term.split(/[\s.]+/)[0];
  if (head.length >= 3 && head !== term) out.push([head, false]);
  if (longest && longest !== head && longest !== term) out.push([longest, false]);
  return out;
}

/** Тот же алгоритм, что у `norm_name` в pharma/db.py: регистр, ё, пунктуация. */
function normalizeName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[®™©"'`,.;:()[\]{}/\\+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Группы ATC — первая буква кода. Это официальная анатомо-терапевтическая
 * классификация ВОЗ, а не придуманные нами рубрики: «противомикробные» здесь
 * значит ровно то же, что в любой аптеке и в любом протоколе лечения.
 *
 * Названия сокращены до читаемых: полные формулировки классификатора
 * («Противомикробные препараты для системного применения») в чипсах фильтра
 * не помещаются и мешают выбирать.
 */
export const ATC_GROUPS: { code: string; name: string }[] = [
  { code: "J", name: "Противомикробные" },
  { code: "C", name: "Сердце и сосуды" },
  { code: "M", name: "Опорно-двигательная" },
  { code: "A", name: "ЖКТ и обмен веществ" },
  { code: "R", name: "Дыхательная система" },
  { code: "N", name: "Нервная система" },
  { code: "D", name: "Кожа" },
  { code: "B", name: "Кровь" },
  { code: "G", name: "Мочеполовая система" },
  { code: "H", name: "Гормоны" },
  { code: "S", name: "Глаза и уши" },
  { code: "P", name: "Противопаразитарные" },
  { code: "L", name: "Онкология и иммунитет" },
  { code: "V", name: "Прочие" },
];

export function atcGroupCounts(): Record<string, number> {
  const rows = db()
    .prepare(
      `SELECT SUBSTR(r.atc, 1, 1) AS g, COUNT(DISTINCT o.drug_ref_id) AS n
       FROM drug_offer o JOIN drug_ref r ON r.id = o.drug_ref_id
       WHERE r.atc IS NOT NULL AND o.price_kzt > 0
       GROUP BY g`,
    )
    .all() as { g: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.g, r.n]));
}

export function listByAtcGroup(group: string, limit = 48, offset = 0): DrugListItem[] {
  const rows = db()
    .prepare(
      `WITH ranked AS (
         SELECT o.id AS oid,
                ROW_NUMBER() OVER (
                  PARTITION BY o.drug_ref_id
                  ORDER BY o.price_kzt ASC, o.id
                ) AS rn
         FROM drug_offer o
         JOIN drug_ref r ON r.id = o.drug_ref_id
         WHERE o.price_kzt > 0 AND SUBSTR(r.atc, 1, 1) = ?
       )
       ${LIST_SELECT}
       JOIN ranked ON ranked.oid = o.id AND ranked.rn = 1
       ORDER BY o.price_kzt ASC
       LIMIT ? OFFSET ?`,
    )
    .all(group, limit, offset) as Raw[];
  return rows.map(shape);
}

export function drugTotals(): { offers: number; refs: number; free: number; withCap: number } {
  const one = (sql: string) => (db().prepare(sql).get() as { n: number }).n;
  return {
    // На витрине считаем наименования (уникальный эталон), а не строки предложений
    // по каждой аптеке — иначе «21 445 позиций» выглядит как каталог, полный дублей.
    offers: one(
      "SELECT COUNT(DISTINCT drug_ref_id) AS n FROM drug_offer WHERE price_kzt > 0 AND drug_ref_id IS NOT NULL",
    ),
    refs: one("SELECT COUNT(*) AS n FROM drug_ref"),
    free: one("SELECT COUNT(*) AS n FROM free_drug"),
    // именно позиции с СОБСТВЕННЫМ потолком из приказа, а не унаследованным
    // по группе — иначе цифра на витрине завышена и вводит в заблуждение
    withCap: one("SELECT COUNT(*) AS n FROM drug_ref WHERE price_cap_retail IS NOT NULL"),
  };
}
