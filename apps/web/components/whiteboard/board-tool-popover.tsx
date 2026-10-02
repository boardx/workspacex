"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Non-modal inspector: explicit entry, Escape/outside dismissal and focus return. */
export function BoardToolPopover({ label, children, trigger, open, onOpenChange, placement = "right", onEscapeKeyDown }: { label: string; children: ReactNode; trigger?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; placement?: "left" | "right" | "above"; onEscapeKeyDown?: (event: KeyboardEvent) => void }) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [anchor,setAnchor] = useState({left:16,top:80,maxHeight:0,side:'above' as 'above'|'below'});
  useEffect(() => {
    if (!isOpen || placement !== "above") return;
    let frame=0;
    const update = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const next = {
        left: Math.max(16, Math.min(bounds.left, window.innerWidth - 336)),
        top: bounds.top - 8,
        maxHeight: Math.max(0, bounds.top - 8 - 72),
        side: "above" as const,
      };
      setAnchor(previous => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight && previous.side === next.side ? previous : next);
    };
    const follow = () => { update();frame=requestAnimationFrame(follow); };
    follow();window.addEventListener("resize",update);window.addEventListener("scroll",update,true);
    return () => {cancelAnimationFrame(frame);window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);};
  },[isOpen,placement]);
  const updateOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); if (next) window.dispatchEvent(new CustomEvent("board-inspector-open", { detail: id })); };
  useEffect(() => { const closeOthers = (event: Event) => { if (isOpen && (event as CustomEvent<string>).detail !== id) { setLocalOpen(false); onOpenChange?.(false); } }; window.addEventListener("board-inspector-open", closeOthers); return () => window.removeEventListener("board-inspector-open", closeOthers); }, [id, isOpen, onOpenChange]);
  return <Dialog.Root modal={false} open={isOpen} onOpenChange={updateOpen}>
    <Dialog.Trigger ref={triggerRef} asChild>{trigger ?? <Button data-testid={`board-inspector-${({ "更多操作": "actions", "布局": "layout", "外观": "appearance", "便利贴样式": "sticky", "文字样式": "text", "标签与链接": "metadata" } as Record<string, string>)[label] ?? "open"}`} variant="ghost" className="min-h-11 shrink-0 px-3">{label}</Button>}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Content data-board-popover-preferred-placement={placement} data-board-popover-placement={placement === "above" ? anchor.side : placement} style={placement === "above" ? {
      left: anchor.left,
      top: anchor.top,
      transform: "translateY(-100%)",
      maxHeight: anchor.maxHeight,
      visibility: anchor.maxHeight < 2 ? "hidden" : undefined,
      pointerEvents: anchor.maxHeight < 2 ? "none" : undefined,
    } : undefined} aria-describedby={undefined} onEscapeKeyDown={onEscapeKeyDown} className={`fixed ${placement === "left" ? "left-4" : "right-4"} top-20 z-50 max-h-[calc(100dvh-12rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_select]:min-h-11 rounded-2xl border border-border bg-card text-foreground shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in`}>
      <div className="p-4">
        <div className="mb-4 flex items-center justify-between gap-2"><Dialog.Title className="text-14 font-semibold">{label}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={`关闭${label}`} className="min-h-11 min-w-11"><X className="h-4 w-4" /></Button></Dialog.Close></div>
        {children}
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
