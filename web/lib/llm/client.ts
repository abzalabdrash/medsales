import { AllKeysExhausted, KeyPool, type KeyHealth } from "./keypool";
import { llmSettings, type LLMSettings } from "./config";

/**
 * Клиент к OpenAI-совместимому шлюзу с ротацией ключей и разбором ошибок.
 *
 * Две вещи здесь сделаны намеренно и менять их не надо.
 *
 * ВСЕГДА СТРИМИМ. Шлюз закрывает нестримовое соединение с 504 примерно через
 * 16-20 секунд. Любой ответ длиннее этого (разбор фото назначения, длинный
 * список аптек) другим способом просто не получить.
 *
 * ОШИБКИ РАЗДЕЛЕНЫ ПО ВИНЕ. 429 и 5xx это вина ключа или шлюза: уходим на
 * другой ключ. 400 это наш кривой запрос: другой ключ его не починит, а
 * ротация выкосила бы весь пул из-за нашей же ошибки, поэтому падаем сразу.
 */

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504, 529]);
const KEY_FATAL_STATUS = new Set([401, 402, 403]);

/**
 * Шлюзы по-разному сообщают о кончившихся деньгах: кто-то шлёт 402, кто-то
 * 429, кто-то 200 с текстом ошибки. Фразу считаем главнее кода.
 */
const KEY_FATAL_PHRASES = [
  "insufficient", "quota", "exceeded your current", "billing", "payment required",
  "no credit", "out of credit", "balance", "expired", "invalid api key",
  "incorrect api key", "revoked", "disabled",
];

