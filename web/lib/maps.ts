// Map / contact deep links. No API key needed.

// 2GIS route to a specific point (lands the user on the branch location).
// City is our slug, which matches the 2GIS url space (almaty, astana, ...).
export function routeUrl(city: string, lat: number, lng: number): string {
  return `https://2gis.kz/${city}/geo/${lng},${lat}`;
}

// Yandex Maps route to a point (no key needed). rtext=~ means "from my location".
export function yandexRouteUrl(lat: number, lng: number): string {
  return `https://yandex.ru/maps/?rtext=~${lat},${lng}&rtt=auto`;
}

// Plain point on the map (fallback when there is no obvious route target).
export function pointUrl(city: string, lat: number, lng: number): string {
  return `https://2gis.kz/${city}/geo/${lng},${lat}`;
}

// Best-effort link to the clinic's own card in 2GIS.
// If the parser already stored a 2GIS source url, use it directly;
// otherwise open a 2GIS search for "name, address" which lands on the firm card.
export function firmUrl(
  city: string,
  name: string,
  address?: string | null,
  sourceUrl?: string | null,
): string {
  if (sourceUrl && /2gis\./i.test(sourceUrl)) return sourceUrl;
  const q = [name, address].filter(Boolean).join(", ");
  return `https://2gis.kz/${city}/search/${encodeURIComponent(q)}`;
}

export function telUrl(phone: string): string {
  return "tel:" + phone.replace(/[^+\d]/g, "");
}

// Returns a wa.me link only for numbers that look like a KZ mobile (77xxxxxxxxx),
// so we never render a dead "Написать" button for a landline.
export function whatsappUrl(
  phone: string | null | undefined,
  text?: string,
): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length !== 11 || d[0] !== "7" || d[1] !== "7") return null;
  const base = `https://wa.me/${d}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

// Pretty host for a "source" link label, e.g. "103.kz".
export function sourceHost(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function hasGeo(p: {
  lat: number | null;
  lng: number | null;
}): p is { lat: number; lng: number } {
  return typeof p.lat === "number" && typeof p.lng === "number";
}
