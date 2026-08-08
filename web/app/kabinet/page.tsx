"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Stethoscope,
  Building2,
  Bell,
  X,
  LogOut,
  UserRound,
} from "lucide-react";
import { resolveCity } from "@/lib/cities";
import { cityNameL } from "@/lib/i18n";
import { tenge } from "@/lib/format";
import { withCity } from "@/lib/url";
import { useProfile, removeFavorite, removeWatch, favKey } from "@/lib/profile";
import { useAuth, logout } from "@/lib/auth";
import { useI18n } from "@/components/I18nProvider";
import { AuthForm } from "@/components/AuthForm";
import { AddressPicker } from "@/components/AddressPicker";

function CabinetInner() {
  const { locale, t } = useI18n();
  const city = resolveCity(useSearchParams().get("city"));
  const { user, loading } = useAuth();
  const { favorites, watches } = useProfile();

  const offers = favorites.filter((f) => f.kind === "offer");
  const clinics = favorites.filter((f) => f.kind === "clinic");

  return (
    <main className="mx-auto w-full max-w-[820px] px-4 py-6 sm:px-6">
      <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight sm:text-4xl">
        <UserRound size={28} aria-hidden className="text-brand-ink" />
        {t.cabinetTitle}
      </h1>

      <div className="mt-5">
        {loading ? (
          <div className="skeleton h-24 rounded-2xl" />
        ) : user ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
            <span className="font-medium">
              {t.authLoggedAs}{" "}
              <span className="tabular-nums text-brand-ink">+{user.phone}</span>
            </span>
            <button
              type="button"
              onClick={() => logout()}
              className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-paper px-3 text-sm font-medium"
            >
              <LogOut size={18} aria-hidden /> {t.authLogout}
            </button>
          </div>
        ) : (
          <AuthForm />
        )}
      </div>

      {user && (
        <>
          <div className="mt-6 flex flex-col gap-6">
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
                <Stethoscope size={18} aria-hidden /> {t.myServicesHead}
              </h2>
              {offers.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-line">
                  {offers.map((f, i) =>
                    f.kind === "offer" ? (
                      <div
                        key={favKey(f)}
                        className={`relative flex items-center gap-2 bg-surface ${
                          i > 0 ? "border-t border-line" : ""
                        }`}
                      >
                        <Link
                          href={withCity(`/usluga/${f.serviceId}`, f.city)}
                          className="flex min-h-[60px] flex-1 flex-col justify-center px-4 py-2.5 hover:bg-surface-2"
                        >
                          <span className="truncate font-medium">
                            {f.serviceName}
                          </span>
                          <span className="truncate text-sm text-muted">
                            {f.clinicName}
                            {f.price != null ? ` · ${tenge(f.price)}` : ""}
                          </span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => removeFavorite(favKey(f))}
                          aria-label={t.removeFromFav}
                          className="pressable mr-2 grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-surface-2"
                        >
                          <X size={18} aria-hidden />
                        </button>
                      </div>
                    ) : null,
                  )}
                </div>
              ) : (
                <p className="rounded-2xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
                  {t.favoritesEmpty}
                </p>
              )}
            </section>

            {clinics.length > 0 && (
              <section>
                <h2 className="mb-2 flex items-center gap-1.5 text-lg font-semibold">
                  <Building2 size={18} aria-hidden /> {t.favClinicsHead}
                </h2>
                <div className="overflow-hidden rounded-2xl border border-line">
                  {clinics.map((f, i) =>
                    f.kind === "clinic" ? (
                      <div
                        key={favKey(f)}
                        className={`relative flex items-center gap-2 bg-surface ${
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
                          onClick={() => removeFavorite(favKey(f))}
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
                      key={`${w.clinicId}:${w.serviceId}`}
                      className={`relative flex items-center gap-2 bg-surface ${
                        i > 0 ? "border-t border-line" : ""
                      }`}
                    >
                      <Link
                        href={withCity(`/usluga/${w.serviceId}`, w.city)}
                        className="flex min-h-[60px] flex-1 flex-col justify-center px-4 py-2.5 hover:bg-surface-2"
                      >
                        <span className="truncate font-medium">
                          {w.serviceName}
                        </span>
                        <span className="truncate text-sm text-muted">
                          {w.clinicName}
                          {w.price != null ? ` · ${tenge(w.price)}` : ""}
                        </span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => removeWatch(w.clinicId, w.serviceId)}
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
          <div className="mt-6">
            <AddressPicker city={city} />
          </div>
        </>
      )}
    </main>
  );
}

export default function CabinetPage() {
  return (
    <Suspense>
      <CabinetInner />
    </Suspense>
  );
}
