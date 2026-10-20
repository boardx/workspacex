"use client";
import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Research-only launcher: intake and saved sessions share the same visual placement. */
export function ResearchFloatingAssistant({ children, open, onOpenChange }: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <div className="fixed bottom-4 right-4 z-30 max-w-[calc(100vw-2rem)] md:bottom-5 md:left-10 md:right-auto">
    <Button variant="primary" className="h-10 rounded-full px-5 text-base shadow-lg" aria-expanded={open} onClick={() => onOpenChange(!open)}><Bot className="mr-2 size-5" aria-hidden />AI 助手</Button>
    {open && <aside className="absolute bottom-14 right-0 max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl md:left-0 md:right-auto" data-testid="guided-research-six-step-assistant">{children}</aside>}
  </div>;
}
