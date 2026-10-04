"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-16 w-full rounded-control border border-input bg-card px-3 py-2.5 text-14 text-card-foreground",
        "placeholder:text-muted-foreground transition-colors duration-base motion-reduce:transition-none resize-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:bg-disabled disabled:text-disabled-foreground disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
