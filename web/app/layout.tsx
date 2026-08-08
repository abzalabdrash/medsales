import type { Metadata } from "next";
import { Golos_Text } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { Header } from "@/components/Header";
import { I18nProvider } from "@/components/I18nProvider";
import { ChatWidget } from "@/components/ChatWidget";
import { getDict } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";

const golos = Golos_Text({
  subsets: ["latin", "cyrillic"],
  variable: "--font-golos",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = getDict(await getLocale());
  return { title: t.metaTitle, description: t.metaDescription };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={golos.variable}>
      <body>
        <I18nProvider locale={locale}>
          <Header />
          {children}
          <Suspense fallback={null}>
            <ChatWidget />
          </Suspense>
        </I18nProvider>
      </body>
    </html>
  );
}
