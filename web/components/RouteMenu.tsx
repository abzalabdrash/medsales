"use client";

import { useEffect, useRef, useState } from "react";
import { Navigation, ChevronDown } from "lucide-react";
import { routeUrl, yandexRouteUrl } from "@/lib/maps";

// "Маршрут" button that opens a small menu to pick the maps app (2GIS / Yandex).
// Both are deep links — no API key, opens the app or web with a route to the point.
export function RouteMenu({
  city,
  lat,
  lng,
  label,
  className = "",
}: {
  city: string;
  lat: number;
  lng: number;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "flex min-h-[48px] items-center rounded-lg px-3 text-sm font-medium hover:bg-surface-2";

  return (
    <div ref={ref} className="relative z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        <Navigation size={18} aria-hidden /> {label}
        <ChevronDown size={16} aria-hidden className="opacity-60" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 min-w-[190px] rounded-xl border border-line bg-paper p-1 shadow-lg"
        >
          <a
            role="menuitem"
            href={routeUrl(city, lat, lng)}
            target="_blank"
            rel="noopener noreferrer"
            className={item}
            onClick={() => setOpen(false)}
          >
            2ГИС
          </a>
          <a
            role="menuitem"
            href={yandexRouteUrl(lat, lng)}
            target="_blank"
            rel="noopener noreferrer"
            className={item}
            onClick={() => setOpen(false)}
          >
            Яндекс Карты
          </a>
        </div>
      )}
    </div>
  );
}
