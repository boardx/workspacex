"use client";

import { BOARD_FILL_COLORS } from "./board-color-palette";
import { BoardColorSwatches, BoardRadiusPresets, BoardStrokePresets } from "./board-appearance-controls";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CanonicalContentObject, WhiteboardObject } from "@repo/whiteboard-core";
import type { ReactNode } from "react";
import { getBoardSessionImageAsset } from "./board-session-image-assets";
import { boardFileMetadata } from "./board-file-upload";

type Props = {
  object: WhiteboardObject;
  content: CanonicalContentObject;
  readOnly: boolean;
  onChange: (content: CanonicalContentObject) => void;
  onReplaceImage: () => void;
  onEditText: () => void;
  onEditStructured: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDownloadFile?: () => void;
  imageDownloadUrl?: string;
  actions?: ReactNode;
};

/** Type-specific properties stay close to the selected object, with a compact common action footer. */
export function BoardContentObjectInspector({ object, content, readOnly, onChange, onReplaceImage, onEditText, onEditStructured, onDuplicate, onDelete, onDownloadFile, imageDownloadUrl, actions }: Props) {
  const disabled = readOnly || object.locked === true;
  const file = boardFileMetadata(content);
  return <div className="space-y-3" data-testid="board-widget-content-actions">
    {content.type === "shape" ? <section data-testid="board-shape-properties" className="space-y-3">
      <div><h3 className="text-12 font-semibold">形状</h3><p className="mt-0.5 text-10 text-muted-foreground">填充、边框与透明度</p></div>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">填充色</p><BoardColorSwatches testId="board-shape-fill" colors={BOARD_FILL_COLORS} label="形状填充色" value={content.fill} disabled={disabled} onChange={(fill) => onChange({ ...content, fill })} /></div>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">边框颜色</p><BoardColorSwatches testId="board-shape-border-color" label="形状边框颜色" value={content.borderColor} disabled={disabled} onChange={(borderColor) => onChange({ ...content, borderColor })} /></div>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">边框粗细</p><BoardStrokePresets label="形状边框粗细" value={content.borderWidth} disabled={disabled} onChange={(borderWidth) => onChange({ ...content, borderWidth })} /></div>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">线型</p><div role="group" aria-label="形状边框样式" className="flex gap-1">{(["solid", "dashed", "dotted"] as const).map((borderStyle) => <Button key={borderStyle} type="button" variant="ghost" disabled={disabled} aria-label={`形状边框样式 ${borderStyle}`} aria-pressed={content.borderStyle === borderStyle} onClick={() => onChange({ ...content, borderStyle })} className={cn("h-9 flex-1 border border-transparent", content.borderStyle === borderStyle && "border-border bg-accent")}><svg aria-hidden="true" viewBox="0 0 48 16" className="h-4 w-12"><line x1="4" x2="44" y1="8" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={borderStyle === "dashed" ? "7 5" : borderStyle === "dotted" ? "1 5" : undefined} /></svg></Button>)}</div></div>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">圆角</p><BoardRadiusPresets label="形状圆角" value={content.radius} disabled={disabled} onChange={(radius) => onChange({ ...content, radius })} /></div>
      <label className="grid gap-2 text-12">透明度<span className="flex items-center gap-3"><input aria-label="形状透明度" type="range" min="0.1" max="1" step="0.05" disabled={disabled} value={content.opacity} onChange={(event) => onChange({ ...content, opacity: Number(event.target.value) })} style={{ accentColor: "hsl(var(--primary))" }} className="min-w-0 flex-1 accent-primary" /><output className="w-10 text-right text-11 tabular-nums text-muted-foreground">{Math.round(content.opacity * 100)}%</output></span></label>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">文字颜色</p><BoardColorSwatches label="形状文字颜色" value={content.textColor} disabled={disabled} onChange={(textColor) => onChange({ ...content, textColor })} /></div>
      <label className="grid gap-1 text-11">文字对齐<select aria-label="形状文字对齐" disabled={disabled} value={content.horizontalAlign} onChange={(event) => onChange({ ...content, horizontalAlign: event.target.value as typeof content.horizontalAlign })} className="h-9 rounded-md border border-input bg-card px-2"><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></label>
    </section> : null}

    {content.type === "image" ? <section data-testid="board-image-properties" className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 p-2"><div className="min-w-0"><h3 className="truncate text-12 font-semibold">{content.fileName || "图片"}</h3><p className="mt-0.5 text-10 text-muted-foreground">{content.intrinsicWidth} × {content.intrinsicHeight}</p></div><Button variant="secondary" size="sm" disabled={disabled} onClick={onReplaceImage}>替换</Button></div>
      <div className="flex items-center justify-between gap-2"><h3 className="text-12 font-semibold">裁剪</h3><Button variant="ghost" size="sm" disabled={disabled || (content.crop.x === 0 && content.crop.y === 0 && content.crop.width === 1 && content.crop.height === 1)} onClick={() => onChange({ ...content, crop: { x: 0, y: 0, width: 1, height: 1 } })}>重置</Button></div>
      <label className="grid gap-2 text-12">裁剪宽度<span className="flex items-center gap-3"><input aria-label="图片裁剪宽度" type="range" min="0.2" max="1" step="0.05" disabled={disabled} value={content.crop.width} onChange={(event) => { const width = Number(event.target.value); onChange({ ...content, crop: { ...content.crop, x: Math.min(content.crop.x, 1 - width), width } }); }} style={{ accentColor: "hsl(var(--primary))" }} className="min-w-0 flex-1 accent-primary" /><output>{Math.round(content.crop.width * 100)}%</output></span></label>
      <label className="grid gap-2 text-12">裁剪高度<span className="flex items-center gap-3"><input aria-label="图片裁剪高度" type="range" min="0.2" max="1" step="0.05" disabled={disabled} value={content.crop.height} onChange={(event) => { const height = Number(event.target.value); onChange({ ...content, crop: { ...content.crop, y: Math.min(content.crop.y, 1 - height), height } }); }} style={{ accentColor: "hsl(var(--primary))" }} className="min-w-0 flex-1 accent-primary" /><output>{Math.round(content.crop.height * 100)}%</output></span></label>
      <label className="grid gap-2 text-12">透明度<span className="flex items-center gap-3"><input aria-label="图片透明度" type="range" min="0.1" max="1" step="0.05" disabled={disabled} value={content.opacity} onChange={(event) => onChange({ ...content, opacity: Number(event.target.value) })} style={{ accentColor: "hsl(var(--primary))" }} className="min-w-0 flex-1 accent-primary" /><output>{Math.round(content.opacity * 100)}%</output></span></label>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">边框颜色</p><BoardColorSwatches label="图片边框颜色" value={content.borderColor} disabled={disabled} onChange={(borderColor) => onChange({ ...content, borderColor })} /></div>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">圆角</p><BoardRadiusPresets label="图片圆角" value={content.cornerRadius} disabled={disabled} onChange={(cornerRadius) => onChange({ ...content, cornerRadius })} /></div>
      <div className="space-y-1"><p className="text-11 font-medium text-muted-foreground">边框粗细</p><BoardStrokePresets label="图片边框粗细" value={content.borderWidth} disabled={disabled} onChange={(borderWidth) => onChange({ ...content, borderWidth })} /></div>
      {(imageDownloadUrl ?? getBoardSessionImageAsset(content.assetId)?.objectUrl) ? <a className="inline-flex min-h-11 items-center rounded-control border border-border px-3 text-12 transition-colors hover:bg-accent" href={imageDownloadUrl ?? getBoardSessionImageAsset(content.assetId)!.objectUrl} download={content.fileName}>下载</a> : null}
    </section> : null}

    {content.type === "drawing" ? <section data-testid="board-drawing-properties" className="space-y-4"><div><h3 className="text-13 font-semibold">矢量笔迹</h3><p className="mt-1 text-11 text-muted-foreground">{content.strokes.length} 条笔画 · 保持矢量可编辑</p></div><label className="grid gap-2 text-12">笔迹透明度<span className="flex items-center gap-3"><input aria-label="笔迹透明度" type="range" min="0.1" max="1" step="0.05" disabled={disabled} value={content.strokes.find((stroke) => stroke.tool !== "eraser")?.opacity ?? 1} onChange={(event) => onChange({ ...content, strokes: content.strokes.map((stroke) => stroke.tool === "eraser" ? stroke : { ...stroke, opacity: Number(event.target.value) }) })} style={{ accentColor: "hsl(var(--primary))" }} className="min-w-0 flex-1 accent-primary" /></span></label></section> : null}

    {file ? <section data-testid="board-file-properties" className="space-y-3"><h3 className="truncate text-13 font-semibold">{file.fileName}</h3><p className="break-words text-12 text-muted-foreground">{content.type === 'tile' ? content.description : ''}</p><Button data-testid="board-file-download" variant="secondary" disabled={!onDownloadFile} onClick={onDownloadFile}>下载文件</Button></section> : content.type === "tile" || content.type === "web-tile" || content.type === "table" || content.type === "icon" || content.type === "template" ? <section data-testid="board-structured-content-properties" className="space-y-3"><h3 className="text-13 font-semibold">结构化内容</h3><p className="text-12 text-muted-foreground">编辑标题、说明和元数据字段</p><Button variant="secondary" disabled={disabled} onClick={onEditStructured}>编辑字段</Button></section> : null}

    <div className="flex flex-wrap items-center gap-1 border-t border-border/70 pt-2"><Button size="sm" variant="ghost" disabled={disabled} onClick={onEditText}>编辑文字</Button><Button size="sm" variant="ghost" disabled={disabled} onClick={onDuplicate}>复制</Button><Button size="sm" variant="ghost" className="text-destructive" disabled={disabled} onClick={onDelete}>删除</Button>{actions}</div>
  </div>;
}
