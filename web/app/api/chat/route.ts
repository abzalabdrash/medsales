import { streamGemini, geminiConfigured, type ChatTurn } from "@/lib/gemini";
import { retrieveContext } from "@/lib/chat-context";
import { resolveCity } from "@/lib/cities";
import type { Coords } from "@/lib/picks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  messages?: ChatTurn[];
  city?: string;
  coords?: Coords | null;
  locale?: string;
};

function buildSystem(locale: string, city: string, context: string): string {
  const lang = locale === "kk" ? "казахском" : "русском";
  return `Ты — ИИ-помощник MedPrice.kz по подбору медицинских услуг в Казахстане.
ПРАВИЛА:
- Отвечай на ${lang} языке, кратко и по делу, без воды и без фраз вроде «как ИИ».
- Цены и клиники бери ТОЛЬКО из блока ДАННЫЕ MEDPRICE ниже. Никогда не выдумывай цены и клиники. Если данных нет — честно скажи и предложи другой город или услугу.
- Всегда называй конкретную цену и клинику и давай ссылку в формате [Название](/klinika/ID?city=${city}) или [Услуга](/usluga/ID?city=${city}) — ровно как в данных.
- НИКОГДА не придумывай ссылки, ID или категории. Используй ТОЛЬКО ссылки, которые буквально присутствуют в блоке ДАННЫЕ ниже. Не давай ссылок на категории.
- Рекомендуй ОПТИМАЛЬНЫЙ выбор по цене и качеству (цена + отзывы; если есть расстояние — учитывай близость), затем 1–2 альтернативы (самый дешёвый / ближайший). Коротко объясни почему.
- Общие медицинские вопросы можно дополнить веб-поиском, но помечай это как «из интернета» и отделяй от цен из нашей базы.
- Не ставь диагнозов и не назначай лечение; при тревожных симптомах советуй обратиться к врачу.
- Если спрашивают общую категорию (МРТ, УЗИ, анализ крови) и в данных есть НЕСКОЛЬКО подходящих услуг — перечисли доступные варианты с ценой и клиникой. НЕ отвечай «нет данных», если есть хотя бы что-то. Не переспрашивай подтип, если можешь сразу показать варианты.
- Если пользователь указал ориентир или адрес (например «рядом с Есентаем») — расстояния в данных уже посчитаны от его местоположения; просто выбери ближайшие клиники. Не выдумывай адреса, которых нет в данных.
- Если спрашивают про КЛИНИКУ/поликлинику/лабораторию, «лучшую» клинику, рейтинг или отзывы — отвечай из блока КЛИНИКИ ниже: называй конкретные клиники с рейтингом, числом отзывов и кратким резюме отзывов, по убыванию рейтинга. НИКОГДА не говори, что у нас нет рейтингов или отзывов, если в блоке КЛИНИКИ есть данные, и не подменяй наши данные общими советами из интернета.
- «Лучшая» клиника = высокий рейтинг при заметном числе отзывов; кратко поясни выбор и при возможности дай 1–2 альтернативы со ссылками из данных.

ДАННЫЕ MEDPRICE (актуальный контекст):
${context || "нет данных"}`;
}

export async function POST(req: Request) {
  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const messages = (payload.messages ?? []).slice(-8);
  const city = resolveCity(payload.city);
  const coords = payload.coords ?? null;
  const locale = payload.locale === "kk" ? "kk" : "ru";
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const userText = lastUser?.content ?? "";

  let context = "";
  try {
    context = retrieveContext(userText, city, coords);
  } catch {
    context = "";
  }
  const system = buildSystem(locale, city, context);

  const enc = new TextEncoder();

  if (!geminiConfigured()) {
    const msg =
      locale === "kk"
        ? "ИИ-көмекші әзірге қосылмаған (Vertex AI қосылмаған). Жоғарыдағы қызмет іздеуді пайдаланыңыз."
        : "ИИ-помощник пока не подключён (нет доступа к Vertex AI). Воспользуйтесь поиском по услугам выше.";
    return new Response(enc.encode(msg), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const fallback =
    locale === "kk"
      ? "\n\n⚠️ Қазір жауап бере алмадым. Жоғарыдағы қызмет іздеуді пайдаланыңыз."
      : "\n\n⚠️ Не смог ответить сейчас. Воспользуйтесь поиском по услугам выше.";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let emitted = false;
      const run = async (useSearch: boolean) => {
        for await (const delta of streamGemini({
          system,
          messages,
          useSearch,
        })) {
          emitted = true;
          controller.enqueue(enc.encode(delta));
        }
      };
      try {
        await run(true);
      } catch {
        // grounding/model hiccup — retry once without web search if nothing sent
        if (!emitted) {
          try {
            await run(false);
          } catch {
            if (!emitted) controller.enqueue(enc.encode(fallback));
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
