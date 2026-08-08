"use client";

import { useState } from "react";
import { MapPin, Check, X, Search, LocateFixed } from "lucide-react";
import { useProfile, setAddress } from "@/lib/profile";
import { cityName } from "@/lib/cities";
import { useI18n } from "./I18nProvider";

// Geocode a typed address via Nominatim (OpenStreetMap, no API key) and save the
// coordinates to localStorage. Used as the fallback location for the "closest"
// pick when the browser doesn't grant geolocation.
export function AddressPicker({ city }: { city: string }) {
  const { t } = useI18n();
  const profile = useProfile();
  const saved = profile.address;
  const [q, setQ] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "notfound" | "denied">(
    "idle",
  );

  // "Поделиться" — use the browser's current geolocation as the saved address.
  function share() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("denied");
      return;
    }
    setState("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAddress({
          label: t.shareLocation,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        setState("idle");
      },
      () => setState("denied"),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  async function find() {
    const query = q.trim();
    if (query.length < 3) return;
    setState("loading");
    try {
      const full = `${query}, ${cityName(city)}, Казахстан`;
      const url =
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=kz&q=" +
        encodeURIComponent(full);
      const res = await fetch(url, {
        headers: { "Accept-Language": "ru" },
      });
      const data = (await res.json()) as {
        lat: string;
        lon: string;
        display_name: string;
      }[];
      if (!data.length) {
        setState("notfound");
        return;
      }
      const hit = data[0];
      setAddress({
        label: query,
        lat: Number(hit.lat),
        lng: Number(hit.lon),
      });
      setQ("");
      setState("idle");
    } catch {
      setState("notfound");
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-1 inline-flex items-center gap-1.5 text-lg font-semibold">
        <MapPin size={20} aria-hidden className="text-brand-ink" />
        {t.addressTitle}
      </h2>
      <p className="mb-3 text-sm text-muted">{t.addressHint}</p>

      {saved ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-brand-wash px-3 py-2 text-sm font-medium text-brand-ink">
            <Check size={16} aria-hidden /> {saved.label}
          </span>
          <button
            type="button"
            onClick={() => setAddress(null)}
            className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-paper px-3 text-sm font-medium"
          >
            <X size={16} aria-hidden /> {t.addressClear}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setState("idle");
              }}
              onKeyDown={(e) => e.key === "Enter" && find()}
              placeholder={t.addressPlaceholder}
              aria-label={t.addressTitle}
              className="min-h-[48px] flex-1 rounded-xl border border-line bg-paper px-3 text-base"
            />
            <button
              type="button"
              onClick={find}
              disabled={state === "loading" || q.trim().length < 3}
              className="pressable inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl bg-brand px-4 font-semibold text-white disabled:opacity-40"
            >
              <Search size={18} aria-hidden />
              {state === "loading" ? t.addressSaving : t.addressFind}
            </button>
          </div>
          <button
            type="button"
            onClick={share}
            className="pressable mt-2 inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-line bg-paper px-3 text-sm font-medium"
          >
            <LocateFixed size={18} aria-hidden className="text-brand-ink" />
            {t.shareLocation}
          </button>
          {state === "notfound" && (
            <p className="mt-2 text-sm text-brand-ink">{t.addressNotFound}</p>
          )}
          {state === "denied" && (
            <p className="mt-2 text-sm text-brand-ink">{t.locationDenied}</p>
          )}
        </>
      )}
    </div>
  );
}
