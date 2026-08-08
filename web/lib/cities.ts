// City slug -> Russian name. Matches config/cities.yaml on the parser side.
export const CITIES: { slug: string; name: string }[] = [
  { slug: "almaty", name: "Алматы" },
  { slug: "astana", name: "Астана" },
  { slug: "shymkent", name: "Шымкент" },
  { slug: "karaganda", name: "Караганда" },
  { slug: "aktobe", name: "Актобе" },
  { slug: "pavlodar", name: "Павлодар" },
  { slug: "atyrau", name: "Атырау" },
  { slug: "kostanay", name: "Костанай" },
  { slug: "aktau", name: "Актау" },
  { slug: "kyzylorda", name: "Кызылорда" },
  { slug: "taraz", name: "Тараз" },
  { slug: "petropavlovsk", name: "Петропавловск" },
  { slug: "taldykorgan", name: "Талдыкорган" },
];

export const CITY_NAME: Record<string, string> = Object.fromEntries(
  CITIES.map((c) => [c.slug, c.name]),
);

export const DEFAULT_CITY = "almaty";

export function cityName(slug: string | undefined): string {
  return (slug && CITY_NAME[slug]) || CITY_NAME[DEFAULT_CITY];
}

// Validate an incoming ?city slug; fall back to the default city.
export function resolveCity(slug: string | undefined | null): string {
  return slug && CITY_NAME[slug] ? slug : DEFAULT_CITY;
}
