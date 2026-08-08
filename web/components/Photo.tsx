import type { LucideIcon } from "lucide-react";

// Placeholder slot for an AI-generated illustration. Swap the inner content for
// a <next/image> once the WebP asset exists (see image prompts in README).
export function Photo({
  icon: Icon,
  label,
  className = "",
}: {
  icon: LucideIcon;
  label?: string;
  className?: string;
}) {
  return (
    <div
      data-photo-slot
      role="img"
      aria-label={label ?? "Иллюстрация"}
      className={`grid place-items-center overflow-hidden rounded-2xl border border-line bg-surface-2 ${className}`}
    >
      <Icon size={28} strokeWidth={1.75} className="text-muted" aria-hidden />
    </div>
  );
}
