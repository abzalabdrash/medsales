"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Star, Stethoscope, Building2, Bell, X } from "lucide-react";
import { resolveCity } from "@/lib/cities";
import { categoryLabel, cityNameL } from "@/lib/i18n";
import { withCity } from "@/lib/url";
import {
  useProfile,
  removeFavorite,
  removeWatch,
} from "@/lib/profile";
import { useI18n } from "@/components/I18nProvider";
import { AddressPicker } from "@/components/AddressPicker";

function FavoritesInner() {
  const { locale, t } = useI18n();
  const city = resolveCity(useSearchParams().get("city"));
  const { favorites, watches } = useProfile();

  const services = favorites.filter((f) => f.kind === "service");
  const clinics = favorites.filter((f) => f.kind === "clinic");
  const empty = favorites.length === 0 && watches.length === 0;

  return (
    <main className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-6">
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight sm:text-4xl">
        <Star size={28} aria-hidden className="fill-amber-400 text-amber-400" />
        {t.favoritesTitle}
      </h1>

      <div className="mt-5">
        <AddressPicker city={city} />
      </div>

      {empty ? (
        <p className="mt-6 rounded-2xl border border-line bg-surface px-6 py-10 text-center text-muted">
          {t.favoritesEmpty}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {services.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
                <Stethoscope size={18} aria-hidden /> {t.favServicesHead}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-line">
                {services.map((f, i) =>
                  f.kind === "service" ? (
                    <div
                      key={f.id}
                      className={`flex items-center gap-2 bg-surface ${
                        i > 0 ? "border-t border-line" : ""
                      }`}
                    >
                      <Link
                        href={withCity(`/usluga/${f.id}`, city)}
                        className="flex min-h-[56px] flex-1 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2"
                      >
                        <span className="min-w-0 truncate font-medium">
                          {f.name}
                        </span>
                        <span className="shrink-0 text-sm text-muted">
                          {categoryLabel(locale, f.category)}
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeFavorite("service", f.id)}
                        aria-label={t.removeFromFav}
                        className="pressable mr-2 grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-surface-2"
                      >
                        <X size={18} aria-hidden />
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            </section>
          )}

          {clinics.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
                <Building2 size={18} aria-hidden /> {t.favClinicsHead}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-line">
                {clinics.map((f, i) =>
                  f.kind === "clinic" ? (
                    <div
                      key={f.id}
                      className={`flex items-center gap-2 bg-surface ${
                        i > 0 ? "border-t border-line" : ""
                      }`}
                    >
                      <Link
                        href={withCity(`/klinika/${f.id}`, f.city)}
                        className="flex min-h-[56px] flex-1 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2"
                      >
                        <span className="min-w-0 truncate font-medium">
                          {f.name}
                        </span>
                        <span className="shrink-0 text-sm text-muted">
                          {cityNameL(locale, f.city)}
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeFavorite("clinic", f.id)}
                        aria-label={t.removeFromFav}
                        className="pressable mr-2 grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-surface-2"
                      >
                        <X size={18} aria-hidden />
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            </section>
          )}

          {watches.length > 0 && (
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
                <Bell size={18} aria-hidden /> {t.watchPrice}
              </h2>
              <div className="overflow-hidden rounded-2xl border border-line">
                {watches.map((w, i) => (
                  <div
                    key={`${w.kind}:${w.id}`}
                    className={`flex items-center gap-2 bg-surface ${
                      i > 0 ? "border-t border-line" : ""
                    }`}
                  >
                    <Link
                      href={withCity(
                        `/${w.kind === "service" ? "usluga" : "klinika"}/${w.id}`,
                        w.city,
                      )}
                      className="flex min-h-[56px] flex-1 items-center justify-between gap-3 px-4 py-3 hover:bg-surface-2"
                    >
                      <span className="min-w-0 truncate font-medium">
                        {w.label}
                      </span>
                      <span className="shrink-0 text-sm tabular-nums text-muted">
                        {w.phone}
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeWatch(w.kind, w.id)}
                      aria-label={t.removeFromFav}
                      className="pressable mr-2 grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-surface-2"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

export default function FavoritesPage() {
  return (
    <Suspense>
      <FavoritesInner />
    </Suspense>
  );
}
