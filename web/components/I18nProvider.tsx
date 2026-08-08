"use client";

import { createContext, useContext } from "react";
import { getDict, type Dict, type Locale } from "@/lib/i18n";

type I18nValue = { locale: Locale; t: Dict };

const I18nCtx = createContext<I18nValue | null>(null);

export function I18nProvider(props: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value: I18nValue = { locale: props.locale, t: getDict(props.locale) };
  return <I18nCtx.Provider value={value}>{props.children}</I18nCtx.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nCtx);
  if (v) return v;
  return { locale: "ru", t: getDict("ru") };
}
