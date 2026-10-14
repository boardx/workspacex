"use client";

import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import type { WhiteboardObject } from "@repo/whiteboard-core";
import { Button } from "@/components/ui/button";
import { buildPdfFromPng } from "@/lib/canvas/export-image";
import { renderCanonicalBoardImage } from "./board-canonical-image";

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("BOARD_EXPORT_ENCODING_FAILED"));
    reader.onerror = () => reject(new Error("BOARD_EXPORT_ENCODING_FAILED"));
    reader.readAsDataURL(blob);
  });
}

export function BoardDownloadControls({ boardId, title, objects }: { boardId: string; title: string; objects: readonly WhiteboardObject[] }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, [boardId]);
  const download = async (format: "png" | "pdf") => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(null);
    try {
      const image = await renderCanonicalBoardImage({ boardId, objects, signal: controller.signal });
      const blob = format === "png" ? image.blob : (await buildPdfFromPng(await readDataUrl(image.blob), image.width, image.height)).output("blob");
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = `${title.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "Board"}.${format}`;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch {
      if (!controller.signal.aborted) setError("下载失败，请确认图片已加载并重试。");
    } finally {
      if (active.current === controller) { active.current = null; if (!controller.signal.aborted) setBusy(false); }
    }
  };
  return <div className="space-y-2" aria-label="下载白板">
    <Button data-testid="board-download-png" variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => void download("png")}><Download className="mr-2 h-4 w-4"/>下载 PNG</Button>
    <Button data-testid="board-download-pdf" variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => void download("pdf")}><Download className="mr-2 h-4 w-4"/>下载 PDF</Button>
    {busy ? <p role="status">正在准备下载…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
