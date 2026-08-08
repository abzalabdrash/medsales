"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MapPin, Check, ChevronDown } from "lucide-react";
import { CITIES } from "@/lib/cities";
import { cityNameL, cityChangeLabel } from "@/lib/i18n";
import { useI18n } from "./I18nProvider";

export function CityPicker({ city }: { city: string }) {
  const { locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(slug: string) {
    const next = new URLSearchParams(params.toString());
    next.set("city", slug);
    setOpen(false);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="pressable flex min-h-[48px] items-center gap-1.5 rounded-xl border border-line bg-paper px-3 font-medium"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={cityChangeLabel(locale, cityNameL(locale, city))}
      >
        <MapPin
          size={20}
          strokeWidth={2}
          className="text-brand-ink"
          aria-hidden
        />
        <span className="max-w-[120px] truncate">
          {cityNameL(locale, city)}
        </span>
        <ChevronDown
          size={18}
          strokeWidth={2}
          className="text-muted"
          aria-hidden
        />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t.chooseCity}
          className="absolute right-0 z-50 mt-2 max-h-[60vh] w-60 overflow-auto rounded-2xl border border-line bg-paper p-1.5 shadow-xl shadow-ink/5"
        >
          {CITIES.map((c) => {
            const active = c.slug === city;
            return (
              <button
                key={c.slug}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(c.slug)}
                className="pressable flex min-h-[48px] w-full items-center justify-between rounded-xl px-3 text-left"
              >
                <span>{cityNameL(locale, c.slug)}</span>
                {active && (
                  <Check size={18} className="text-brand-ink" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
