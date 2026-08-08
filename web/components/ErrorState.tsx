"use client";

import { TriangleAlert, RotateCw } from "lucide-react";
import { useI18n } from "./I18nProvider";

export function ErrorState({ reset }: { reset?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-brand-wash text-brand-ink">
        <TriangleAlert size={28} aria-hidden />
      </span>
      <h2 className="text-xl font-semibold">{t.errorTitle}</h2>
      <p className="text-muted">{t.errorHint}</p>
      {reset && (
        <button
          type="button"
          onClick={reset}
          className="pressable inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-brand px-5 font-semibold text-white"
        >
          <RotateCw size={20} aria-hidden /> {t.retry}
        </button>
      )}
    </div>
  );
}
