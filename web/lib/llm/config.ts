import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Настройки доступа к модели. Шлюз OpenAI-совместимый, поэтому здесь нет
 * ничего, привязанного к конкретному вендору: подойдёт любой эндпоинт,
 * говорящий на /v1/chat/completions.
 */

export type LLMSettings = {
  apiKeys: string[];
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  timeoutMs: number;
};

/**
 * Ключи лежат в .env в корне репозитория, рядом с TWOGIS_KEYS, потому что их
 * использует и питоновская часть проекта. Next.js читает переменные только из
 * своей папки web/, поэтому корневой файл дочитываем вручную: держать один и
 * тот же секрет в двух файлах хуже, чем прочитать соседний.
 */
let rootEnvCache: Record<string, string> | null = null;

function rootEnv(): Record<string, string> {
  if (rootEnvCache) return rootEnvCache;
  const out: Record<string, string> = {};
  try {
    const raw = readFileSync(join(process.cwd(), "..", ".env"), "utf-8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      // Имя ключа чистим от кавычек: в корневом .env одна строка записана как
      // 'TWOGIS_KEYS=..., и без этого переменная не нашлась бы по имени.
      const name = trimmed.slice(0, eq).trim().replace(/^['"]|['"]$/g, "");
      out[name] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // корневого .env нет — работаем только с переменными окружения
  }
  rootEnvCache = out;
  return out;
}

function fromEnv(name: string): string {
  return process.env[name] || rootEnv()[name] || "";
}

export function llmSettings(): LLMSettings {
  return {
    apiKeys: fromEnv("API_KEYS")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
    baseUrl: fromEnv("LLM_BASE_URL") || "https://clodex.xyz/v1",
    model: fromEnv("LLM_MODEL") || "gpt-5.6-sol",
    reasoningEffort: fromEnv("LLM_REASONING_EFFORT") || "high",
    timeoutMs: Number(fromEnv("LLM_TIMEOUT_MS")) || 300000,
  };
}

export function llmConfigured(): boolean {
  return llmSettings().apiKeys.length > 0;
}
