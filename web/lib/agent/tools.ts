import {
  getAnalogs,
  getDrug,
  getFreeCoverage,
  pharmacyPrices,
  searchCatalog,
} from "@/lib/drugs";
import { computeCourse } from "@/lib/course";
import { getOffers, searchServices, searchServicesNL } from "@/lib/db";
import { listPharmacies } from "@/lib/pharmacies";
import { resolveCity } from "@/lib/cities";

/**
 * Инструменты помощника — единственный способ, которым модель узнаёт факты.
 *
 * Веб-поиска здесь нет намеренно. Гуглить умеет любой чат-бот, и делает это
 * плохо: он не знает казахстанских цен, наличия в аптеке рядом с домом и
 * того, что положено бесплатно. Наша ценность ровно в этих трёх вещах, и
 * все они лежат в нашей базе.
 *
 * Разделение труда, от которого нельзя отступать:
 *
 *   прочитать почерк на фото     — модель, только она это может
 *   разобрать схему приёма       — модель, это естественный язык
 *   найти препарат в справочнике — код, нужен воспроизводимый результат
 *   посчитать упаковки на курс   — код, арифметику модели не доверяем
 *   объяснить результат человеку — модель
 *
 * Поэтому compute_course — обязательный инструмент, а не удобный. Цена
 * упаковки без числа упаковок вводит в заблуждение: «1 капсула 3 раза в день
 * 40 дней» это 120 капсул, четыре упаковки по 30, а не одна.
 */

export type ToolResult = Record<string, unknown>;

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => ToolResult;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Пустой ответ — это ответ. «Не нашли» лучше, чем правдоподобная выдумка. */
function empty(what: string): ToolResult {
  return { found: 0, items: [], note: `в базе нет данных: ${what}` };
}

