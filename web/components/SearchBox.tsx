"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { ServiceHit } from "@/lib/db";
import { categoryLabel } from "@/lib/i18n";
import { withCity } from "@/lib/url";
import { useI18n } from "./I18nProvider";

type Props = {
  city: string;
  variant?: "hero" | "compact";
  initialPopular?: ServiceHit[];
};

export function SearchBox({
  city,
  variant = "hero",
  initialPopular = [],
}: Props) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ServiceHit[]>([]);
  const [popular, setPopular] = useState<ServiceHit[]>(initialPopular);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hero = variant === "hero";
  const typing = q.trim().length >= 2;
  const list = typing ? items : popular;

  useEffect(() => {
    if (!open || popular.length || typing) return;
    let alive = true;
    fetch(`/api/popular?city=${encodeURIComponent(city)}`)
      .then((r) => r.json())
      .then((d) => {
        if (alive) setPopular(d.items ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, city, popular.length, typing]);

  useEffect(() => {
    if (!typing) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch(`/api/suggest?q=${encodeURIComponent(q.trim())}`)
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 150);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, typing]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function go(hit: ServiceHit) {
    setOpen(false);
    router.push(withCity(`/usluga/${hit.id}`, city));
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const pick = list[active] ?? list[0];
      if (pick) go(pick);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div
        className={`search-field flex items-center gap-2 rounded-2xl border border-line bg-paper focus-within:border-brand ${
          hero ? "px-4 shadow-sm" : "px-3"
        }`}
      >
        <Search
          size={hero ? 24 : 20}
          strokeWidth={2}
          className="shrink-0 text-muted"
          aria-hidden
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          // В шапке поле узкое, и длинная подсказка обрывается на полуслове
          // («…приём врача ил»). Короткий вариант помещается целиком.
          placeholder={hero ? t.searchPlaceholder : t.searchPlaceholderShort}
          aria-label={t.searchAria}
          role="combobox"
          aria-expanded={open}
          aria-controls="search-list"
          aria-autocomplete="list"
          className={`w-full bg-transparent outline-none focus:outline-none focus-visible:outline-none placeholder:text-muted ${
            hero ? "h-14 text-lg" : "h-12"
          }`}
        />
        {q && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setItems([]);
              setActive(-1);
            }}
            aria-label={t.clear}
            className="pressable grid size-9 shrink-0 place-items-center rounded-lg text-muted"
          >
            <X size={20} aria-hidden />
          </button>
        )}
      </div>

      {open && (
        <>
          {/* Ловит клик мимо подсказок, чтобы закрыть их. Раньше слой ещё и
              затемнял страницу — при каждом клике в поиск всё уходило в тень,
              хотя пользователь просто собирался печатать. Прозрачный слой
              делает ровно то, что нужно, и ничего сверх того. */}
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            id="search-list"
            role="listbox"
            className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-paper shadow-xl shadow-ink/10"
          >
            {!typing && popular.length > 0 && (
              <p className="px-4 pt-3 text-sm font-medium text-muted">
                {t.popular}
              </p>
            )}
            <ul className="max-h-[60vh] overflow-auto p-1.5">
              {list.map((hit, i) => (
                <li key={String(hit.id)}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(hit)}
                    className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl px-3 text-left ${
                      i === active ? "bg-surface-2" : ""
                    }`}
                  >
                    <span className="truncate">{hit.name}</span>
                    <span className="shrink-0 text-sm text-muted">
                      {categoryLabel(locale, hit.category)}
                    </span>
                  </button>
                </li>
              ))}
              {typing && !loading && list.length === 0 && (
                <li className="px-4 py-6 text-center text-muted">
                  {t.nothingFound}
                </li>
              )}
              {typing && loading && list.length === 0 && (
                <li className="px-4 py-4 text-center text-muted">
                  {t.searching}
                </li>
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
