import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { getDict } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n.server";

export default async function NotFound() {
  const t = getDict(await getLocale());
  return (
    <main className="mx-auto w-full max-w-[700px] px-4 py-16 sm:px-6">
      <EmptyState icon={SearchX} title={t.nfTitle} hint={t.nfHint}>
        <Link
          href="/"
          className="pressable mt-2 inline-flex min-h-[48px] items-center rounded-xl bg-brand px-5 font-semibold text-white"
        >
          {t.toHome}
        </Link>
      </EmptyState>
    </main>
  );
}
