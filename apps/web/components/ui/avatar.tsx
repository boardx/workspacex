import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** 头像用缩写而非图片——原型里全是缩写（AV/SC/LG/林/周），且避免外部图片依赖 */
const avatarVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-full font-medium transition-colors duration-200",
  {
    variants: {
      tone: {
        human: "bg-accent text-accent-foreground",
        ai: "bg-ai-tint text-ai-tint-foreground",
        muted: "bg-muted text-muted-foreground",
      },
      size: {
        xs: "h-5 w-5 text-9",
        sm: "h-6 w-6 text-10",
        md: "h-7 w-7 text-11",
        lg: "h-9 w-9 text-13",
      },
    },
    defaultVariants: { tone: "human", size: "md" },
  },
);

export function Avatar({
  initials, className, tone, size, ...props
}: { initials: string } & React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof avatarVariants>) {
  return (
    <span aria-hidden className={cn(avatarVariants({ tone, size }), className)} {...props}>
      {initials}
    </span>
  );
}
