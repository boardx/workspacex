import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-10 font-medium transition-colors duration-200",
  {
    variants: {
      tone: {
        neutral: "bg-muted text-muted-foreground",
        primary: "bg-accent text-accent-foreground",
        ai: "bg-ai-tint text-ai-tint-foreground",
        success: "bg-success text-success-foreground",
        // 复审横切：实心棕色 warning 与其它柔和药丸是两套体系——统一到柔和 token（warning-tint）。
        warning: "bg-warning-tint text-warning-tint-foreground",
        /** 浅色提醒（不阻断）：与 ai/neutral 同一浅色体系，替代实底 warning 做「待处理/待开通」类状态。 */
        attention: "bg-warning-tint text-warning-tint-foreground",
        danger: "bg-destructive text-destructive-foreground",
        outline: "border border-border text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  className, tone, ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
export { badgeVariants };
