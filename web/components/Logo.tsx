"use client";

import Link from "next/link";
import { useI18n } from "./I18nProvider";

/**
 * Логотип: пин с медицинским крестом.
 *
 * Пин, а не пульс — потому что продукт про то, КУДА идти за лечением и во
 * сколько это обойдётся, а не про мониторинг здоровья. Нарисован разметкой,
 * а не картинкой: остаётся резким на любом экране, красится через
 * currentColor и не тянет лишний запрос.
 */
export function Logo() {
  const { t } = useI18n();
  return (
    <Link
      href="/"
      className="pressable flex shrink-0 items-center gap-2 rounded-lg px-1 py-1"
      aria-label={t.logoAria}
    >
      <span className="grid size-8 place-items-center rounded-xl bg-brand text-white">
        <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 2.6c-4.03 0-7.3 3.24-7.3 7.24 0 5.11 6.35 11 6.62 11.25a1 1 0 0 0 1.36 0c.27-.25 6.62-6.14 6.62-11.25 0-4-3.27-7.24-7.3-7.24Z"
            fill="currentColor"
          />
          <path
            d="M10.9 5.9h2.2a.6.6 0 0 1 .6.6v2h2a.6.6 0 0 1 .6.6v2.2a.6.6 0 0 1-.6.6h-2v2a.6.6 0 0 1-.6.6h-2.2a.6.6 0 0 1-.6-.6v-2h-2a.6.6 0 0 1-.6-.6V9.1a.6.6 0 0 1 .6-.6h2v-2a.6.6 0 0 1 .6-.6Z"
            fill="var(--color-brand)"
          />
        </svg>
      </span>
      <span className="hidden text-xl font-bold tracking-tight sm:inline">
        MedSales
      </span>
    </Link>
  );
}
