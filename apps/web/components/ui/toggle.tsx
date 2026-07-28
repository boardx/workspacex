"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** 开关。用 token 对表达开/关，不用 opacity */
export function Toggle({
  checked, onCheckedChange, label, id, ...props
}: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        checked ? "bg-primary" : "bg-muted",
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-card shadow-sm transition-all duration-200",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
