"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
export function AidtAssistantPanel({ open, fullPage, onClose, children }: { open: boolean; fullPage: boolean; onClose: () => void; children: React.ReactNode }) {
  const panel = React.useRef<HTMLElement>(null), closeButton = React.useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = React.useState<{ top: number; left: number; height: number; width: number } | null>(null);
  React.useEffect(() => {
    if (!open || fullPage) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus({ preventScroll: true });
    function close(event: KeyboardEvent) {
      const target = event.target;
      const ownsEvent = target instanceof Node && panel.current?.contains(target) || target === document && Boolean(panel.current?.contains(document.activeElement));
      if (ownsEvent && event.key === "Escape" && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); onClose(); }
    }
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("keydown", close); if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true }); };
  }, [open, fullPage, onClose]);
  React.useEffect(() => {
    if (!open || fullPage) { setViewport(null); return; }
    const visualViewport = window.visualViewport;
    function resize() {
      setViewport(window.innerWidth < 768 ? { top: visualViewport?.offsetTop ?? 0, left: visualViewport?.offsetLeft ?? 0, height: visualViewport?.height ?? window.innerHeight, width: visualViewport?.width ?? window.innerWidth } : null);
    }
    resize(); window.addEventListener("resize", resize); visualViewport?.addEventListener("resize", resize); visualViewport?.addEventListener("scroll", resize);
    return () => { window.removeEventListener("resize", resize); visualViewport?.removeEventListener("resize", resize); visualViewport?.removeEventListener("scroll", resize); };
  }, [open, fullPage]);
  const visibleViewport = open && !fullPage ? viewport : null;
  return <aside ref={panel} hidden={!fullPage && !open} role={fullPage ? undefined : "dialog"} aria-modal={fullPage ? undefined : false} aria-label="AI 引导师" data-testid="aidt-assistant-panel" style={visibleViewport ? { top: visibleViewport.top, left: visibleViewport.left, width: visibleViewport.width, height: visibleViewport.height, bottom: "auto", right: "auto" } : undefined} className={fullPage ? "flex min-h-0 min-w-0 flex-1 flex-col" : `${open ? "flex" : "hidden"} fixed inset-0 z-40 w-full max-w-none flex-col border-l border-border bg-background shadow-xl md:absolute md:inset-y-0 md:left-auto md:right-0 md:max-w-md`}>
    {!fullPage && <header className="flex shrink-0 items-center justify-between border-b border-border p-3"><h2 className="text-14 font-semibold">AI 引导师</h2><Button ref={closeButton} size="sm" variant="ghost" onClick={onClose}>关闭 AI 引导师</Button></header>}
    <div className="flex min-h-0 flex-1 flex-col" data-testid="aidt-chat-host">{children}</div>
  </aside>;
}
