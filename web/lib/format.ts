// Locale-agnostic number / price formatting.
// Text helpers (categories, freshness, plurals) live in lib/i18n.ts.

export function tenge(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("ru-RU").replace(/,/g, " ") + " ₸";
}

// Format a rating on the 5-point scale, e.g. 4.8 -> "4,8". (App is /5 everywhere.)
export function formatRating(r: number | null | undefined): string | null {
  if (r == null) return null;
  return r.toFixed(1).replace(".", ",");
}
