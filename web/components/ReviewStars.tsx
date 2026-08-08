import { Star } from "lucide-react";

// Five stars filled up to `value` (1..5). Used per individual review.
export function ReviewStars({
  value,
  size = 16,
}: {
  value: number | null;
  size?: number;
}) {
  if (!value) return null;
  const v = Math.round(value);
  return (
    <span className="inline-flex" aria-label={`${v} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          strokeWidth={0}
          aria-hidden
          className={i <= v ? "fill-amber-400 text-amber-400" : "fill-line text-line"}
        />
      ))}
    </span>
  );
}
