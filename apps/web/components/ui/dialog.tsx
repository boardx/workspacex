"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dialog —— 契约束 interaction-primitives（F01/F02）的四个弹层原语之一。
 *
 * 只封装 Radix Dialog 的骨架 + 本仓 token（bg-popover / border-border / shadow-lg），
 * 不新增语义。点遮罩与 Esc 关闭是 Radix 默认行为（domain.md I-2「点遮罩与 Esc 语义等价」）。
 * 焦点环走全局约定：focus-visible:ring-2 focus-visible:ring-ring。
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-inverse/40 backdrop-blur-sm transition-opacity duration-base",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * 内置关闭按钮的 data-testid，默认 "dialog-close"。多个 Dialog 同屏共存
     * （如嵌套 dialog、或旧的 `Modal`/`AdminModal` 每实例一个 testid 的调用方）
     * 需要各自可寻址，传入区分值即可，不改变行为，只改 testid。
     */
    closeTestId?: string;
    /** 隐藏内置关闭按钮，调用方自己在 children 里放（极少数场景，如复用旧 footer 结构）。 */
    hideClose?: boolean;
  }
>(({ className, children, closeTestId = "dialog-close", hideClose, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4",
        "rounded-container border border-border bg-popover p-5 text-popover-foreground shadow-lg",
        "transition-all duration-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          aria-label="关闭"
          data-testid={closeTestId}
          className={cn(
            "absolute right-3 top-3 rounded-control p-1 text-muted-foreground transition-all duration-base",
            "hover:bg-muted hover:text-background-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <X aria-hidden className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-1 flex items-center justify-end gap-2", className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title ref={ref} className={cn("text-16 font-bold tracking-tight", className)} {...props} />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-13 text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = "DialogDescription";
