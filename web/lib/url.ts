// Build an internal href that always carries the active city.
export function withCity(path: string, city: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}city=${encodeURIComponent(city)}`;
}
