"use client";

import { ErrorState } from "@/components/ErrorState";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 sm:px-6">
      <ErrorState reset={reset} />
    </main>
  );
}
