import { cookies } from "next/headers";
import { resolveLocale, type Locale } from "./i18n";

// Reads the active locale from the `lang` cookie (server components only).
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return resolveLocale(store.get("lang")?.value);
}
