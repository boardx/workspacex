"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Non-modal inspector: explicit entry, Escape/outside dismissal and focus return. */
export function BoardToolPopover({ label, children, trigger, open, onOpenChange, placement = "right", compact = false, onEscapeKeyDown }: { label: string; children: ReactNode; trigger?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; placement?: "left" | "right" | "above"; compact?: boolean; onEscapeKeyDown?: (event: KeyboardEvent) => void }) {
  const id = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const isOpen = open ?? localOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [anchor,setAnchor] = useState({left:16,top:80,maxHeight:0,side:'above' as 'above'|'below'|'left'|'right'});
  useLayoutEffect(() => {
    if (!isOpen) return;
    let frame=0;
    const update = () => {
      const bounds = triggerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const margin = 16, gap = 8;
      const width = Math.min(compact ? 208 : 320, window.innerWidth - margin * 2);
      const content = contentRef.current;
      const border = content ? Math.max(0, content.offsetHeight - content.clientHeight) : 0;
      const height = Math.min((content?.scrollHeight || 320) + border, window.innerHeight - 96);
      const above = Math.max(0, bounds.top - gap - 72);
      const below = Math.max(0, window.innerHeight - bounds.bottom - gap - margin);
      let side: 'above' | 'below' | 'left' | 'right' = placement;
      if (placement === 'above' && above < Math.min(height, 80) && below > above) side = 'below';
      if (placement !== 'above') {
        const right = window.innerWidth - bounds.right - gap - margin;
        const left = bounds.left - gap - margin;
        if ((placement === 'right' ? right : left) >= width) side = placement;
        else if ((placement === 'right' ? left : right) >= width) side = placement === 'right' ? 'left' : 'right';
        else side = above >= height || above >= below ? 'above' : 'below';
      }
      const next = {
        left: side === 'right' ? bounds.right + gap : side === 'left' ? bounds.left - gap - width : Math.max(margin, Math.min(bounds.left, window.innerWidth - width - margin)),
        top: side === 'above' ? bounds.top - gap : side === 'below' ? bounds.bottom + gap : Math.max(72, Math.min(bounds.top, window.innerHeight - height - margin)),
        maxHeight: side === 'above' ? above : side === 'below' ? below : window.innerHeight - 88,
        side,
      };
      setAnchor(previous => previous.left === next.left && previous.top === next.top && previous.maxHeight === next.maxHeight && previous.side === next.side ? previous : next);
    };
    const follow = () => { update();frame=requestAnimationFrame(follow); };
    follow();window.addEventListener("resize",update);window.addEventListener("scroll",update,true);
    return () => {cancelAnimationFrame(frame);window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);};
  },[isOpen,placement,compact]);
  const updateOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); if (next) window.dispatchEvent(new CustomEvent("board-inspector-open", { detail: id })); };
  useEffect(() => { const closeOthers = (event: Event) => { if (isOpen && (event as CustomEvent<string>).detail !== id) { setLocalOpen(false); onOpenChange?.(false); } }; window.addEventListener("board-inspector-open", closeOthers); return () => window.removeEventListener("board-inspector-open", closeOthers); }, [id, isOpen, onOpenChange]);
  return <Dialog.Root modal={false} open={isOpen} onOpenChange={updateOpen}>
    <Dialog.Trigger ref={triggerRef} asChild>{trigger ?? <Button data-testid={`board-inspector-${({ "更多操作": "actions", "布局": "layout", "外观": "appearance", "便利贴样式": "sticky", "文字样式": "text", "标签与链接": "metadata" } as Record<string, string>)[label] ?? "open"}`} variant="ghost" className="min-h-11 shrink-0 px-3">{label}</Button>}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Content ref={contentRef} data-testid="board-tool-popover" data-board-popover-preferred-placement={placement} data-board-popover-placement={anchor.side} style={{
      left: anchor.left,
      top: anchor.top,
      transform: anchor.side === "above" ? "translateY(-100%)" : undefined,
      maxHeight: anchor.maxHeight,
      width: compact ? 208 : undefined,
      visibility: anchor.maxHeight < 2 ? "hidden" : undefined,
      pointerEvents: anchor.maxHeight < 2 ? "none" : undefined,
    }} aria-describedby={undefined} onEscapeKeyDown={onEscapeKeyDown} className={`fixed z-50 max-h-[calc(100dvh-12rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto [&_button]:min-h-11 [&_button]:min-w-11 [&_input]:min-h-11 [&_select]:min-h-11 rounded-2xl border border-border bg-card text-foreground shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-safe:animate-in motion-safe:fade-in`}>
      <div className={compact ? "p-2" : "p-4"}>
        <div className={compact ? "mb-1 flex items-center justify-between gap-2" : "mb-4 flex items-center justify-between gap-2"}><Dialog.Title className={compact ? "text-12 font-medium" : "text-14 font-semibold"}>{label}</Dialog.Title><Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={`关闭${label}`} className={compact ? "h-6 w-6 !min-h-6 !min-w-6" : "min-h-11 min-w-11"}><X className="h-4 w-4" /></Button></Dialog.Close></div>
        {children}
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
