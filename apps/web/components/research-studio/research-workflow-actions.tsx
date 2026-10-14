"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface WorkflowActionButtonProps extends Omit<ButtonProps, "size"> {
  loading?: boolean;
  icon?: React.ReactNode;
}

/** Shared workflow commands only; steps, navigation and permissions stay with each domain. */
export const WorkflowActionButton = React.forwardRef<HTMLButtonElement, WorkflowActionButtonProps>(
  ({ variant = "outline", loading = false, icon, disabled, asChild, children, onClick, onAuxClick, className, ...props }, ref) => {
    const blocked = Boolean(disabled || loading);
    const indicator = loading ? <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : icon;
    let content = <>{indicator}{children}</>;
    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<{ children?: React.ReactNode; tabIndex?: number; onAuxClick?: React.MouseEventHandler<HTMLElement>; onClick?: React.MouseEventHandler<HTMLElement> } & Pick<React.AriaAttributes, 'aria-disabled' | 'aria-busy'>>;
      content = React.cloneElement(child, {
        tabIndex: blocked ? -1 : child.props.tabIndex,
        onAuxClick: event => {
          if (blocked) { event.preventDefault(); event.stopPropagation(); return; }
          child.props.onAuxClick?.(event);
        },
        'aria-disabled': blocked || child.props['aria-disabled'] || undefined,
        'aria-busy': loading || child.props['aria-busy'] || props['aria-busy'] || undefined,
        onClick: event => {
          if (blocked) { event.preventDefault(); event.stopPropagation(); return; }
          child.props.onClick?.(event);
        },
      }, indicator ? <>{indicator}{child.props.children}</> : child.props.children);
    }
    return <Button {...props} ref={ref} asChild={asChild} type={props.type ?? (asChild ? undefined : "button")} variant={variant} size="md"
      className={cn("aria-disabled:bg-disabled aria-disabled:text-disabled-foreground aria-disabled:border-transparent", className)}
      disabled={blocked} aria-disabled={asChild && blocked ? true : props['aria-disabled']} aria-busy={loading || props['aria-busy'] || undefined}
      onAuxClick={event => { if (blocked) { event.preventDefault(); event.stopPropagation(); return; } onAuxClick?.(event); }}
      onClick={event => { if (blocked) { event.preventDefault(); event.stopPropagation(); return; } onClick?.(event); }}>
      {content}
    </Button>;
  },
);
WorkflowActionButton.displayName = "WorkflowActionButton";

export interface WorkflowActionBarProps extends React.HTMLAttributes<HTMLDivElement> {
  placement?: "inline" | "footer";
}

/** Footer commands sit after content; inline commands remain in their local toolbar. */
export function WorkflowActionBar({ placement = "inline", className, ...props }: WorkflowActionBarProps) {
  return <div {...props} data-workflow-action-bar={placement} className={cn(
    "flex min-w-0 flex-wrap items-center justify-end gap-2 print:hidden",
    placement === "footer" && "mt-6 border-t border-border pt-4",
    className,
  )} />;
}