export const TOOLS: ToolDef[] = [
  {
    name: "find_drug",
    description:
      "Найти препарат в каталоге по названию или действующему веществу. " +
      "Возвращает позиции с ценой, фасовкой, кодом ATC и признаком «по рецепту». " +
      "Вызывать первым, чтобы получить refId и atc для остальных инструментов.",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "название или МНН, например «Нурофен» или «Ибупрофен»" },
        city: { type: "string", description: "город: almaty, astana, shymkent" },
        limit: { type: "integer", description: "сколько позиций вернуть, по умолчанию 8" },
      },
    },
    run: (a) => {
      const rows = searchCatalog(str(a.name), resolveCity(str(a.city)), num(a.limit) ?? 8);
      if (rows.length === 0) return empty(`препарат «${str(a.name)}»`);
      return {
        found: rows.length,
        items: rows.map((d) => ({
          offerId: d.offerId,
          refId: d.refId,
          title: d.title,
          inn: d.inn,
          atc: d.atc,
          price: d.price,
          packSize: d.packSize,
          form: d.form,
          // Нужны для compute_course: без делимости и фасовки курс не посчитать
          isDivisible: d.isDivisible,
          isRx: d.isRx,
          manufacturer: d.manufacturer,
        })),
      };
    },
  },

  {
    name: "drug_prices_by_pharmacy",
    description:
      "Цены на препарат в КОНКРЕТНЫХ аптеках города, от дешёвой к дорогой, " +
      "с адресом, телефоном и датой обновления прайса. Это главный инструмент " +
      "для вопроса «где дешевле» и «куда идти». Возвращает первые самые дешёвые " +
      "аптеки и поле storesTotal — сколько всего аптек продаёт позицию.",
    parameters: {
      type: "object",
      required: ["title"],
      properties: {
        refId: { type: "string", description: "refId из find_drug, если известен — так точнее" },
        title: { type: "string", description: "название препарата" },
        city: { type: "string", description: "город: almaty, astana, shymkent" },
        limit: { type: "integer" },
      },
    },
    run: (a) => {
      const rows = pharmacyPrices(
        str(a.refId) || null,
        str(a.title),
        resolveCity(str(a.city)),
        num(a.limit) ?? 10,
      );
      if (rows.length === 0) return empty(`цены по аптекам для «${str(a.title)}»`);
      return {
        found: rows.length,
        storesTotal: rows[0].storesTotal,
        cheapest: rows[0].price,
        priciest: rows[rows.length - 1].price,
        items: rows.map((r) => ({
          pharmacy: r.pharmacyName,
          chain: r.chain,
          address: r.address,
          phone: r.phone,
          hours: r.hours,
          price: r.price,
          packSize: r.packSize,
          dosage: r.dosage,
          updated: r.updatedLabel,
          twogisUrl: r.twogisUrl,
        })),
      };
    },
  },

  {
    name: "find_analogs",
    description:
      "Аналоги по коду ATC — то же действующее вещество, другой производитель. " +
      "Всегда сопровождать оговоркой, что замену согласуют с врачом или фармацевтом.",
    parameters: {
      type: "object",
      required: ["atc"],
      properties: {
        atc: { type: "string", description: "код ATC из find_drug" },
        excludeRefId: { type: "string", description: "refId исходного препарата" },
      },
    },
    run: (a) => {
      const rows = getAnalogs(str(a.atc) || null, str(a.excludeRefId) || null);
      if (rows.length === 0) return empty(`аналоги по ATC ${str(a.atc)}`);
      return {
        found: rows.length,
        items: rows.map((x) => ({
          refId: x.refId,
          offerId: x.offerId,
          title: x.title,
          inn: x.inn,
          packSize: x.packSize,
          manufacturer: x.manufacturer,
          price: x.price,
        })),
      };
    },
  },

  {
    name: "check_free_coverage",
    description:
      "Положен ли препарат бесплатно по ГОБМП/ОСМС. Проверять ВСЕГДА, прежде " +
      "чем говорить о деньгах: если препарат положен бесплатно, разговор о цене " +
      "не нужен вовсе. Совпадение по ATC надёжно, по названию вещества — мягче, " +
      "и подавать его надо как «возможно», а не как факт.",
    parameters: {
      type: "object",
      properties: {
        atc: { type: "string" },
        inn: { type: "string", description: "действующее вещество" },
      },
    },
    run: (a) => {
      const rows = getFreeCoverage(str(a.atc) || null, str(a.inn) || null);
      if (rows.length === 0) return { found: 0, items: [], note: "в перечне бесплатного обеспечения не найдено" };
      return {
        found: rows.length,
        matchedBy: str(a.atc) ? "atc" : "inn",
        items: rows.map((x) => ({
          drugName: x.drugName,
          mkb10: x.mkb10,
          disease: x.disease,
          citizenCategory: x.citizenCategory,
          sourceUrl: x.sourceUrl,
        })),
      };
    },
  },

  {
    name: "compute_course",
    description:
      "Сколько УПАКОВОК нужно на курс и сколько это стоит. Вызывать ОБЯЗАТЕЛЬНО " +
      "перед любым разговором о сумме, если известны схема приёма и длительность. " +
      "Цена упаковки без числа упаковок вводит человека в заблуждение.",
    parameters: {
      type: "object",
      required: ["packSize", "timesPerDay", "days"],
      properties: {
        packSize: { type: "integer", description: "штук в упаковке" },
        isDivisible: { type: "boolean", description: "таблетки/капсулы — true; мазь, сироп — false" },
        form: { type: "string" },
        dosePerIntake: { type: "number", description: "сколько единиц за приём, по умолчанию 1" },
        timesPerDay: { type: "number" },
        days: { type: "integer" },
        pricePerPack: { type: "number", description: "если передать — вернём стоимость курса" },
      },
    },
    run: (a) => {
      const r = computeCourse({
        packSize: num(a.packSize),
        isDivisible: a.isDivisible !== false,
        form: str(a.form) || null,
        dosePerIntake: num(a.dosePerIntake) ?? 1,
        timesPerDay: num(a.timesPerDay) ?? 0,
        days: num(a.days) ?? 0,
      });
      const price = num(a.pricePerPack);
      return {
        units: r.units,
        packs: r.packs,
        leftover: r.leftover,
        explainer: r.explainer,
        isEstimate: r.isEstimate,
        warning: r.warning,
        coursePrice: price !== null && r.packs !== null ? price * r.packs : null,
      };
    },
  },

  {
    name: "find_service",
    description:
      "Медицинская услуга (анализ, УЗИ, МРТ, приём врача) и клиники с ценами " +
      "в городе. Для услуг, а не для лекарств.",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        city: { type: "string" },
      },
    },
    run: (a) => {
      const city = resolveCity(str(a.city));
      const hits = searchServices(str(a.name), 3);
      const found = hits.length > 0 ? hits : searchServicesNL(str(a.name), 3);
      if (found.length === 0) return empty(`услуга «${str(a.name)}»`);

      const service = found[0];
      const offers = getOffers(service.id, city).slice(0, 8);
      return {
        service: { id: service.id, name: service.name, category: service.category },
        alsoFound: found.slice(1).map((s) => ({ id: s.id, name: s.name })),
        found: offers.length,
        items: offers,
      };
    },
  },

  {
    name: "list_pharmacies",
    description:
      "Аптеки города с рейтингом и адресом. Для вопроса «какие аптеки рядом», " +
      "а не «где дешевле» — для цен есть drug_prices_by_pharmacy.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string" },
        limit: { type: "integer" },
      },
    },
    run: (a) => {
      const rows = listPharmacies(resolveCity(str(a.city)), num(a.limit) ?? 12);
      if (rows.length === 0) return empty("аптеки в этом городе");
      return {
        found: rows.length,
        items: rows.map((p) => ({
          id: p.id,
          name: p.name,
          chain: p.chain,
          address: p.address,
          rating: p.rating,
          reviews: p.reviews,
        })),
      };
    },
  },

  {
    name: "get_drug",
    description:
      "Полная карточка позиции по offerId: форма, дозировка, делимость, " +
      "предельная цена МЗ РК и признак её устаревания.",
    parameters: {
      type: "object",
      required: ["offerId"],
      properties: { offerId: { type: "string" } },
    },
    run: (a) => {
      const d = getDrug(str(a.offerId));
      if (!d) return empty(`позиция ${str(a.offerId)}`);
      return {
        ...d,
        // Потолок из приказа 2019 года сравнивать с ценой 2026-го нельзя:
        // получаются «переплаты» в сотни процентов там, где их нет.
        priceCapUsable: !d.capIsStale,
      };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Объявления инструментов в формате OpenAI function calling. */
export function toolDeclarations() {
  return TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

/**
 * Выполнить вызов инструмента. Ошибку возвращаем как данные, а не бросаем:
 * модель должна увидеть «не получилось» и честно сказать это человеку, а не
 * уронить весь ответ.
 */
export function runTool(name: string, args: Record<string, unknown>): ToolResult {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `неизвестный инструмент: ${name}` };
  try {
    return tool.run(args ?? {});
  } catch (e) {
    return { error: e instanceof Error ? e.message : "ошибка инструмента" };
  }
}
