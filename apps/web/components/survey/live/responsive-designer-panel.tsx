"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** Render one editor instance: inline on desktop, focus-trapped on demand on narrow screens. */
export function ResponsiveDesignerPanel({ title, enabled, disabled, children }: {
  title: string; enabled: boolean; disabled?: boolean; children: React.ReactNode;
}) {
  const [narrow, setNarrow] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!enabled || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 1279px)");
    const update = () => { setNarrow(media.matches); if (!media.matches) setOpen(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [enabled]);
  if (!enabled || !narrow) return <>{children}</>;
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="outline" disabled={disabled} aria-expanded={open}>打开{title}</Button></DialogTrigger>
    <DialogContent className="w-[calc(100%-2rem)] max-w-xl overflow-y-auto">
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>修改会同步到当前设计，关闭面板不会丢失内容。</DialogDescription>
      <fieldset disabled={disabled} className="min-w-0">{children}</fieldset>
    </DialogContent>
  </Dialog>;
}
