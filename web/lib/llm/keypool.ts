/**
 * Пул из нескольких API-ключей с учётом здоровья каждого.
 *
 * Порт проверенного пула из проекта halyk. Смысл не в том, чтобы сложить
 * квоты, а в том, чтобы один упавший ключ не останавливал работу: ключ,
 * поймавший 429 или отдавший ошибку, уходит в остывание, а остальные
 * продолжают отвечать.
 *
 * Выбор ключа: наименее загруженный из живых. Так запросы расходятся ровно,
 * и знать настоящие лимиты провайдера для этого не нужно.
 */

export type KeyHealth = {
  key: string;
  label: string;
  inFlight: number;
  totalRequests: number;
  totalFailures: number;
  consecutiveFailures: number;
  rateLimitHits: number;
  promptTokens: number;
  completionTokens: number;
  cooldownUntil: number;
  retired: boolean;
  retiredReason: string;
};

export class AllKeysExhausted extends Error {}

const BASE_COOLDOWN_MS = 2000;
const MAX_COOLDOWN_MS = 60000;

/**
 * После стольких подряд идущих ошибок ключ выводится из ротации навсегда.
 * Ключи куплены с разным балансом, и то что один кончится посреди работы это
 * ожидаемо: нужно его сбросить и продолжить, а не бить в него бесконечно.
 */
const MAX_CONSECUTIVE_FAILURES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class KeyPool {
  private keys: KeyHealth[];

  constructor(keys: string[]) {
    if (keys.length === 0) throw new Error("KeyPool: нужен хотя бы один ключ");
    this.keys = keys.map((key, i) => ({
      key,
      label: `key${i + 1}`,
      inFlight: 0,
      totalRequests: 0,
      totalFailures: 0,
      consecutiveFailures: 0,
      rateLimitHits: 0,
      promptTokens: 0,
      completionTokens: 0,
      cooldownUntil: 0,
      retired: false,
      retiredReason: "",
    }));
  }

  get size(): number {
    return this.keys.length;
  }

  get liveKeys(): number {
    return this.keys.filter((k) => !k.retired).length;
  }

  /**
   * Взять наименее загруженный живой ключ. Если все остывают, ждём до
   * waitMs: короткий общий 429 у провайдера обычное дело, его стоит переждать.
   */
  async acquire(waitMs = 30000): Promise<KeyHealth> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const now = Date.now();
      const healthy = this.keys.filter((k) => !k.retired && now >= k.cooldownUntil);
      if (healthy.length > 0) {
        healthy.sort((a, b) =>
          a.inFlight !== b.inFlight
            ? a.inFlight - b.inFlight
            : a.totalRequests - b.totalRequests,
        );
        const chosen = healthy[0];
        chosen.inFlight += 1;
        chosen.totalRequests += 1;
        return chosen;
      }

      const live = this.keys.filter((k) => !k.retired);
      if (live.length === 0) {
        const reasons = this.keys.map((k) => `${k.label}: ${k.retiredReason}`).join(", ");
        throw new AllKeysExhausted(`все ключи выведены из ротации (${reasons})`);
      }
      const soonest = Math.min(...live.map((k) => k.cooldownUntil));
      if (Date.now() >= deadline) {
        throw new AllKeysExhausted(
          `${live.length} живых ключей, все остывают ещё ${Math.max(0, soonest - Date.now())} мс`,
        );
      }
      await sleep(Math.min(500, Math.max(50, soonest - Date.now())));
    }
  }

  /** Вывести ключ из ротации навсегда: кончился баланс, отозван, не принят. */
  retire(handle: KeyHealth, reason: string): void {
    if (!handle.retired) {
      handle.retired = true;
      handle.retiredReason = reason;
      console.warn(`[keypool] вывожу ${handle.label} из ротации: ${reason}`);
    }
  }

  /**
   * Вернуть ключ в пул и записать исход.
   *
   * penalise отмечает ошибки, в которых виноват ключ (429, 5xx), в отличие от
   * наших собственных (кривой запрос): последние не должны выбивать здоровый
   * ключ из ротации.
   *
   * rateLimited сужает это ещё сильнее: 429 даёт остывание, но никогда не
   * ведёт к выводу ключа. Здоровый ключ может поймать четыре 429 в одном
   * всплеске, и вывод по ним выкосил бы весь пул ровно тогда, когда нужна
   * пропускная способность.
   */
  release(
    handle: KeyHealth,
    opts: {
      ok: boolean;
      promptTokens?: number;
      completionTokens?: number;
      penalise?: boolean;
      rateLimited?: boolean;
    },
  ): void {
    handle.inFlight = Math.max(0, handle.inFlight - 1);
    handle.promptTokens += opts.promptTokens ?? 0;
    handle.completionTokens += opts.completionTokens ?? 0;

    if (opts.ok) {
      handle.consecutiveFailures = 0;
      handle.rateLimitHits = 0;
      return;
    }
    handle.totalFailures += 1;
    if (!opts.penalise) return;

    if (opts.rateLimited) {
      handle.rateLimitHits += 1;
      handle.cooldownUntil = Date.now() + backoff(handle.rateLimitHits);
      return;
    }
    handle.consecutiveFailures += 1;
    if (handle.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      this.retire(handle, `${handle.consecutiveFailures} ошибки подряд`);
      return;
    }
    handle.cooldownUntil = Date.now() + backoff(handle.consecutiveFailures);
  }

  /** Состояние пула для логов. Сами ключи наружу не отдаём никогда. */
  snapshot() {
    const now = Date.now();
    return this.keys.map((k) => ({
      label: k.label,
      requests: k.totalRequests,
      failures: k.totalFailures,
      promptTokens: k.promptTokens,
      completionTokens: k.completionTokens,
      coolingDown: !k.retired && now < k.cooldownUntil,
      retired: k.retired,
      retiredReason: k.retiredReason,
    }));
  }
}

/**
 * Рост паузы с разбросом. Потолок применяется ПОСЛЕ разброса: иначе
 * заявленный максимум перестал бы быть максимумом.
 */
function backoff(attempt: number): number {
  const base = BASE_COOLDOWN_MS * 2 ** Math.min(Math.max(attempt - 1, 0), 6);
  return Math.min(MAX_COOLDOWN_MS, base * (0.5 + Math.random()));
}
