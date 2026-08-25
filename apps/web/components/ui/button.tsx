"use client";
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * 禁用态一律用 token 对（disabled:bg-disabled + disabled:text-disabled-foreground）。
 * ⚠ 同理，**悬停态也不许用 `bg-<token>/<alpha>`**：透明度会让实际底色变成「token 与
 *   身后任意背景的混合」，token 上算好的对比度当场失效。issue #2075 真栈实锤：
 *   `hover:bg-primary/90` 在白底上合成 #248F7D，白字只剩 3.96:1（axe color-contrast
 *   在 `chat-thread-create` 上报的就是这一条）。primary 已改走 `--primary-hover`。
 *   `destructive` 的 `/90` 与 `ai` 的 `/80` 是同一形状的隐患，尚未在真栈上被 axe 抓到
 *   （那两种按钮不在 /chat 主界面上），如实登记，不在本次范围内顺手改。
 * ⚠ 严禁 disabled:opacity-* —— 统一透明度作用在深色实心按钮上会把黑底白字压成
 * ~2:1 的灰对灰（uiux-standards §1.1 记录的 Rooms 侧栏真实事故）。lint-design.sh 会拦。
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-control font-medium " +
    "transition-all duration-200 ease-in-out " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
    "disabled:pointer-events-none disabled:bg-disabled disabled:text-disabled-foreground disabled:border-transparent",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover active:scale-[0.98] shadow-sm",
        secondary: "bg-secondary text-secondary-foreground hover:bg-muted active:scale-[0.98]",
        outline: "border border-border bg-card text-card-foreground hover:bg-muted active:scale-[0.98]",
        ghost: "text-muted-foreground hover:bg-muted hover:text-background-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98]",
        ai: "bg-ai-tint text-ai-tint-foreground hover:bg-ai-tint/80 border border-ai/20",
      },
      size: {
        xs: "h-6 px-2 text-11",
        sm: "h-7 px-2.5 text-12",
        md: "h-8 px-3 text-13",
        lg: "h-10 px-4 text-14",
        icon: "h-8 w-8 p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";
export { buttonVariants };
