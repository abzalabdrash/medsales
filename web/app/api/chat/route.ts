import { complete, streamChat, parseJsonLenient, type ChatMessage } from "@/lib/llm/client";
import { llmConfigured } from "@/lib/llm/config";
import { runTool, toolDeclarations } from "@/lib/agent/tools";
import { cardsFrom, courseCard, type Card } from "@/lib/agent/cards";
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

const MAX_ROUNDS = 6;

type Body = {
  messages?: { role: "user" | "assistant"; content: string }[];
  city?: string;
  locale?: string;
  /** Фото назначения как data: URL. Разбирается до начала диалога. */
  image?: string;
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

/** Подписи для строки состояния: человек видит, чем занят помощник. */
const TOOL_STATUS: Record<string, string> = {
  find_drug: "ищу препарат в каталоге",
  drug_prices_by_pharmacy: "сравниваю цены по аптекам",
  find_analogs: "смотрю аналоги по действующему веществу",
  check_free_coverage: "проверяю, положено ли бесплатно",
  compute_course: "считаю, сколько упаковок нужно на курс",
  find_service: "ищу услугу в клиниках",
  list_pharmacies: "подбираю аптеки",
  get_drug: "открываю карточку препарата",
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
        const messages: ChatMessage[] = [
          { role: "system", content: systemPrompt(city, cityName) },
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

          for await (const chunk of streamChat({
            messages,
            tools: rounds < MAX_ROUNDS ? tools : undefined,
            signal: req.signal,
          })) {
            if (chunk.kind === "text") {
              send({ t: "text", v: chunk.delta });
              wroteText = true;
            }
            if (chunk.kind === "done") {
              text = chunk.text;
              calls = chunk.calls;
            }
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
            // Ссылки в карточках должны вести в тот же город, в котором
            // инструмент искал. Иначе на вопрос про Астану приходят цены
            // Астаны, а ссылка открывает страницу с ценами Алматы.
            const usedCity = resolveCity(String(args.city));

            const result = runTool(call.function.name, args);
            const cards =
              call.function.name === "compute_course"
                ? courseCard(result)
                : cardsFrom(call.function.name, args, result, usedCity);
            for (const card of cards) send({ t: "card", v: card });

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
        send({
          t: "error",
          v: e instanceof Error ? e.message : "не удалось получить ответ",
        });
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
    messages: [
      { role: "system", content: VISION_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Прочитай назначение и верни позиции в JSON." },
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

function json(e: Event): Response {
  return new Response(JSON.stringify(e) + "\n", {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
