import { TileGridSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-[760px]">
        <div className="skeleton mx-auto h-10 w-3/4 rounded-lg" />
        <div className="skeleton mx-auto mt-3 h-6 w-1/2 rounded-lg" />
        <div className="skeleton mt-6 h-16 w-full rounded-2xl" />
      </div>
      <div className="mt-10">
        <TileGridSkeleton />
      </div>
    </main>
  );
}
