"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/** Reading and editing share the same footprint; only the clicked field opens. */
export function InlineQuestionText({ value, label, editLabel = label, placeholder, multiline = false, disabled = false, className = "", onSelect, onChange }: {
  value: string;
  label: string;
  editLabel?: string;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  onSelect?: () => void;
  onChange: (value: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const ref = React.useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const readingRef = React.useRef<HTMLButtonElement>(null);
  const returnFocus = React.useRef(false);
  React.useLayoutEffect(() => {
    if (editing) {
      ref.current?.focus();
      if (multiline && ref.current) {
        ref.current.style.height = "auto";
        ref.current.style.height = `${ref.current.scrollHeight}px`;
      }
    } else if (returnFocus.current) {
      returnFocus.current = false;
      readingRef.current?.focus();
    }
  }, [editing, multiline, value]);
  const fieldClass = cn("min-h-9 w-full border-transparent bg-transparent px-2 py-1 shadow-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0", className);
  if (editing && !disabled) {
    const props = {
      ref, value, "aria-label": label, className: fieldClass,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
      onBlur: () => setEditing(false),
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape" || (event.key === "Enter" && (!multiline || !event.shiftKey || event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          returnFocus.current = true;
          setEditing(false);
        }
      },
    };
    return multiline ? <Textarea {...props} /> : <Input {...props} />;
  }
  return <button ref={readingRef} type="button" data-survey-inline-edit disabled={disabled} aria-label={editLabel}
    className={cn("min-h-9 w-full whitespace-pre-wrap break-words rounded-control border border-transparent px-2 py-1 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", !value && "text-muted-foreground", className)}
    onClick={() => { onSelect?.(); setEditing(true); }}>
    {value || placeholder || "未命名题目"}
  </button>;
}
