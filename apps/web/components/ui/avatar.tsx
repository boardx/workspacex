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
  initials, className, tone, size, src, ...props
}: {
  initials: string;
  /**
   * #638 delta，迭代 2：真实头像图片（Blob URL 或绝对地址）。可选——不传时保持原有
   * 行为（缩写占位），向后兼容全部既有调用点。
   */
  src?: string | null;
} & React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof avatarVariants>) {
  return (
    <span
      aria-hidden
      className={cn(avatarVariants({ tone, size }), "overflow-hidden p-0", className)}
      {...props}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Blob URL，不是可优化的静态资源
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initials
      )}
    </span>
  );
}
