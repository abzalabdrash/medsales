import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-surface-2 text-muted">
        <Icon size={28} strokeWidth={1.75} aria-hidden />
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      {hint && <p className="max-w-md text-muted">{hint}</p>}
      {children}
    </div>
  );
}
