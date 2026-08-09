import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Phone,
  Clock,
  MapPin,
  MessageCircle,
  ExternalLink,
  Star,
} from "lucide-react";
import { resolveCity } from "@/lib/cities";
import {
  getBrand,
  getBrandBranches,
  getBrandReviews,
  getBrandServices,
} from "@/lib/db";
import { tenge } from "@/lib/format";
import {
  getDict,
  categoryLabel,
  cityNameL,
  branchesLabel,
  servicesLabel,
  fromPrice,
  sourceLabel,
  clinicInOtherCity,
} from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";
import { withCity } from "@/lib/url";
import { telUrl, whatsappUrl, firmUrl, sourceHost, hasGeo } from "@/lib/maps";
import { Avatar } from "@/components/Avatar";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Rating } from "@/components/Rating";
import { Reviews } from "@/components/Reviews";
import { RouteMenu } from "@/components/RouteMenu";
import { LazyMap } from "@/components/LazyMap";
import { FavoriteButton } from "@/components/FavoriteButton";
import type { MapPoint } from "@/components/MapView";

export const dynamic = "force-dynamic";

const ORDER = ["laboratory", "diagnostics", "doctor_visit", "procedure"];

export default async function ClinicPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ city?: string }>;
}) {
  const locale = await getLocale();
  const t = getDict(locale);
  const { brandId } = await params;
  const city = resolveCity((await searchParams).city);
  const brand = getBrand(brandId);
  if (!brand) notFound();

  const branches = getBrandBranches(brandId, city);
  // The brand may have no branch in the selected city; show its real city honestly.
  const effectiveCity = branches[0]?.city ?? city;
  const inSelectedCity = effectiveCity === city;
  const services = getBrandServices(brandId, effectiveCity);
  const reviews = getBrandReviews(brandId);

  const points: MapPoint[] = branches
    .filter((b) => hasGeo(b))
    .map((b) => ({
      id: String(b.id),
      label: b.name || brand.name,
      lat: b.lat as number,
      lng: b.lng as number,
      address: b.address,
    }));

  const grouped = ORDER.map((cat) => ({
    cat,
    items: services.filter((s) => s.category === cat),
  })).filter((g) => g.items.length > 0);

  const priceFrom = services.length
    ? Math.min(...services.map((s) => s.price))
    : null;
  const reviewsUrl = firmUrl(effectiveCity, brand.name);
  const waText =
    locale === "kk"
      ? `Сәлеметсіз бе! MedSales сайтынан «${brand.name}» қызметтері бойынша жазып отырмын.`
      : `Здравствуйте! Пишу с сайта MedSales по поводу услуг в «${brand.name}».`;

  const btn =
    "pressable inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border border-line bg-paper px-3 text-sm font-medium";

  // Honest fact summary built from data — no invented marketing copy.
  const facts: string[] = [
    cityNameL(locale, effectiveCity),
    branchesLabel(locale, branches.length),
  ];
  if (services.length > 0) {
    facts.push(
      locale === "kk"
        ? `${t.inCatalog} ${servicesLabel(locale, services.length)}`
        : `${servicesLabel(locale, services.length)} ${t.inCatalog}`,
    );
  }
  if (priceFrom != null) {
    facts.push(
      locale === "kk"
        ? fromPrice(locale, tenge(priceFrom))
        : `${t.pricesFrom} ${tenge(priceFrom)}`,
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <Breadcrumbs
        locale={locale}
        items={[
          { label: t.home, href: withCity("/", city) },
          { label: brand.name },
        ]}
      />
      <div className="mt-3 flex items-start gap-4">
        <Avatar name={brand.name} logo={brand.logo} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                  {brand.name}
                </h1>
                {reviews.length > 0 ? (
                  <a
                    href="#reviews"
                    className="rounded-md transition-opacity hover:opacity-70"
                    aria-label={
                      locale === "kk" ? "Пікірлерге өту" : "К отзывам"
                    }
                  >
                    <Rating value={brand.rating} reviews={brand.reviews} />
                  </a>
                ) : (
                  <Rating value={brand.rating} reviews={brand.reviews} />
                )}
              </div>
              <p className="mt-1 text-muted">{facts.join(" · ")}</p>
            </div>
            <FavoriteButton
              fav={{
                kind: "clinic",
                id: brand.id,
                name: brand.name,
                city: effectiveCity,
              }}
            />
          </div>
          {!inSelectedCity && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-wash px-2.5 py-1 text-sm font-medium text-brand-ink">
              <MapPin size={15} aria-hidden />
              {clinicInOtherCity(locale, cityNameL(locale, effectiveCity))}
            </p>
          )}
        </div>
      </div>

      {brand.reviewSummary && (
        <p className="mt-3 max-w-[760px] rounded-xl bg-surface px-3.5 py-2.5 text-[15px] text-ink">
          <span className="font-medium text-muted">{t.rowSentiment}: </span>
          {brand.reviewSummary}
        </p>
      )}

      {brand.description && (
        <p className="mt-4 max-w-[760px] text-[17px] leading-relaxed text-ink">
          {brand.description}
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_minmax(340px,400px)]">
        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <h2 className="mb-3 text-lg font-semibold">{t.branches}</h2>
            {branches.length > 0 ? (
              <div className="flex flex-col gap-3">
                {branches.map((b) => {
                  const wa = whatsappUrl(b.phone, waText);
                  const host = sourceHost(b.sourceUrl);
                  const is2gis = b.sourceUrl
                    ? /2gis\./i.test(b.sourceUrl)
                    : false;
                  return (
                    <div
                      key={String(b.id)}
                      className="rounded-2xl border border-line bg-surface p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="font-semibold">
                          {b.name || brand.name}
                        </h3>
                        <Rating value={b.rating} reviews={b.reviews} />
                      </div>
                      {b.address && (
                        <p className="mt-1 flex items-start gap-1.5 text-muted">
                          <MapPin
                            size={18}
                            className="mt-0.5 shrink-0"
                            aria-hidden
                          />{" "}
                          {b.address}
                        </p>
                      )}
                      {b.workingHours && (
                        <p className="mt-1 flex items-center gap-1.5 text-muted">
                          <Clock size={18} className="shrink-0" aria-hidden />{" "}
                          {b.workingHours}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {hasGeo(b) && (
                          <RouteMenu
                            city={city}
                            lat={b.lat}
                            lng={b.lng}
                            label={t.route}
                            className={btn}
                          />
                        )}
                        {b.phone && (
                          <a href={telUrl(b.phone)} className={btn}>
                            <Phone size={18} aria-hidden /> {b.phone}
                          </a>
                        )}
                        {wa && (
                          <a
                            href={wa}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={btn}
                          >
                            <MessageCircle size={18} aria-hidden /> {t.write}
                          </a>
                        )}
                        {b.sourceUrl && !is2gis && (
                          <a
                            href={b.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={btn}
                          >
                            <ExternalLink size={18} aria-hidden />{" "}
                            {host ? sourceLabel(locale, host) : t.sourceShort}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted">{t.noBranchesInCity}</p>
            )}
          </section>

          {grouped.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-semibold">
                {t.servicesAndPrices}
              </h2>
              <div className="flex flex-col gap-5">
                {grouped.map((g) => (
                  <div key={g.cat}>
                    <h3 className="mb-2 text-sm font-medium text-muted">
                      {categoryLabel(locale, g.cat)}
                    </h3>
                    <div className="overflow-hidden rounded-2xl border border-line">
                      {g.items.map((s, i) => (
                        <div
                          key={String(s.id)}
                          className={`relative flex min-h-[56px] items-center gap-2 bg-surface px-4 py-3 hover:bg-surface-2 ${
                            i > 0 ? "border-t border-line" : ""
                          }`}
                        >
                          <Link
                            href={withCity(`/usluga/${s.id}`, city)}
                            className="absolute inset-0"
                            aria-label={s.name}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {s.name}
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums text-brand-ink">
                            {tenge(s.price)}
                          </span>
                          <div className="relative z-10">
                            <FavoriteButton
                              variant="compact"
                              size={18}
                              fav={{
                                kind: "offer",
                                clinicId: brand.id,
                                clinicName: brand.name,
                                serviceId: s.id,
                                serviceName: s.name,
                                city: effectiveCity,
                                price: s.price,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="hidden lg:block">
          {points.length > 0 ? (
            <div className="sticky top-20">
              <LazyMap points={points} height={520} />
            </div>
          ) : (
            <div className="sticky top-20 rounded-2xl border border-line bg-surface p-6 text-center text-muted">
              {t.noMapPoints}
            </div>
          )}
        </aside>
      </div>

      {points.length > 0 && (
        <div className="mt-5 lg:hidden">
          <h2 className="mb-3 text-lg font-semibold">{t.onMapSection}</h2>
          <LazyMap points={points} />
        </div>
      )}

      {reviews.length > 0 && (
        <section id="reviews" className="mt-8 scroll-mt-20">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              {locale === "kk" ? "Пікірлер" : "Отзывы"}{" "}
              <span className="font-normal text-muted">{reviews.length}</span>
            </h2>
            <a
              href={reviewsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-ink"
            >
              <Star size={16} aria-hidden /> {t.reviewsOn2gis}
              <ExternalLink size={14} aria-hidden />
            </a>
          </div>
          <div className="max-w-[820px]">
            <Reviews reviews={reviews} locale={locale} />
          </div>
        </section>
      )}
    </main>
  );
}
