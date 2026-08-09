import {
  getAnalogs,
  getDrug,
  getFreeCoverage,
  pharmacyPrices,
  searchCatalog,
} from "@/lib/drugs";
import { computeCourse } from "@/lib/course";
import { getServiceLocations, searchServices, searchServicesNL } from "@/lib/db";
import { listPharmacies, placeReviews } from "@/lib/pharmacies";
import { resolveCity } from "@/lib/cities";
import { buildBasket } from "./basket";

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
const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/**
 * Первое непустое значение из нескольких имён параметра.
 *
 * Модель регулярно зовёт параметр по-своему: query вместо name, quantity
 * вместо packs, drugName вместо title. Схема при этом описана верно, просто
 * она её не всегда соблюдает. Спорить с ней дороже, чем принять синонимы:
 * отказ инструмента стоит целого раунда и выглядит как поломка.
 */
const pick = (a: Record<string, unknown>, ...names: string[]): unknown => {
  for (const n of names) if (a[n] !== undefined && a[n] !== null && a[n] !== "") return a[n];
  return undefined;
};

/**
 * Как процедуру называет врач и как она записана в прайсе клиники, это
 * два разных языка.
 *
 * В назначении пишут «жидкий азот» или «криотерапия», а в прайсе строка
 * называется «Криодеструкция 1 элемента врачом-дерматологом». Поиск по
 * словам врача не находит ничего, и человек слышит «нет данных» о процедуре,
 * которая есть в четырёх клиниках города.
 */
const SERVICE_SYNONYMS: [RegExp, string[]][] = [
  // Обе орфографии реальны: в прайсах лежат и «Криодеструкция бородавок», и
  // «Криодиструкция 1 элемента врачом-дерматологом». Вторая написана с
  // ошибкой, но встречается в четырёх клиниках, а правильная в одной.
  [
    /жидк\w*\s+азот|криотерап|криодеструкц|криодиструкц|прижиг\w*\s+азот/i,
    ["криодиструкция", "криодеструкция"],
  ],
  [/\bоак\b|общий\s+анализ\s+кров/i, ["общий анализ крови"]],
  [/\bоам\b|общий\s+анализ\s+моч/i, ["общий анализ мочи"]],
  [/биохими\w*\s+кров/i, ["биохимический анализ крови"]],
  [/узи\s+брюшн/i, ["узи органов брюшной полости"]],
];

