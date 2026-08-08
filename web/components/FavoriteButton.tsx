"use client";

import { Star } from "lucide-react";
import {
  useProfile,
  toggleFavorite,
  favKey,
  type Favorite,
} from "@/lib/profile";
import { useI18n } from "./I18nProvider";

// Star toggle for an offer (service@clinic) or a whole clinic. Reactive via useProfile().
export function FavoriteButton({
  fav,
  variant = "icon",
  size = 20,
}: {
  fav: Favorite;
  variant?: "icon" | "labeled" | "compact";
  size?: number;
}) {
  const { t } = useI18n();
  const profile = useProfile();
  const key = favKey(fav);
  const active = profile.favorites.some((f) => favKey(f) === key);
  const label = active ? t.removeFromFav : t.addToFav;

  if (variant === "labeled") {
    return (
      <button
        type="button"
        onClick={() => toggleFavorite(fav)}
        aria-pressed={active}
        className={`pressable inline-flex min-h-[48px] items-center gap-1.5 rounded-xl border px-3 text-sm font-medium ${
          active
            ? "border-brand bg-brand-wash text-brand-ink"
            : "border-line bg-paper"
        }`}
      >
        <Star
          size={18}
          aria-hidden
          strokeWidth={2}
          className={active ? "fill-amber-400 text-amber-400" : ""}
        />
        {label}
      </button>
    );
  }

  const box =
    variant === "compact"
      ? "grid h-9 w-9 place-items-center rounded-lg"
      : "grid h-11 w-11 place-items-center rounded-xl border border-line bg-paper";

  return (
    <button
      type="button"
      onClick={() => toggleFavorite(fav)}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`pressable ${box}`}
    >
      <Star
        size={size}
        aria-hidden
        strokeWidth={2}
        className={active ? "fill-amber-400 text-amber-400" : "text-muted"}
      />
    </button>
  );
}
