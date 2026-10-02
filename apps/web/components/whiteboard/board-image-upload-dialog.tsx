"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function BoardImageUploadDialog({ open, replacing, busy, error, onClose, onFile, onUrl, onRetry }: {
  open: boolean; replacing: boolean; busy: boolean; error: string | null;
  onClose: () => void; onFile: (file: File) => void; onUrl: (url: string) => void; onRetry: () => void;
}) {
  const input = useRef<HTMLInputElement>(null), [url, setUrl] = useState(""), [dragging, setDragging] = useState(false);
  return <Dialog open={open} onOpenChange={(value) => { if (!value) { setUrl(""); setDragging(false); onClose(); } }}><DialogContent className="w-[min(30rem,calc(100vw-2rem))] overflow-y-auto" closeTestId="board-image-close" data-testid="board-image-upload-dialog" onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); const file = event.dataTransfer.files[0]; if (file && !busy) onFile(file); }}>
    <DialogTitle>{replacing ? "替换图片" : "添加图片"}</DialogTitle><DialogDescription>JPG、PNG、WEBP、GIF、SVG · 最大 25MB</DialogDescription>
    <input ref={input} data-testid="board-image-input" className="sr-only" type="file" aria-label="上传图片" disabled={busy} accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
    <button type="button" data-testid="board-image-dropzone" disabled={busy} className={cn("flex min-h-32 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-6 disabled:bg-disabled disabled:text-disabled-foreground", dragging && "border-primary bg-primary/5")} onClick={() => input.current?.click()}>{busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}<span aria-live="polite">{busy ? "正在上传" : dragging ? "松开即可上传" : "选择或拖入图片"}</span></button>
    <label className="grid gap-2 text-sm">图片地址<Input data-testid="board-image-url" aria-label="HTTPS 图片地址" disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
    {error ? <div role="alert" data-testid="board-image-error" className="flex items-center justify-between gap-3 text-sm text-destructive"><span>{error}</span><Button disabled={busy} onClick={onRetry}>重试</Button></div> : null}
    <div className="flex justify-end"><Button variant="primary" disabled={busy || !url.trim()} data-testid="board-image-url-apply" onClick={() => onUrl(url.trim())}><ImagePlus className="mr-2 h-4 w-4" />{replacing ? "替换图片" : "添加图片"}</Button></div>
  </DialogContent></Dialog>;
}
