"use client";

import Link from "next/link";
import { useI18n } from "./I18nProvider";

export function Logo() {
  const { t } = useI18n();
  return (
    <Link
      href="/"
      className="pressable flex shrink-0 items-center gap-2 rounded-lg px-1 py-1"
      aria-label={t.logoAria}
    >
      <span className="grid size-8 place-items-center rounded-lg bg-brand text-white">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 12h3l2 5 4-13 2 8h7"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="hidden text-xl font-bold tracking-tight sm:inline">
        MedPrice<span className="text-muted">.kz</span>
      </span>
    </Link>
  );
}
