import Link from "next/link";
import { resolveCity } from "@/lib/cities";
import { getBrandsInCity } from "@/lib/db";
import { tenge } from "@/lib/format";
import {
  getDict,
  cityNameL,
  clinicsTitle,
  clinicsLabel,
  branchesLabel,
  servicesLabel,
  fromPrice,
} from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { withCity } from "@/lib/url";
import { Avatar } from "@/components/Avatar";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Rating } from "@/components/Rating";
import { FavoriteButton } from "@/components/FavoriteButton";

export const dynamic = "force-dynamic";

export default async function ClinicsPage({
  searchParams,
}: {
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const city = resolveCity((await searchParams).city);
  const clinics = getBrandsInCity(city);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[
          { label: t.home, href: withCity("/", city) },
          { label: t.clinicsNav },
        ]}
      />
      <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
        {clinicsTitle(locale, cityNameL(locale, city))}
      </h1>
      <p className="mt-1 text-muted">{clinicsLabel(locale, clinics.length)}</p>

      {clinics.length > 0 ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {clinics.map((c) => {
            const facts = [servicesLabel(locale, c.services)];
            if (c.minPrice != null)
              facts.push(
                locale === "kk"
                  ? fromPrice(locale, tenge(c.minPrice))
                  : `${t.pricesFrom} ${tenge(c.minPrice)}`,
              );
            if (c.branches > 1) facts.push(branchesLabel(locale, c.branches));
            return (
              <div
                key={String(c.id)}
                className="relative flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-surface p-4 transition-colors hover:bg-surface-2"
              >
                <Link
                  href={withCity(`/klinika/${c.id}`, city)}
                  className="absolute inset-0 rounded-2xl"
                  aria-label={c.name}
                />
                <Avatar name={c.name} logo={c.logo} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h2 className="truncate font-semibold">{c.name}</h2>
                    <Rating value={c.rating} reviews={c.reviews} />
                  </div>
                  <p className="mt-1 text-sm text-muted">{facts.join(" · ")}</p>
                </div>
                <div className="relative z-10">
                  <FavoriteButton
                    fav={{ kind: "clinic", id: c.id, name: c.name, city }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-line bg-surface px-6 py-10 text-center text-muted">
          {t.noBranchesInCity}
        </div>
      )}
    </main>
  );
}
