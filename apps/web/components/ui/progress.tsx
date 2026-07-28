import { cn } from "@/lib/utils";

/** 进度条。⚠ 不用 opacity 表达状态；未完成部分用 --muted 实底 */
export function Progress({
  value, max = 100, label, className, tone = "primary",
}: { value: number; max?: number; label?: string; className?: string; tone?: "primary" | "warning" | "destructive" }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar = { primary: "bg-primary", warning: "bg-warning", destructive: "bg-destructive" }[tone];
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div className={cn("h-full rounded-full transition-all duration-200", bar)} style={{ width: `${pct}%` }} />
    </div>
  );
}
