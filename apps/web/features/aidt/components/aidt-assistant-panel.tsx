"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
export function AidtAssistantPanel({ open, fullPage, onClose, children }: { open: boolean; fullPage: boolean; onClose: () => void; children: React.ReactNode }) {
  React.useEffect(() => {
    if (!open || fullPage) return;
    function close(event: KeyboardEvent) { if (event.key === "Escape") { event.preventDefault(); onClose(); } }
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, fullPage, onClose]);
  return <aside hidden={!fullPage && !open} aria-label="AI 引导师" data-testid="aidt-assistant-panel" className={fullPage ? "flex min-h-0 min-w-0 flex-1 flex-col" : `${open ? "flex" : "hidden"} absolute inset-y-0 right-0 z-40 w-full max-w-md flex-col border-l border-border bg-background shadow-xl`}>
    {!fullPage && <header className="flex items-center justify-between border-b border-border p-3"><h2 className="text-14 font-semibold">AI 引导师</h2><Button size="sm" variant="ghost" onClick={onClose}>关闭 AI 引导师</Button></header>}
    <div className="flex min-h-0 flex-1 flex-col" data-testid="aidt-chat-host">{children}</div>
  </aside>;
}
