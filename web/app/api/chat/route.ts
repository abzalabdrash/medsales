import { complete, streamChat, parseJsonLenient, type ChatMessage } from "@/lib/llm/client";
import { llmConfigured, llmSettings } from "@/lib/llm/config";
import { runTool, toolDeclarations } from "@/lib/agent/tools";
import { cardsFrom, courseCard, routeCard, type Card } from "@/lib/agent/cards";
import { systemPrompt, VISION_PROMPT } from "@/lib/agent/prompts";
import { resolveCity, CITIES } from "@/lib/cities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Помощник: цикл «модель вызывает инструмент, код отвечает данными».
 *
 * Наружу идёт поток NDJSON, по событию в строке. Так интерфейс может рисовать
 * карточку сразу, как только инструмент вернул строки, не дожидаясь, пока
 * модель допишет текст.
 *
 * Карточки собирает КОД из ответа инструмента. Модель не участвует в
 * появлении цены, адреса и ссылки, поэтому выдумать их она не может.
 */

// Назначение на девять позиций требует поиска по каждой, расчёта курса,
// проверки льгот и сборки маршрута. Шести раундов на это не хватало, и
// агент бросал работу на середине.
const MAX_ROUNDS = 12;

type Body = {
  messages?: { role: "user" | "assistant"; content: string }[];
  city?: string;
  locale?: string;
  /** Фото назначения как data: URL. Разбирается до начала диалога. */
  image?: string;
  /** Адрес из кабинета (localStorage): считает «рядом» для маршрута. */
  address?: { label: string; lat: number; lng: number } | null;
};

type Event =
  | { t: "status"; v: string }
  | { t: "card"; v: Card }
  | { t: "prescription"; v: PrescriptionItem[] }
  | { t: "text"; v: string }
  | { t: "done" }
  | { t: "error"; v: string };

type PrescriptionItem = {
  name: string;
  dosage?: string | null;
  dosePerIntake?: number | null;
  timesPerDay?: number | null;
  days?: number | null;
  quantity?: number | null;
  kind?: string | null;
  confidence?: number | null;
  raw?: string | null;
};

/**
 * Вызовы инструментов, утёкшие в текст.
 *
 * Luna периодически пишет вызов прозой вместо структурного поля:
 *
 *     to=functions.check_free_coverage  (json)
 *     {"atc":"A11JA","inn":"Ретинол+токоферол"}
 *
 * Для человека это мусор посреди ответа, а работа при этом не делается.
 * Вылавливаем такие куски, превращаем в настоящие вызовы и убираем из
 * текста. Дешевле, чем менять модель, и помогает любой модели, которая
 * однажды собьётся так же.
 */
