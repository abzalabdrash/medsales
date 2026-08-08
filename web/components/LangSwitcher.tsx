"use client";

import { useRouter } from "next/navigation";
import { type Locale } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

const OPTIONS: { code: Locale; short: string }[] = [
  { code: "ru", short: "RU" },
  { code: "kk", short: "ҚАЗ" },
];

export function LangSwitcher() {
  const { locale } = useI18n();
  const router = useRouter();

  function set(code: Locale) {
    if (code === locale) return;
    document.cookie = `lang=${code}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <div
      className="flex shrink-0 items-center rounded-xl border border-line bg-paper p-0.5"
      role="group"
      aria-label="Язык / Тіл"
    >
      {OPTIONS.map((o) => (
        <button
          key={o.code}
          type="button"
          onClick={() => set(o.code)}
          aria-pressed={o.code === locale}
          className={`pressable min-h-[40px] rounded-lg px-2.5 text-sm font-semibold ${
            o.code === locale ? "bg-brand-wash text-brand-ink" : "text-muted"
          }`}
        >
          {o.short}
        </button>
      ))}
    </div>
  );
}
