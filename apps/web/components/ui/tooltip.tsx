"use client";
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

/**
 * Tooltip —— 契约束 interaction-primitives（F01/F02）弹层原语之一。
 *
 * Radix Tooltip 的触发既响应 hover 也响应键盘 focus（domain.md：hover / focus 双触发等价），
 * 本文件只贴 token 皮肤（bg-inverse / text-inverse-foreground，反色气泡）。
 */
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

/** 空 content（null/undefined/纯空白字符串）不挂气泡——没有内容的提示不该占屏幕。 */
function isEmptyTooltipContent(children: React.ReactNode): boolean {
  if (children === null || children === undefined || children === false) return true;
  if (typeof children === "string") return children.trim() === "";
  if (Array.isArray(children)) return children.every(isEmptyTooltipContent);
  return false;
}

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => {
  if (isEmptyTooltipContent(children)) return null;
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-xs rounded-md bg-inverse px-2 py-1 text-11 text-inverse-foreground shadow-md",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-inverse" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
TooltipContent.displayName = "TooltipContent";
