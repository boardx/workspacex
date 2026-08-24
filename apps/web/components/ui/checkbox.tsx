"use client";
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** 原生 checkbox + 自绘指示器：受访者同意书需要逐项勾选且必须无障碍可达 */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode; description?: React.ReactNode }
>(({ className, label, description, id, ...props }, ref) => {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn("flex items-start gap-2", className)}>
      <span className="relative mt-0.5 inline-flex h-4 w-4 shrink-0">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          className="peer h-4 w-4 cursor-pointer appearance-none rounded-control border border-input bg-card transition-all duration-200 checked:border-primary checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:bg-disabled"
          {...props}
        />
        <Check aria-hidden className="pointer-events-none absolute left-0.5 top-0.5 h-3 w-3 text-primary-foreground opacity-0 transition-opacity duration-200 peer-checked:opacity-100" />
      </span>
      {(label || description) && (
        <label htmlFor={inputId} className="cursor-pointer select-none">
          {label && <span className="block text-13">{label}</span>}
          {description && <span className="mt-0.5 block text-11 text-muted-foreground">{description}</span>}
        </label>
      )}
    </div>
  );
});
Checkbox.displayName = "Checkbox";
