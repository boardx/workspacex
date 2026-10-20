"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Research-only launcher: intake and saved sessions share the same visual placement. */
export function ResearchFloatingAssistant({ children, open, onOpenChange }: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const panelId = useId();
  const launcher = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);
  const close = () => { onOpenChange(false); launcher.current?.focus(); };
  return <div className="fixed bottom-4 right-4 z-30 max-w-[calc(100vw-2rem)] md:bottom-5 md:left-10 md:right-auto">
    <Button ref={launcher} aria-controls={open ? panelId : undefined} variant="primary" className="h-10 rounded-full px-5 text-base shadow-lg" aria-expanded={open} onClick={() => onOpenChange(!open)}><Bot className="mr-2 size-5" aria-hidden />AI 助手</Button>
    {open && <aside id={panelId} aria-label="研究助手" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }} className="absolute bottom-14 right-0 max-h-[70dvh] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-xl md:left-0 md:right-auto" data-testid="guided-research-six-step-assistant"><div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2"><h2 className="text-base font-semibold">研究助手</h2><Button ref={closeButton} variant="ghost" size="icon" aria-label="关闭研究助手" onClick={close}><X className="size-4" aria-hidden /></Button></div>{children}</aside>}
  </div>;
}
