export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="skeleton h-5 w-56 rounded" />
      <div className="skeleton mt-3 h-10 w-1/2 rounded-lg" />
      <div className="mt-6 flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="skeleton h-14 rounded-xl" />
        ))}
      </div>
    </main>
  );
}
