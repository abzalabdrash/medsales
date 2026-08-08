import { Star } from "lucide-react";
import { formatRating } from "@/lib/format";

// The single rating component used everywhere — always on the 5-point scale.
// "★ 4,8 (123)". Accessible label spells out "из 5" for screen readers / 70+.
export function Rating({
  value,
  reviews,
  size = 16,
}: {
  value: number | null;
  reviews?: number | null;
  size?: number;
}) {
  const r = formatRating(value);
  if (!r) return null;
  return (
    <span
      className="inline-flex items-center gap-1 text-sm font-medium"
      aria-label={`Рейтинг ${r} из 5${reviews ? `, ${reviews} отзывов` : ""}`}
    >
      <Star
        size={size}
        className="fill-amber-400 text-amber-400"
        strokeWidth={0}
        aria-hidden
      />
      <span className="tabular-nums">{r}</span>
      {reviews ? (
        <span className="font-normal text-muted">({reviews})</span>
      ) : null}
    </span>
  );
}