const LEAKED_CALL = /to=functions\.([a-z_]+)\s*(?:\([^)]*\))?\s*(\{)/g;

function extractLeakedCalls(text: string): {
  clean: string;
  calls: { name: string; args: Record<string, unknown> }[];
} {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let clean = "";
  let cursor = 0;
  let m: RegExpExecArray | null;
  LEAKED_CALL.lastIndex = 0;

  while ((m = LEAKED_CALL.exec(text)) !== null) {
    const braceStart = m.index + m[0].length - 1;
    // ищем парную закрывающую скобку, считая вложенность
    let depth = 0;
    let end = -1;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    try {
      calls.push({
        name: m[1],
        args: JSON.parse(text.slice(braceStart, end + 1)) as Record<string, unknown>,
      });
    } catch {
      // не разобралось — оставим кусок в тексте, чтобы ничего не потерять
      continue;
    }
    clean += text.slice(cursor, m.index);
    cursor = end + 1;
    LEAKED_CALL.lastIndex = cursor;
  }
  clean += text.slice(cursor);
  return { clean: clean.trim(), calls };
}

/** Подписи для строки состояния: человек видит, чем занят помощник. */
const TOOL_STATUS: Record<string, string> = {
  find_drug: "ищу в каталоге",
  drug_prices_by_pharmacy: "сверяю цены",
  find_analogs: "смотрю аналоги",
  check_free_coverage: "проверяю льготы",
  compute_course: "считаю курс",
  build_shopping_route: "строю маршрут",
  find_service: "ищу в клиниках",
  list_pharmacies: "подбираю аптеки",
  get_drug: "открываю карточку",
  place_reviews: "читаю отзывы",
};

export async function POST(req: Request) {
  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const city = resolveCity(payload.city);
  const cityName = CITIES.find((c) => c.slug === city)?.name ?? city;
  const history = (payload.messages ?? []).slice(-10);
  const near =
    payload.address &&
    typeof payload.address.label === "string" &&
    Number.isFinite(payload.address.lat) &&
    Number.isFinite(payload.address.lng)
      ? {
          label: payload.address.label,
          lat: payload.address.lat,
          lng: payload.address.lng,
        }
      : null;

  if (!llmConfigured()) {
    return json({
      t: "error",
      v: "Помощник не подключен: в .env нет API_KEYS.",
    });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: Event) =>
        controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));

      try {
        let drugCardsEmitted = 0;
        let routeEmitted = false;
        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt(city, cityName, near) },
        ];

        // --- фото назначения разбираем до диалога -------------------------
        if (payload.image) {
          send({ t: "status", v: "читаю назначение" });
          const items = await readPrescription(payload.image);
          if (items === null) {
            send({
              t: "text",
              v: "Не удалось прочитать назначение на этом снимке. Попробуйте снять при лучшем свете, чтобы строки попали в кадр целиком, либо напишите названия текстом.",
            });
            send({ t: "done" });
            controller.close();
            return;
          }
          send({ t: "prescription", v: items });
          messages.push({
            role: "user",
            content:
              "С фотографии назначения распознаны позиции (JSON). Найди по каждой " +
              "цены в аптеках города, посчитай курс там, где известна схема приема, " +
              "и проверь бесплатное обеспечение. Позиции с confidence ниже 0.7 " +
              "переспроси, не угадывай.\n\n" +
              JSON.stringify(items, null, 1),
          });
        }

        for (const m of history) {
          messages.push({ role: m.role, content: m.content });
        }

        const tools = toolDeclarations();
        let rounds = 0;
        let wroteText = false;

        for (;;) {
          rounds += 1;
          let text = "";
          let calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] = [];

          // Между раундами модель начинает новую мысль. Без разделителя куски
          // склеиваются в «...аптеках.По общему анализу...».
          if (wroteText) send({ t: "text", v: "\n\n" });

          // Текст отдаём потоком, но с задержкой в несколько символов: если в
          // нём начинается утёкший вызов инструмента, показывать его человеку
          // нельзя, а понять это можно только увидев начало метки.
          let flushed = 0;
          let leaking = false;
          const HOLD = 16;

          for await (const chunk of streamChat({
            messages,
            tools: rounds < MAX_ROUNDS ? tools : undefined,
            signal: req.signal,
          })) {
            if (chunk.kind === "text") {
              text += chunk.delta;
              if (!leaking && text.includes("to=functions")) leaking = true;
              if (!leaking) {
                const safe = text.length - HOLD;
                if (safe > flushed) {
                  send({ t: "text", v: text.slice(flushed, safe) });
                  flushed = safe;
                  wroteText = true;
                }
              }
            }
            if (chunk.kind === "done") calls = chunk.calls;
          }

          const { clean, calls: leaked } = extractLeakedCalls(text);
          if (clean.length > flushed) {
            send({ t: "text", v: clean.slice(flushed) });
            wroteText = true;
          }
          text = clean;
          for (const l of leaked) {
            calls.push({
              id: `leaked_${calls.length}_${l.name}`,
              type: "function",
              function: { name: l.name, arguments: JSON.stringify(l.args) },
            });
          }

          if (calls.length === 0) break;

          // Реплику модели с вызовами надо положить в историю до результатов,
          // иначе шлюз не сопоставит tool_call_id с ответом.
          messages.push({ role: "assistant", content: text || null, tool_calls: calls });

          for (const call of calls) {
            const status = TOOL_STATUS[call.function.name];
            if (status) send({ t: "status", v: status });

            let args: Record<string, unknown> = {};
            try {
              args = call.function.arguments
                ? (parseJsonLenient(call.function.arguments) as Record<string, unknown>)
                : {};
            } catch {
              args = {};
            }
            if (!args.city) args.city = city;
            // Адрес человека подмешиваем в маршрут: модель координаты не
            // знает, а buildBasket считает близость по ним.
            if (near) {
              args.nearLat = near.lat;
              args.nearLng = near.lng;
              args.nearLabel = near.label;
            }
            // Ссылки в карточках должны вести в тот же город, в котором
            // инструмент искал. Иначе на вопрос про Астану приходят цены
            // Астаны, а ссылка открывает страницу с ценами Алматы.
            const usedCity = resolveCity(String(args.city));

            const result = runTool(call.function.name, args);
            const cards =
              call.function.name === "compute_course"
                ? courseCard(result, args)
                : call.function.name === "build_shopping_route"
                  ? routeCard(result)
                  : cardsFrom(call.function.name, args, result, usedCity);
            // Бюджет: не больше 8 drug-карточек за весь ответ.
            for (const card of cards) {
              if (card.kind === "drug") {
                drugCardsEmitted += 1;
                if (drugCardsEmitted > 8) continue;
              }
              if (routeEmitted && (card.kind === "drug" || card.kind === "pharmacyPrice")) {
                continue;
              }
              if (card.kind === "route") routeEmitted = true;
              send({ t: "card", v: card });
            }

            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }

          if (rounds >= MAX_ROUNDS) break;
        }

        send({ t: "done" });
      } catch (e) {
        const raw = e instanceof Error ? e.message : "не удалось получить ответ";
        const low = raw.toLowerCase();
        const v =
          low.includes("quota") || low.includes("insufficient") || low.includes("баланс")
            ? "У API-ключа закончился баланс у провайдера модели. Пополните счет или обновите API_KEYS в Vercel."
            : low.includes("all keys") || low.includes("все ключи")
              ? "Все API-ключи недоступны. Проверьте API_KEYS и баланс."
              : raw;
        send({ t: "error", v });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Разбор фото назначения. Отдельный вызов без инструментов: задача не
 * помочь, а прочитать, и смешивать её с диалогом значит дать модели
 * возможность «дополнить» назначение тем, чего на снимке нет.
 *
 * Возвращает null, если снимок нечитаем.
 */
async function readPrescription(dataUrl: string): Promise<PrescriptionItem[] | null> {
  const { text } = await complete({
    // OCR: Gemini 3.1 Pro (Clodex). Агент с tools остаётся на Sol.
    model: llmSettings().visionModel,
    // Для буквального чтения reasoning не нужен — только тормозит.
    reasoningEffort: fromEnvVisionEffort(),
    messages: [
      { role: "system", content: VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Прочитай назначение буква в букву и верни позиции в JSON." },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  try {
    const parsed = parseJsonLenient<{ readable?: boolean; items?: PrescriptionItem[] }>(text);
    if (parsed.readable === false) return null;
    const items = (parsed.items ?? []).filter((x) => x?.name);
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

function fromEnvVisionEffort(): string {
  return process.env.LLM_VISION_REASONING_EFFORT || "low";
}

function json(e: Event): Response {
  return new Response(JSON.stringify(e) + "\n", {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
