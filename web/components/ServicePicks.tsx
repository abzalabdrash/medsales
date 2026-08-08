"use client";

import Link from "next/link";
import { Wallet, Navigation, Award, Star, LocateFixed } from "lucide-react";
import type { PickCandidate } from "@/lib/picks";
import { computePicks, distanceLabel } from "@/lib/picks";
import { tenge } from "@/lib/format";
import { withCity } from "@/lib/url";
import { useUserCoords } from "@/lib/profile";
import { Avatar } from "./Avatar";
import { Rating } from "./Rating";
import { useI18n } from "./I18nProvider";

type Kind = "cheapest" | "closest" | "optimal";

const ICON = { cheapest: Wallet, closest: Navigation, optimal: Award };

export function ServicePicks({
  candidates,
  city,
}: {
  candidates: PickCandidate[];
  city: string;
}) {
  const { t } = useI18n();
  const { coords, state, request } = useUserCoords();
  if (candidates.length < 2) return null;

  const picks = computePicks(candidates, coords);
  const cards: { kind: Kind; c: PickCandidate; reason: string }[] = [];

  if (picks.cheapest)
    cards.push({ kind: "cheapest", c: picks.cheapest, reason: t.pickWhyPrice });
  if (picks.closest) {
    const d = distanceLabel(picks.closest, coords);
    cards.push({
      kind: "closest",
      c: picks.closest,
      reason: d ? `${t.pickWhyNear} · ${d}` : t.pickWhyNear,
    });
  }
  if (picks.optimal)
    cards.push({
      kind: "optimal",
      c: picks.optimal,
      reason: picks.optimal.reviewSummary || t.pickWhyBalance,
    });

  return (
    <section aria-label={t.picksTitle} className="mb-6">
      <h2 className="mb-3 text-lg font-semibold">{t.picksTitle}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(({ kind, c, reason }) => (
          <PickCard key={kind} kind={kind} c={c} reason={reason} city={city} />
        ))}
        {!coords && (
          <button
            type="button"
            onClick={request}
            className="pressable flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line bg-surface px-4 text-center text-sm font-medium text-muted hover:bg-surface-2 sm:min-h-[140px]"
          >
            <LocateFixed size={22} aria-hidden className="text-brand-ink" />
            {state === "loading" ? t.geoLoading : t.pickShowClosest}
          </button>
        )}
      </div>
    </section>
  );
}

function PickCard({
  kind,
  c,
  reason,
  city,
}: {
  kind: Kind;
  c: PickCandidate;
  reason: string;
  city: string;
}) {
  const { t } = useI18n();
  const Icon = ICON[kind];
  const label =
    kind === "cheapest"
      ? t.pickCheapest
      : kind === "closest"
        ? t.pickClosest
        : t.pickOptimal;
  const optimal = kind === "optimal";

  // distinct accent per pick, palette-disciplined (green=cheap, red=optimal,
  // neutral=closest) — these are 3 *different* labeled choices, not filler cards.
  const accent =
    kind === "cheapest"
      ? "text-fresh"
      : optimal
        ? "text-brand-ink"
        : "text-ink";
  const frame = optimal
    ? "border-brand/40 bg-brand-wash"
    : "border-line bg-surface";

  return (
    <Link
      href={withCity(`/klinika/${c.brandId}`, city)}
      className={`pressable group relative flex min-w-0 flex-col rounded-2xl border ${frame} p-4 transition-colors hover:bg-surface-2`}
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Icon size={17} aria-hidden className={accent} strokeWidth={2.2} />
        <span className={`text-sm font-semibold ${accent}`}>{label}</span>
        {optimal && (
          <Star
            size={14}
            aria-hidden
            className="ml-auto fill-amber-400 text-amber-400"
            strokeWidth={0}
          />
        )}
      </div>
      <div className="flex items-center gap-2.5">
        <Avatar name={c.brand} logo={c.logo} size={40} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{c.brand}</div>
          <Rating value={c.rating} reviews={c.reviews} size={14} />
        </div>
      </div>
      <div className="mt-3 text-2xl font-bold tabular-nums text-brand-ink">
        {tenge(c.price)}
      </div>
      <p className="mt-1 line-clamp-2 text-sm text-muted">{reason}</p>
    </Link>
  );
}
