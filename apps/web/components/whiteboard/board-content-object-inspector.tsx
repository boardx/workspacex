"use client";

import { Button } from "@/components/ui/button";
import type { CanonicalContentObject, WhiteboardObject } from "@repo/whiteboard-core";
import type { ReactNode } from "react";
import { getBoardSessionImageAsset } from "./board-session-image-assets";

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
  actions?: ReactNode;
};

/** Type-specific properties stay close to the selected object, with a compact common action footer. */
export function BoardContentObjectInspector({ object, content, readOnly, onChange, onReplaceImage, onEditText, onEditStructured, onDuplicate, onDelete, actions }: Props) {
  const disabled = readOnly || object.locked === true;
  return <div className="space-y-4" data-testid="board-widget-content-actions">
    {content.type === "shape" ? <section data-testid="board-shape-properties" className="space-y-4">
      <div><h3 className="text-13 font-semibold">形状</h3><p className="mt-1 text-11 text-muted-foreground">直接调整填充、边框和透明度</p></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-12">填充色<input data-testid="board-shape-fill" aria-label="形状填充色" type="color" disabled={disabled} value={content.fill} onChange={(event) => onChange({ ...content, fill: event.target.value.toUpperCase() })} className="h-10 w-full rounded-control border border-input bg-card p-1" /></label>
        <label className="grid gap-1.5 text-12">边框颜色<input data-testid="board-shape-border-color" aria-label="形状边框颜色" type="color" disabled={disabled} value={content.borderColor} onChange={(event) => onChange({ ...content, borderColor: event.target.value.toUpperCase() })} className="h-10 w-full rounded-control border border-input bg-card p-1" /></label>
      </div>
      <label className="grid gap-2 text-12">边框粗细<span className="flex items-center gap-3"><input aria-label="形状边框粗细" type="range" min="0" max="12" step="1" disabled={disabled} value={content.borderWidth} onChange={(event) => onChange({ ...content, borderWidth: Number(event.target.value) })} className="min-w-0 flex-1" /><output>{content.borderWidth}px</output></span></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-12">线型<select aria-label="形状边框样式" disabled={disabled} value={content.borderStyle} onChange={(event) => onChange({ ...content, borderStyle: event.target.value as typeof content.borderStyle })} className="h-10 rounded-control border border-input bg-card px-2"><option value="solid">实线</option><option value="dashed">虚线</option><option value="dotted">点线</option></select></label>
        <label className="grid gap-1.5 text-12">圆角<input aria-label="形状圆角" type="number" min="0" max="100" disabled={disabled} value={content.radius} onChange={(event) => onChange({ ...content, radius: Number(event.target.value) })} className="h-10 rounded-control border border-input bg-card px-2" /></label>
      </div>
      <label className="grid gap-2 text-12">透明度<span className="flex items-center gap-3"><input aria-label="形状透明度" type="range" min="0.1" max="1" step="0.05" disabled={disabled} value={content.opacity} onChange={(event) => onChange({ ...content, opacity: Number(event.target.value) })} className="min-w-0 flex-1" /><output>{Math.round(content.opacity * 100)}%</output></span></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="grid gap-1.5 text-12">文字颜色<input aria-label="形状文字颜色" type="color" disabled={disabled} value={content.textColor} onChange={(event) => onChange({ ...content, textColor: event.target.value.toUpperCase() })} className="h-10 w-full rounded-control border border-input bg-card p-1" /></label>
        <label className="grid gap-1.5 text-12">文字对齐<select aria-label="形状文字对齐" disabled={disabled} value={content.horizontalAlign} onChange={(event) => onChange({ ...content, horizontalAlign: event.target.value as typeof content.horizontalAlign })} className="h-10 rounded-control border border-input bg-card px-2"><option value="left">靠左</option><option value="center">居中</option><option value="right">靠右</option></select></label>
      </div>
    </section> : null}

    {content.type === "image" ? <section data-testid="board-image-properties" className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/70 p-3"><div className="min-w-0"><h3 className="truncate text-13 font-semibold">{content.fileName || "图片"}</h3><p className="mt-1 text-11 text-muted-foreground">{content.intrinsicWidth} × {content.intrinsicHeight}</p></div><Button variant="secondary" size="sm" disabled={disabled} onClick={onReplaceImage}>替换</Button></div>
      <div className="flex items-center justify-between gap-2"><h3 className="text-12 font-semibold">裁剪</h3><Button variant="ghost" size="sm" disabled={disabled || (content.crop.x === 0 && content.crop.y === 0 && content.crop.width === 1 && content.crop.height === 1)} onClick={() => onChange({ ...content, crop: { x: 0, y: 0, width: 1, height: 1 } })}>重置</Button></div>
      <label className="grid gap-2 text-12">裁剪宽度<span className="flex items-center gap-3"><input aria-label="图片裁剪宽度" type="range" min="0.2" max="1" step="0.05" disabled={disabled} value={content.crop.width} onChange={(event) => { const width = Number(event.target.value); onChange({ ...content, crop: { ...content.crop, x: Math.min(content.crop.x, 1 - width), width } }); }} className="min-w-0 flex-1" /><output>{Math.round(content.crop.width * 100)}%</output></span></label>
      <label className="grid gap-2 text-12">裁剪高度<span className="flex items-center gap-3"><input aria-label="图片裁剪高度" type="range" min="0.2" max="1" step="0.05" disabled={disabled} value={content.crop.height} onChange={(event) => { const height = Number(event.target.value); onChange({ ...content, crop: { ...content.crop, y: Math.min(content.crop.y, 1 - height), height } }); }} className="min-w-0 flex-1" /><output>{Math.round(content.crop.height * 100)}%</output></span></label>
      <label className="grid gap-2 text-12">透明度<span className="flex items-center gap-3"><input aria-label="图片透明度" type="range" min="0.1" max="1" step="0.05" disabled={disabled} value={content.opacity} onChange={(event) => onChange({ ...content, opacity: Number(event.target.value) })} className="min-w-0 flex-1" /><output>{Math.round(content.opacity * 100)}%</output></span></label>
      <div className="grid grid-cols-2 gap-3"><label className="grid gap-1.5 text-12">边框颜色<input aria-label="图片边框颜色" type="color" disabled={disabled} value={content.borderColor} onChange={(event) => onChange({ ...content, borderColor: event.target.value.toUpperCase() })} className="h-10 w-full rounded-control border border-input bg-card p-1" /></label><label className="grid gap-1.5 text-12">圆角<input aria-label="图片圆角" type="number" min="0" max="100" disabled={disabled} value={content.cornerRadius} onChange={(event) => onChange({ ...content, cornerRadius: Number(event.target.value) })} className="h-10 rounded-control border border-input bg-card px-2" /></label></div>
      <label className="grid gap-2 text-12">边框粗细<span className="flex items-center gap-3"><input aria-label="图片边框粗细" type="range" min="0" max="12" step="1" disabled={disabled} value={content.borderWidth} onChange={(event) => onChange({ ...content, borderWidth: Number(event.target.value) })} className="min-w-0 flex-1" /><output>{content.borderWidth}px</output></span></label>
      {getBoardSessionImageAsset(content.assetId) ? <a className="inline-flex min-h-11 items-center rounded-control border border-border px-3 text-12 transition-colors hover:bg-accent" href={getBoardSessionImageAsset(content.assetId)!.objectUrl} download={content.fileName}>下载原图</a> : null}
    </section> : null}

    {content.type === "drawing" ? <section data-testid="board-drawing-properties" className="space-y-4"><div><h3 className="text-13 font-semibold">矢量笔迹</h3><p className="mt-1 text-11 text-muted-foreground">{content.strokes.length} 条笔画 · 保持矢量可编辑</p></div><label className="grid gap-2 text-12">笔迹透明度<span className="flex items-center gap-3"><input aria-label="笔迹透明度" type="range" min="0.1" max="1" step="0.05" disabled={disabled} value={content.strokes.find((stroke) => stroke.tool !== "eraser")?.opacity ?? 1} onChange={(event) => onChange({ ...content, strokes: content.strokes.map((stroke) => stroke.tool === "eraser" ? stroke : { ...stroke, opacity: Number(event.target.value) }) })} className="min-w-0 flex-1" /></span></label></section> : null}

    {content.type === "tile" || content.type === "web-tile" || content.type === "table" || content.type === "icon" || content.type === "template" ? <section data-testid="board-structured-content-properties" className="space-y-3"><h3 className="text-13 font-semibold">结构化内容</h3><p className="text-12 text-muted-foreground">编辑标题、说明和元数据字段</p><Button variant="secondary" disabled={disabled} onClick={onEditStructured}>编辑字段</Button></section> : null}

    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3"><Button variant="ghost" disabled={disabled} onClick={onEditText}>编辑文字</Button><Button variant="ghost" disabled={disabled} onClick={onDuplicate}>复制</Button><Button variant="ghost" className="text-destructive" disabled={disabled} onClick={onDelete}>删除</Button>{actions}</div>
  </div>;
}
