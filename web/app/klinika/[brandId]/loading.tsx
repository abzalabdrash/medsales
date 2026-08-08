export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-6 sm:px-6">
      <div className="skeleton h-5 w-48 rounded" />
      <div className="skeleton mt-3 h-10 w-1/2 rounded-lg" />
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_minmax(340px,400px)]">
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-32 rounded-2xl" />
          ))}
        </div>
        <div className="skeleton hidden h-[520px] rounded-2xl lg:block" />
      </div>
    </main>
  );
}
