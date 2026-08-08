export function Line({ w = "100%", h = 16 }: { w?: string; h?: number }) {
  const s = { width: w, height: h };
  return <span className="skeleton block rounded-md" style={s} />;
}

export function OfferRowSkeleton() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Line w="170px" h={20} />
          <Line w="130px" h={14} />
        </div>
        <Line w="110px" h={28} />
      </div>
      <div className="mt-4 flex gap-2">
        <Line w="104px" h={44} />
        <Line w="104px" h={44} />
        <Line w="104px" h={44} />
      </div>
    </div>
  );
}

export function OfferListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <OfferRowSkeleton key={i} />
      ))}
    </div>
  );
}

export function TileGridSkeleton({ n = 8 }: { n?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="skeleton h-16 rounded-2xl" />
      ))}
    </div>
  );
}
