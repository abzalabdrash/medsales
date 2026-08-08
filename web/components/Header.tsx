"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { UserRound } from "lucide-react";
import { Logo } from "./Logo";
import { CityPicker } from "./CityPicker";
import { SearchBox } from "./SearchBox";
import { LangSwitcher } from "./LangSwitcher";
import { useI18n } from "./I18nProvider";
import { resolveCity } from "@/lib/cities";
import { withCity } from "@/lib/url";

function HeaderInner() {
  const pathname = usePathname();
  const { t } = useI18n();
  const city = resolveCity(useSearchParams().get("city"));
  const showSearch = pathname !== "/";

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-2.5 sm:px-6">
      <div className="flex items-center gap-2 sm:gap-3">
        <Logo />
        <Link
          href={withCity("/kliniki", city)}
          className="hidden shrink-0 text-sm font-medium text-muted transition-colors hover:text-ink sm:block"
        >
          {t.clinicsNav}
        </Link>
        <Link
          href={withCity("/lekarstva", city)}
          className="hidden shrink-0 text-sm font-medium text-muted transition-colors hover:text-ink sm:block"
        >
          Лекарства
        </Link>
        <Link
          href={withCity("/apteki", city)}
          className="hidden shrink-0 text-sm font-medium text-muted transition-colors hover:text-ink lg:block"
        >
          Аптеки
        </Link>
        {showSearch ? (
          <div className="hidden min-w-0 flex-1 sm:block">
            <SearchBox city={city} variant="compact" />
          </div>
        ) : null}
        <div className={showSearch ? "flex-1 sm:hidden" : "flex-1"} />
        <Link
          href={withCity("/kabinet", city)}
          aria-label={t.cabinetNav}
          title={t.cabinetNav}
          className="pressable grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <UserRound size={20} aria-hidden />
        </Link>
        <CityPicker city={city} />
        <LangSwitcher />
      </div>
      {showSearch && (
        <div className="mt-2 sm:hidden">
          <SearchBox city={city} variant="compact" />
        </div>
      )}
    </div>
  );
}

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur">
      <Suspense
        fallback={
          <div className="mx-auto h-[60px] w-full max-w-[1100px] px-4 sm:px-6" />
        }
      >
        <HeaderInner />
      </Suspense>
    </header>
  );
}