function isKeyFatal(status: number, body: string): boolean {
  if (KEY_FATAL_STATUS.has(status)) return true;
  const low = body.toLowerCase();
  return KEY_FATAL_PHRASES.some((p) => low.includes(p));
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | unknown[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatChunk =
  | { kind: "text"; delta: string }
  | { kind: "tool_calls"; calls: ToolCall[] }
  | { kind: "done"; text: string; calls: ToolCall[] };

export class LLMError extends Error {}

let sharedPool: KeyPool | null = null;

function pool(settings: LLMSettings): KeyPool {
  if (!sharedPool) sharedPool = new KeyPool(settings.apiKeys);
  return sharedPool;
}

export function poolSnapshot() {
  return sharedPool?.snapshot() ?? [];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function backoffSleep(attempt: number, retryAfter?: string | null) {
  if (retryAfter) {
    const s = Number(retryAfter);
    if (Number.isFinite(s)) return sleep(Math.min(30000, s * 1000));
  }
  return sleep(Math.min(20000, 2 ** attempt * (500 + Math.random() * 500)));
}

/**
 * Один запрос к модели, поток кусками. Перебирает ключи, пока ответ не
 * доедет или не кончатся попытки.
 *
 * Отдаёт текст по мере поступления, а в конце — событие done с полным
 * текстом и собранными вызовами инструментов. Вызовы приходят по частям
 * (имя в одном куске, аргументы в следующих), поэтому собираются по индексу.
 */
export async function* streamChat(opts: {
  messages: ChatMessage[];
  tools?: unknown[];
  model?: string;
  reasoningEffort?: string;
  toolChoice?: "auto" | "none" | "required";
  signal?: AbortSignal;
}): AsyncGenerator<ChatChunk> {
  const settings = llmSettings();
  if (settings.apiKeys.length === 0) {
    throw new LLMError("API_KEYS не заданы: положите ключи в .env в корне репозитория");
  }
  const keys = pool(settings);
  const maxRetries = keys.size + 4;

  const payload: Record<string, unknown> = {
    model: opts.model || settings.model,
    messages: opts.messages,
    stream: true,
    stream_options: { include_usage: true },
    reasoning_effort: opts.reasoningEffort || settings.reasoningEffort,
  };
  if (opts.tools?.length) {
    payload.tools = opts.tools;
    payload.tool_choice = opts.toolChoice ?? "auto";
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let handle: KeyHealth;
    try {
      handle = await keys.acquire();
    } catch (e) {
      if (e instanceof AllKeysExhausted) throw new LLMError(e.message);
      throw e;
    }

    let text = "";
    const partial = new Map<number, ToolCall>();
    let usage = { prompt: 0, completion: 0 };
    let emitted = false;

    try {
      const res = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${handle.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: opts.signal ?? AbortSignal.timeout(settings.timeoutMs),
      });

      if (!res.ok || !res.body) {
        const body = (await res.text().catch(() => "")).slice(0, 400);
        lastError = new LLMError(`HTTP ${res.status}: ${body}`);

        if (isKeyFatal(res.status, body)) {
          keys.release(handle, { ok: false, penalise: false });
          keys.retire(handle, `HTTP ${res.status}: ${body.slice(0, 120)}`);
          if (keys.liveKeys === 0) {
            throw new LLMError(`все ключи выведены; последняя ошибка: ${body.slice(0, 200)}`);
          }
          continue;
        }
        const retryable = RETRYABLE_STATUS.has(res.status);
        keys.release(handle, {
          ok: false,
          penalise: retryable,
          rateLimited: TRANSIENT_STATUS.has(res.status),
        });
        if (!retryable) throw lastError;
        await backoffSleep(attempt, res.headers.get("retry-after"));
        continue;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const s = line.trim();
          if (!s.startsWith("data:")) continue;
          const raw = s.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(raw);
          } catch {
            continue; // кусок JSON разорван между чанками
          }

          const u = ev.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
          if (u) {
            usage = {
              prompt: u.prompt_tokens ?? 0,
              completion: u.completion_tokens ?? 0,
            };
          }

          const choices = (ev.choices ?? []) as {
            delta?: {
              content?: string;
              tool_calls?: {
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }[];
            };
          }[];
          for (const choice of choices) {
            const piece = choice.delta?.content;
            if (piece) {
              text += piece;
              emitted = true;
              yield { kind: "text", delta: piece };
            }
            for (const tc of choice.delta?.tool_calls ?? []) {
              const cur = partial.get(tc.index) ?? {
                id: "",
                type: "function" as const,
                function: { name: "", arguments: "" },
              };
              if (tc.id) cur.id = tc.id;
              if (tc.function?.name) cur.function.name += tc.function.name;
              if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
              partial.set(tc.index, cur);
              emitted = true;
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof LLMError) throw e;
      keys.release(handle, { ok: false, penalise: true, rateLimited: true });
      lastError = e instanceof Error ? e : new Error(String(e));
      await backoffSleep(attempt);
      continue;
    }

    if (!emitted) {
      // Поток, не отдавший ничего, это сбой, а не пустой ответ.
      keys.release(handle, { ok: false, penalise: true, rateLimited: true });
      lastError = new LLMError("поток закрылся без содержимого");
      await backoffSleep(attempt);
      continue;
    }

    keys.release(handle, {
      ok: true,
      promptTokens: usage.prompt,
      completionTokens: usage.completion,
    });

    const calls = [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => c)
      .filter((c) => c.function.name);
    if (calls.length > 0) yield { kind: "tool_calls", calls };
    yield { kind: "done", text, calls };
    return;
  }

  throw new LLMError(`исчерпаны ${maxRetries} попытки: ${lastError?.message ?? "неизвестно"}`);
}

/** Полный ответ одним куском. Внутри всё равно поток: шлюз иначе рвёт связь. */
export async function complete(opts: {
  messages: ChatMessage[];
  tools?: unknown[];
  model?: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; calls: ToolCall[] }> {
  for await (const chunk of streamChat(opts)) {
    if (chunk.kind === "done") return { text: chunk.text, calls: chunk.calls };
  }
  throw new LLMError("ответ не получен");
}

/** Разбор JSON, который мог приехать в markdown-заборе или с прозой вокруг. */
export function parseJsonLenient<T = unknown>(text: string): T {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.slice(t.indexOf("\n") + 1);
    if (t.trimEnd().endsWith("```")) t = t.trimEnd().slice(0, -3);
  }
  try {
    return JSON.parse(t) as T;
  } catch {
    // ищем крайние скобки
  }
  for (const [open, close] of [
    ["{", "}"],
    ["[", "]"],
  ]) {
    const start = t.indexOf(open);
    const end = t.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1)) as T;
      } catch {
        continue;
      }
    }
  }
  throw new LLMError(`ответ не является корректным JSON: ${text.slice(0, 200)}`);
}
