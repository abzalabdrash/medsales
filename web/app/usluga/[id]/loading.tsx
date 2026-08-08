import { OfferListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="skeleton h-5 w-64 rounded" />
      <div className="skeleton mt-3 h-10 w-2/3 rounded-lg" />
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-20 rounded-2xl" />
        ))}
      </div>
      <div className="mt-6">
        <OfferListSkeleton rows={5} />
      </div>
    </main>
  );
}