/** Варианты названия услуги, от синонима к исходному тексту запроса. */
function serviceCandidates(q: string): string[] {
  for (const [re, names] of SERVICE_SYNONYMS) if (re.test(q)) return [...names, q];
  return [q];
}

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
      const rows = searchCatalog(str(pick(a, "name", "query", "drug", "title")),
        resolveCity(str(a.city)), num(a.limit) ?? 8);
      if (rows.length === 0) return empty(`препарат «${str(pick(a, "name", "query", "drug", "title"))}»`);
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
        str(pick(a, "refId", "drugRefId")) || null,
        str(pick(a, "title", "name", "drug")),
        resolveCity(str(a.city)),
        num(a.limit) ?? 10,
      );
      if (rows.length === 0) return empty(`цены по аптекам для «${str(pick(a, "title", "name", "drug"))}»`);
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
          rating: r.rating,
          reviews: r.reviews,
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
      const rows = getAnalogs(str(a.atc) || null, str(pick(a, "excludeRefId", "refId")) || null);
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
        title: { type: "string", description: "название препарата для подписи расчёта" },
      },
    },
    run: (a) => {
      const r = computeCourse({
        packSize: num(pick(a, "packSize", "pack_size", "pack")),
        isDivisible: a.isDivisible !== false,
        form: str(a.form) || null,
        dosePerIntake: num(pick(a, "dosePerIntake", "dose", "dosePerTake")) ?? 1,
        timesPerDay: num(pick(a, "timesPerDay", "freqPerDay", "timesADay")) ?? 0,
        days: num(pick(a, "days", "durationDays", "duration")) ?? 0,
      });
      const price = num(pick(a, "pricePerPack", "price", "packPrice"));
      return {
        title: str(pick(a, "title", "name", "drug")) || null,
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
      "Медицинская услуга (анализ, УЗИ, МРТ, процедура, прием врача) и клиники, " +
      "где она есть, с ценой, адресом, рейтингом и числом отзывов. " +
      "Этим же инструментом ищется прием нужного специалиста: запрос " +
      "«прием дерматолога», «прием эндокринолога».",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "название услуги или «прием <специалист>»" },
        city: { type: "string" },
        sortBy: {
          type: "string",
          enum: ["price", "rating"],
          description: "по цене или по рейтингу, по умолчанию по цене",
        },
      },
    },
    run: (a) => {
      const city = resolveCity(str(a.city));
      const asked = str(pick(a, "name", "query", "service", "title"));
      // Перебираем варианты названия, пока не найдётся тот, у которого в этом
      // городе действительно есть клиники. Услуга, найденная в справочнике, но
      // нигде рядом не оказываемая, человеку бесполезна.
      let service: { id: string; name: string; category: string } | null = null;
      let rows: ReturnType<typeof getServiceLocations> = [];
      let found: { id: string; name: string; category: string }[] = [];
      for (const want of serviceCandidates(asked)) {
        const hits = searchServices(want, 3);
        found = hits.length > 0 ? hits : searchServicesNL(want, 3);
        for (const cand of found) {
          const locs = getServiceLocations(cand.id, city);
          if (locs.length > 0) {
            service = cand;
            rows = locs;
            break;
          }
        }
        if (service) break;
      }
      if (!service) return empty(`услуга «${asked}» в этом городе`);

      // «Лучший» это не всегда самый дешёвый. Рейтинг без числа отзывов
      // ничего не значит, поэтому пятёрка по двум отзывам не должна
      // обгонять 4,6 по трёмстам.
      if (str(a.sortBy) === "rating") {
        rows = [...rows].sort(
          (x, y) =>
            (y.rating ?? 0) * Math.log10(1 + (y.reviews ?? 0)) -
            (x.rating ?? 0) * Math.log10(1 + (x.reviews ?? 0)),
        );
      }
      return {
        service: { id: service.id, name: service.name, category: service.category },
        alsoFound: found.slice(1).map((s) => ({ id: s.id, name: s.name })),
        found: rows.length,
        items: rows.slice(0, 8).map((r) => ({
          placeId: r.branchId,
          clinic: r.brand,
          branch: r.branch,
          address: r.address,
          phone: r.phone,
          price: r.price,
          rating: r.rating,
          reviews: r.reviews,
          twogisId: r.twogisId,
          city: r.city,
        })),
      };
    },
  },

  {
    name: "place_reviews",
    description:
      "Тексты отзывов о клинике или аптеке по placeId из find_service или " +
      "list_pharmacies. Нужен, когда человек спрашивает, какая клиника лучше: " +
      "одна цифра рейтинга ничего не объясняет.",
    parameters: {
      type: "object",
      required: ["placeId"],
      properties: { placeId: { type: "string" } },
    },
    run: (a) => {
      const rows = placeReviews(str(pick(a, "placeId", "id", "branchId")), 6);
      if (rows.length === 0) return empty("отзывы об этой точке");
      return {
        found: rows.length,
        items: rows.map((r) => ({
          rating: r.rating,
          text: r.text.slice(0, 400),
          source: r.source,
          date: r.createdAt,
        })),
      };
    },
  },

  {
    name: "build_shopping_route",
    description:
      "Маршрут покупок по всему назначению сразу: что и в какой аптеке брать, " +
      "сколько выйдет всего. Вызывать, когда позиций больше одной. " +
      "Возвращает точки маршрута, итог, а также два ориентира: сколько выйдет, " +
      "если гнаться за минимумом по каждой позиции, и сколько, если взять все " +
      "в одной аптеке. Позиции, которых нет в базе, возвращаются в missing, " +
      "и о них надо сказать честно.",
    parameters: {
      type: "object",
      required: ["items"],
      properties: {
        city: { type: "string" },
        items: {
          type: "array",
          description: "позиции назначения",
          items: {
            type: "object",
            required: ["title"],
            properties: {
              title: { type: "string", description: "название препарата" },
              refId: { type: "string", description: "refId из find_drug, если известен" },
              packs: {
                type: "integer",
                description: "сколько упаковок на курс, из compute_course",
              },
            },
          },
        },
      },
    },
    run: (a) => {
      const raw = Array.isArray(a.items) ? (a.items as Record<string, unknown>[]) : [];
      const items = raw
        .filter((x) => str(pick(x, "title", "name", "drug")))
        .map((x) => ({
          title: str(pick(x, "title", "name", "drug")),
          refId: str(pick(x, "refId", "offerId")) || null,
          packs: num(pick(x, "packs", "quantity", "packsNeeded", "count")) ?? 1,
        }));
      if (items.length === 0) return empty("позиции для маршрута не переданы");

      const near =
        Number.isFinite(Number(a.nearLat)) && Number.isFinite(Number(a.nearLng))
          ? {
              lat: Number(a.nearLat),
              lng: Number(a.nearLng),
              label: str(a.nearLabel) || null,
            }
          : null;
      const basket = buildBasket(items, resolveCity(str(a.city)), { near });
      if (basket.stops.length === 0) {
        return { found: 0, items: [], missing: basket.missing, note: "ни одной позиции нет в базе" };
      }
      return { ...basket, found: basket.stops.length, nearLabel: near?.label ?? null };
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
      const d = getDrug(str(pick(a, "offerId", "id", "refId")));
      if (!d) return empty(`позиция ${str(pick(a, "offerId", "id", "refId"))}`);
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
