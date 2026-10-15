"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { BoardImageUploadItem } from "./use-board-image-upload";

export function BoardImageUploadDialog({ open, replacing, busy, error, onClose, onFile, onFiles, onUrl, onRetry, items = [] }: {
  open: boolean; replacing: boolean; busy: boolean; error: string | null;
  items?: readonly BoardImageUploadItem[]; onFiles?: (files: File[]) => void;
  onClose: () => void; onFile: (file: File) => void; onUrl: (url: string) => void; onRetry: () => void;
}) {
  const input = useRef<HTMLInputElement>(null), [url, setUrl] = useState(""), [dragging, setDragging] = useState(false);
  const submitFiles = (files: File[]) => { if (busy || !files.length) return; if (!replacing && onFiles) onFiles(files); else onFile(files[0]!); };
  return <Dialog open={open} onOpenChange={(value) => { if (!value) { setUrl(""); setDragging(false); onClose(); } }}><DialogContent className="w-[min(30rem,calc(100vw-2rem))] overflow-y-auto" closeTestId="board-image-close" data-testid="board-image-upload-dialog" onDragEnter={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; }} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); setDragging(false); submitFiles(Array.from(event.dataTransfer.files)); }}>
    <DialogTitle>{replacing ? "替换图片" : "添加图片"}</DialogTitle><DialogDescription>JPG、PNG、WEBP、GIF、SVG · 每张最大 25MB{replacing ? "" : " · 可一次选择多张"}</DialogDescription>
    <input ref={input} data-testid="board-image-input" className="sr-only" type="file" aria-label="上传图片" disabled={busy} multiple={!replacing} accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; submitFiles(files); }} />
    <button type="button" data-testid="board-image-dropzone" disabled={busy} className={cn("flex min-h-32 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border p-6 disabled:bg-disabled disabled:text-disabled-foreground", dragging && "border-primary bg-primary/5")} onClick={() => input.current?.click()}>{busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}<span aria-live="polite">{busy ? "正在上传" : dragging ? "松开即可上传" : "选择或拖入图片"}</span></button>
    <label className="grid gap-2 text-sm">图片地址<Input data-testid="board-image-url" aria-label="HTTPS 图片地址" disabled={busy} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
    {items.length ? <ul aria-label="图片上传进度" aria-live="polite" className="grid gap-2 text-sm">{items.map(item => <li key={item.id} className="grid gap-1"><div className="flex justify-between gap-3"><span className="min-w-0 break-all">{item.name}</span><span className="shrink-0">{{ queued: "等待上传", uploading: "正在上传", succeeded: "已添加", failed: "未添加", cancelled: "已取消" }[item.status]}</span></div>{item.error && item.status === "failed" ? <span className="text-destructive">{item.error}</span> : null}</li>)}</ul> : null}
    {error ? <div role="alert" data-testid="board-image-error" className="flex items-center justify-between gap-3 text-sm text-destructive"><span>{error}</span><Button disabled={busy} onClick={onRetry}>{items.length > 1 ? "仅重试失败图片" : "重试"}</Button></div> : null}
    <div className="flex justify-end"><Button variant="primary" disabled={busy || !url.trim()} data-testid="board-image-url-apply" onClick={() => onUrl(url.trim())}><ImagePlus className="mr-2 h-4 w-4" />{replacing ? "替换图片" : "添加图片"}</Button></div>
  </DialogContent></Dialog>;
}
