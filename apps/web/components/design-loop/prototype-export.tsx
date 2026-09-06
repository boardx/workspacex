"use client";
/**
 * 迭代 8 —— 导出菜单：设计文档（.md）/ 原型规格（.json）/ 当前页 PNG / 复制 JSON。
 *
 * 全部在客户端完成：素材都在 `DesignProject` 里，多一个接口只是多一份可漂移的副本（同迭代 0 的取舍）。
 * PNG 用 `html2canvas` 动态 import（只在点击时加载 ~200KB），目标是画布上 `data-frame-index` 等于当前页
 * 的那块屏——单页视图与画板视图都挂了这个属性。jsdom 里 `URL.createObjectURL` / 剪贴板 / html2canvas
 * 都由测试 mock。
 */
import * as React from "react";
import { Download, FileDown, FileJson, Image as ImageIcon, Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildDesignDocMarkdown, designDocFileName, buildPrototypeSpecJson, prototypeSpecFileName } from "@/lib/design-doc-markdown";
import type { DesignProject } from "@/lib/live-design-workbench";

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 当前页在画布上的那块屏（单页 / 画板都挂 `data-frame-index`）。 */
export function frameElementFor(index: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="design-detail-phone"][data-frame-index="${index}"]`);
}

export function PrototypeExportMenu({ project, frame }: { project: DesignProject; frame: number }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const flash = (key: string) => { setDone(key); window.setTimeout(() => setDone(null), 1500); };

  const doc = () => {
    const now = new Date();
    download(new Blob([buildDesignDocMarkdown(project, now)], { type: "text/markdown;charset=utf-8" }), designDocFileName(project, now));
    setOpen(false);
  };
  const json = () => {
    download(new Blob([buildPrototypeSpecJson(project)], { type: "application/json;charset=utf-8" }), prototypeSpecFileName(project, new Date()));
    setOpen(false);
  };
  const copy = async () => {
    setBusy("copy");
    try {
      await navigator.clipboard.writeText(buildPrototypeSpecJson(project));
      flash("copy");
    } finally {
      setBusy(null);
    }
  };
  const png = async () => {
    const el = frameElementFor(frame);
    if (el === null) return;
    setBusy("png");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(el, { backgroundColor: null, scale: 2, useCORS: true, logging: false });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob !== null) download(blob, `${project.name}-${project.frames[frame] ?? frame + 1}.png`);
      flash("png");
      setOpen(false);
    } finally {
      setBusy(null);
    }
  };

  const item = "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-12 transition-colors duration-fast hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled disabled:text-disabled-foreground";
  return (
    <div ref={rootRef} className="relative">
      <Button variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} data-testid="design-detail-export">
        <Download aria-hidden className="h-3.5 w-3.5" /> 导出
      </Button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-56 rounded-card border border-border bg-card p-1 shadow-lg" data-testid="design-detail-export-menu">
          <button type="button" role="menuitem" onClick={doc} className={item} data-testid="design-detail-export-doc">
            <FileDown aria-hidden className="h-3.5 w-3.5" /> 设计文档 (.md)
          </button>
          <button type="button" role="menuitem" onClick={json} className={item} data-testid="design-detail-export-json">
            <FileJson aria-hidden className="h-3.5 w-3.5" /> 原型规格 (.json)
          </button>
          <button type="button" role="menuitem" onClick={() => void png()} disabled={busy !== null || project.prototype.length === 0} className={item} data-testid="design-detail-export-png">
            {busy === "png" ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon aria-hidden className="h-3.5 w-3.5" />}
            当前页 PNG{project.frames[frame] !== undefined ? `（${project.frames[frame]}）` : ""}
          </button>
          <button type="button" role="menuitem" onClick={() => void copy()} disabled={busy !== null} className={cn(item, done === "copy" && "text-success")} data-testid="design-detail-export-copy">
            {done === "copy" ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
            {done === "copy" ? "已复制" : "复制 JSON 规格"}
          </button>
        </div>
      )}
    </div>
  );
}
