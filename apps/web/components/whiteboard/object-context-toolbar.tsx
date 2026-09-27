"use client";

import { useEffect, useState, type CSSProperties, type Ref, type ReactNode } from "react";
import { Bold, Italic, AlignLeft, Copy, Trash2, Link2, MessageCircle, Plus, Tag, X } from "lucide-react";
import { STICKY_COLOR_PRESETS, type StickyVariant, type TextAttributes, type TextStylePreset, type WhiteboardObject } from "@repo/whiteboard-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoardToolPopover } from "./board-tool-popover";
import { BoardSelectedObjectPanel } from "./board-selected-object-panel";

export interface ObjectExperience {
  tags: string[];
  reactions: Record<string, string[]>;
  linkPreview: null | { url: string; title: string; description: string };
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function readObjectExperience(object: WhiteboardObject): ObjectExperience {
  const experience = record(object.extensionData?.objectExperience);
  const tags = Array.isArray(experience.tags) ? experience.tags.filter((item): item is string => typeof item === "string").slice(0, 20) : [];
  const sourceReactions = record(experience.reactions), reactions: Record<string, string[]> = {};
  for (const [emoji, actors] of Object.entries(sourceReactions)) if (Array.isArray(actors)) reactions[emoji] = actors.filter((actor): actor is string => typeof actor === "string");
  const preview = record(experience.linkPreview);
  const linkPreview = typeof preview.url === "string" && /^https?:\/\//.test(preview.url) ? { url: preview.url, title: typeof preview.title === "string" ? preview.title : preview.url, description: typeof preview.description === "string" ? preview.description : "" } : null;
  return { tags: [...new Set(tags)], reactions, linkPreview };
}

interface ObjectContextToolbarProps {
  actions?: ReactNode;
  panelRef?: Ref<HTMLElement>;
  floatingStyle?: CSSProperties;
  onDuplicate?:()=>void; onDelete?:()=>void;
  object: WhiteboardObject;
  readOnly: boolean;
  actorId: string;
  onStickyChange: (patch: { color?: string; variant?: StickyVariant; sizing?: "auto-height" | "fixed" | "auto-size" }) => void;
  onTextChange: (patch: Partial<TextAttributes>, resetPreset?: boolean) => void;
  onStyleChange?: (style: WhiteboardObject["style"]) => void;
  onExperienceChange: (experience: ObjectExperience) => void;
  onGeometryChange: (geometry: WhiteboardObject["geometry"]) => void;
  onClose: () => void;
  onFutureAction: (kind: "comment" | "ai") => void;
}

const PRESETS: Array<{ value: TextStylePreset; label: string }> = [{ value: "title", label: "标题" }, { value: "heading", label: "一级标题" }, { value: "subheading", label: "二级标题" }, { value: "body", label: "正文" }, { value: "caption", label: "说明" }];
const REACTIONS = ["👍", "❤️", "🎉", "❓"];

const OBJECT_LABELS: Record<WhiteboardObject["kind"], string> = { sticky: "便利贴", text: "文字", rectangle: "形状", ellipse: "形状", frame: "Frame", group: "组合", connector: "连接线", image: "图片", drawing: "绘图", extension: "对象" };

export function ObjectContextToolbar({ object, readOnly, actorId, onStickyChange, onTextChange, onStyleChange, onExperienceChange, onGeometryChange, onClose, onFutureAction, actions, onDuplicate, onDelete, panelRef, floatingStyle }: ObjectContextToolbarProps) {
  const thinking = record(object.extensionData?.thinkingInput), sticky = record(thinking.sticky), text = record(thinking.text);
  const experience = readObjectExperience(object);
  const [tagDraft, setTagDraft] = useState(""), [linkUrl, setLinkUrl] = useState(experience.linkPreview?.url ?? ""), [linkTitle, setLinkTitle] = useState(experience.linkPreview?.title ?? ""), [linkDescription, setLinkDescription] = useState(experience.linkPreview?.description ?? "");
  useEffect(() => { setTagDraft(""); setLinkUrl(experience.linkPreview?.url ?? ""); setLinkTitle(experience.linkPreview?.title ?? ""); setLinkDescription(experience.linkPreview?.description ?? ""); }, [object.id, experience.linkPreview?.url, experience.linkPreview?.title, experience.linkPreview?.description]);
  const addTag = () => { const tag = tagDraft.trim().slice(0, 32); if (!tag || experience.tags.includes(tag) || experience.tags.length >= 20) return; onExperienceChange({ ...experience, tags: [...experience.tags, tag] }); setTagDraft(""); };
  const toggleReaction = (emoji: string) => { const actors = experience.reactions[emoji] ?? [], active = actors.includes(actorId); onExperienceChange({ ...experience, reactions: { ...experience.reactions, [emoji]: active ? actors.filter((id) => id !== actorId) : [...actors, actorId] } }); };
  const savePreview = () => { try { const parsed = new URL(linkUrl); if (!["http:", "https:"].includes(parsed.protocol)) return; onExperienceChange({ ...experience, linkPreview: { url: parsed.toString(), title: linkTitle.trim() || parsed.hostname, description: linkDescription.trim().slice(0, 240) } }); } catch { /* Invalid URL remains editable without mutating canonical data. */ } };
  const locked = readOnly || object.locked === true;
  const typeLabel = OBJECT_LABELS[object.kind];
  const title = object.text.trim() || (object.kind === "image" ? "图片" : object.kind === "frame" ? "未命名 Frame" : object.kind === "drawing" ? "绘图" : "未命名对象");
  const compactActions = <div role="toolbar" aria-label="对象快捷操作" data-testid="board-object-quick-actions" className="flex min-w-max items-center gap-1.5 px-1">
    {object.kind === "sticky" ? <div data-testid="board-widget-quick-format" className="flex items-center gap-1.5"><section data-testid="board-sticky-inspector-style" aria-label="便利贴快捷样式" className="flex items-center gap-1.5">
      <div role="group" aria-label="便利贴颜色" className="flex items-center gap-1">{Object.entries(STICKY_COLOR_PRESETS).slice(0, 7).map(([name, color]) => <button key={name} type="button" data-testid={`sticky-quick-color-${name}`} aria-label={`便利贴颜色 ${name}`} aria-pressed={sticky.color === color} disabled={locked} onClick={() => onStickyChange({ color })} className="h-7 w-7 shrink-0 rounded-full border border-border shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled" style={{ backgroundColor: color }} />)}</div>
      <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-border" />
      <div role="group" aria-label="便利贴形状" className="flex items-center gap-1">{(["square", "rectangle", "circle"] as const).map((variant) => <Button key={variant} size="sm" variant={sticky.variant === variant ? "primary" : "ghost"} disabled={locked} data-testid={`context-sticky-${variant}`} aria-label={({ square: "方形便利贴", rectangle: "长方形便利贴", circle: "圆形便利贴" })[variant]} title={({ square: "方形", rectangle: "长方形", circle: "圆形" })[variant]} onClick={() => onStickyChange({ variant })}>{variant === "circle" ? <span className="inline-block h-4 w-4 rounded-full border-2 border-current" /> : variant === "rectangle" ? <span className="inline-block h-3 w-5 rounded-sm border-2 border-current" /> : <span className="inline-block h-4 w-4 rounded-sm border-2 border-current" />}</Button>)}</div>
    </section></div> : object.kind === "text" ? <div data-testid="board-widget-quick-format" className="flex items-center gap-1.5"><Button variant={text.bold === true ? "primary" : "ghost"} className="h-9 min-w-9" aria-label="切换粗体" title="粗体" data-testid="board-text-quick-bold" aria-pressed={text.bold === true} disabled={locked} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", bold: text.bold !== true })}><Bold className="h-4 w-4" /></Button><Button variant={text.italic === true ? "primary" : "ghost"} className="h-9 min-w-9" aria-label="切换斜体" title="斜体" aria-pressed={text.italic === true} disabled={locked} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", italic: text.italic !== true })}><Italic className="h-4 w-4" /></Button><Button variant="ghost" className="h-9 min-w-9" aria-label="切换文字对齐" title="文字对齐" data-testid="board-text-quick-align" disabled={locked} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", alignment: text.alignment === "left" ? "center" : text.alignment === "center" ? "right" : "left" })}><AlignLeft className="h-4 w-4" /></Button></div> : <div data-testid="board-widget-quick-format" className="flex items-center gap-1.5">{(["rectangle", "ellipse", "frame"] as const).includes(object.kind as "rectangle" | "ellipse" | "frame") ? <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2 text-11 text-muted-foreground">填充色<input data-testid="board-object-fill-color" aria-label="对象填充颜色" type="color" disabled={locked} value={object.style.fill ?? "#FFFFFF"} onChange={(event) => onStyleChange?.({ ...object.style, fill: event.target.value.toUpperCase() })} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" /></label> : <span className="px-2 text-11 text-muted-foreground">{typeLabel}</span>}</div>}
    {onDuplicate ? <Button size="icon" variant="ghost" className="ml-auto h-9 w-9 shrink-0" aria-label="复制对象" title="复制对象" disabled={locked} onClick={onDuplicate}><Copy className="h-4 w-4" /></Button> : null}
    {onDelete ? <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0 text-destructive" aria-label="删除对象" title="删除对象" disabled={locked} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button> : null}{actions}
  </div>;
  return <BoardSelectedObjectPanel object={object} title={title} typeLabel={typeLabel} readOnly={locked} onClose={onClose} onGeometryChange={onGeometryChange} panelRef={panelRef} floatingStyle={floatingStyle} compactActions={compactActions}>
    <div className="space-y-4">
    <div role="toolbar" aria-label="对象快捷操作" data-testid="board-object-quick-actions" className="rounded-xl border border-border bg-card p-2 shadow-sm">
      <div data-testid="board-widget-quick-format" className="flex flex-wrap items-center gap-1.5">
      {object.kind === "sticky" ? <section data-testid="board-sticky-inspector-style" aria-label="便利贴快捷样式" className="flex w-full flex-wrap items-center gap-1.5">
        <div role="group" aria-label="便利贴颜色" className="flex items-center gap-1">{Object.entries(STICKY_COLOR_PRESETS).slice(0, 7).map(([name, color]) => <button key={name} type="button" data-testid={`sticky-quick-color-${name}`} aria-label={`便利贴颜色 ${name}`} aria-pressed={sticky.color === color} disabled={locked} onClick={() => onStickyChange({ color })} className="h-7 w-7 rounded-full border border-border shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled" style={{ backgroundColor: color }} />)}
          <input data-testid="sticky-custom-color" aria-label="便利贴自定义颜色" type="color" disabled={locked} value={typeof sticky.color === "string" ? sticky.color : STICKY_COLOR_PRESETS.yellow} onChange={(event) => onStickyChange({ color: event.target.value.toUpperCase() })} className="h-8 w-9 cursor-pointer rounded-lg border border-border bg-card p-0.5" />
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
        <div role="group" aria-label="便利贴形状" className="flex items-center gap-1">{(["square", "rectangle", "circle"] as const).map((variant) => <Button key={variant} size="sm" variant={sticky.variant === variant ? "primary" : "ghost"} disabled={locked} data-testid={`context-sticky-${variant}`} aria-label={({ square: "方形便利贴", rectangle: "长方形便利贴", circle: "圆形便利贴" })[variant]} title={({ square: "方形", rectangle: "长方形", circle: "圆形" })[variant]} onClick={() => onStickyChange({ variant })}>{variant === "circle" ? <span className="inline-block h-4 w-4 rounded-full border-2 border-current" /> : variant === "rectangle" ? <span className="inline-block h-3 w-5 rounded-sm border-2 border-current" /> : <span className="inline-block h-4 w-4 rounded-sm border-2 border-current" />}</Button>)}</div>
        {onDuplicate ? <Button size="icon" variant="ghost" className="ml-auto h-9 w-9" aria-label="复制对象" title="复制对象" disabled={locked} onClick={onDuplicate}><Copy className="h-4 w-4" /></Button> : null}
        {onDelete ? <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label="删除对象" title="删除对象" disabled={locked} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button> : null}
      </section> : object.kind === "text" ? <section aria-label="文字快捷样式" className="flex w-full flex-wrap items-center gap-1">
        <Button variant={text.bold === true ? "primary" : "ghost"} className="h-9 min-w-9" aria-label="切换粗体" title="粗体" data-testid="board-text-quick-bold" aria-pressed={text.bold === true} disabled={locked} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", bold: text.bold !== true })}><Bold className="h-4 w-4" /></Button>
        <Button variant={text.italic === true ? "primary" : "ghost"} className="h-9 min-w-9" aria-label="切换斜体" title="斜体" aria-pressed={text.italic === true} disabled={locked} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", italic: text.italic !== true })}><Italic className="h-4 w-4" /></Button>
        <Button variant="ghost" className="h-9 min-w-9" aria-label="切换文字对齐" title="文字对齐" data-testid="board-text-quick-align" disabled={locked} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", alignment: text.alignment === "left" ? "center" : text.alignment === "center" ? "right" : "left" })}><AlignLeft className="h-4 w-4" /></Button>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2 text-11 text-muted-foreground">文字色<input aria-label="快捷文字颜色" type="color" disabled={locked} value={typeof text.color === "string" ? text.color : "#242424"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", color: event.target.value.toUpperCase() })} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" /></label>
        {onDuplicate ? <Button size="icon" variant="ghost" className="ml-auto h-9 w-9" aria-label="复制对象" title="复制对象" disabled={locked} onClick={onDuplicate}><Copy className="h-4 w-4" /></Button> : null}
        {onDelete ? <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label="删除对象" title="删除对象" disabled={locked} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button> : null}
      </section> : <section aria-label={`${typeLabel}快捷操作`} data-testid="board-generic-quick-format" className="flex w-full flex-wrap items-center gap-1.5">
        {(["rectangle", "ellipse", "frame"] as const).includes(object.kind as "rectangle" | "ellipse" | "frame") ? <>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2 text-11 text-muted-foreground">填充色<input data-testid="board-object-fill-color" aria-label="对象填充颜色" type="color" disabled={locked} value={object.style.fill ?? "#FFFFFF"} onChange={(event) => onStyleChange?.({ ...object.style, fill: event.target.value.toUpperCase() })} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" /></label>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-2 text-11 text-muted-foreground">边框色<input data-testid="board-object-stroke-color" aria-label="对象边框颜色" type="color" disabled={locked} value={object.style.stroke ?? "#242424"} onChange={(event) => onStyleChange?.({ ...object.style, stroke: event.target.value.toUpperCase() })} className="h-6 w-7 cursor-pointer border-0 bg-transparent p-0" /></label>
        </> : <span className="px-2 text-11 text-muted-foreground">{typeLabel}操作</span>}
        {onDuplicate ? <Button size="icon" variant="ghost" className="ml-auto h-9 w-9" aria-label="复制对象" title="复制对象" disabled={locked} onClick={onDuplicate}><Copy className="h-4 w-4" /></Button> : null}
        {onDelete ? <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive" aria-label="删除对象" title="删除对象" disabled={locked} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button> : null}
      </section>}
      </div>
    </div>
    <details data-testid="board-widget-advanced-format" className="group rounded-xl border border-border bg-background/70">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-12 font-semibold transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><span>更多格式与协作</span><span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span></summary>
      <div className="space-y-4 border-t border-border p-3">
    {object.kind === "sticky" ? <section className="space-y-3"><h3 className="text-13 font-semibold">便利贴尺寸</h3><label className="grid gap-1 text-12">自动调整<select data-testid="sticky-sizing" aria-label="便利贴尺寸模式" disabled={locked} value={typeof sticky.sizing === "string" ? sticky.sizing : "auto-height"} onChange={(event) => onStickyChange({ sizing: event.target.value as "auto-height" | "fixed" | "auto-size" })} className="h-10 rounded-control border border-input bg-card px-2"><option value="auto-height">自动高度</option><option value="fixed">固定尺寸</option><option value="auto-size">随内容调整</option></select></label></section> : null}
    {object.kind === "text" ? <BoardToolPopover label="文字样式" trigger={<Button variant="ghost" className="min-h-11 min-w-11" data-testid="board-inspector-text" aria-label="文字样式" title="文字样式">Aa</Button>}><div className="grid gap-3">
      <label className="text-12">样式<select aria-label="文字样式" disabled={readOnly} value={typeof text.preset === "string" ? text.preset : "body"} onChange={(event) => onTextChange({ preset: event.target.value as TextStylePreset }, true)} className="ml-1 h-8 rounded-control border border-input bg-card px-2">{PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
      <label className="text-12">字体<select aria-label="字体" disabled={readOnly} value={typeof text.fontFamily === "string" ? text.fontFamily : "Noto Sans SC"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", fontFamily: event.target.value })} className="ml-1 h-8 rounded-control border border-input bg-card px-2"><option>Noto Sans SC</option><option>Noto Serif SC</option><option>JetBrains Mono</option></select></label>
      <label className="text-12">字号<input aria-label="字号" type="number" min={8} max={200} disabled={readOnly} value={typeof text.fontSize === "number" ? text.fontSize : 18} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", fontSize: Number(event.target.value) })} className="ml-1 h-8 w-16 rounded-control border border-input bg-card px-2" /></label>
      <div className="flex gap-1"><Button size="sm" aria-label="粗体" aria-pressed={text.bold === true} disabled={readOnly} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", bold: text.bold !== true })}>B</Button><Button size="sm" aria-label="斜体" aria-pressed={text.italic === true} disabled={readOnly} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", italic: text.italic !== true })}>I</Button><Button size="sm" aria-label="下划线" aria-pressed={text.underline === true} disabled={readOnly} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", underline: text.underline !== true })}>U</Button></div>
      <label className="text-12">文字颜色<input aria-label="文字颜色" type="color" disabled={readOnly} value={typeof text.color === "string" ? text.color : "#242424"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", color: event.target.value.toUpperCase() })} className="ml-1 h-8 w-9" /></label>
      <label className="text-12">对齐<select aria-label="文字对齐" disabled={readOnly} value={typeof text.alignment === "string" ? text.alignment : "left"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", alignment: event.target.value as "left" | "center" | "right" })} className="ml-1 h-8 rounded-control border border-input bg-card px-2"><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label>
      <label className="text-12">行高<input aria-label="行高" type="number" min={0.8} max={3} step={0.05} disabled={readOnly} value={typeof text.lineHeight === "number" ? text.lineHeight : 1.4} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", lineHeight: Number(event.target.value) })} className="ml-1 h-8 w-16 rounded-control border border-input bg-card px-2" /></label>
      <label className="text-12">列表<select aria-label="列表" disabled={readOnly} value={typeof text.list === "string" ? text.list : "none"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", list: event.target.value as "none" | "bullet" | "number" })} className="ml-1 h-8 rounded-control border border-input bg-card px-2"><option value="none">无</option><option value="bullet">项目符号</option><option value="number">编号</option></select></label>
      <label className="col-span-full text-12">文字链接<Input aria-label="文字链接" disabled={readOnly} defaultValue={typeof text.link === "string" ? text.link : ""} placeholder="https://" onBlur={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", link: event.target.value || null })} /></label>
    </div></BoardToolPopover> : null}
    <BoardToolPopover label="标签与链接" trigger={<Button variant="ghost" className="min-h-11 min-w-11" data-testid="board-inspector-metadata" aria-label="标签与链接" title="标签与链接"><Link2 className="h-4 w-4"/></Button>}>
    <div className="grid gap-4">
      <div><div className="flex items-center gap-1 text-12 text-muted-foreground"><Tag className="h-3.5 w-3.5" />标签</div><div className="mt-1 flex flex-wrap gap-1">{experience.tags.map((tag) => <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-11">{tag}<button aria-label={`移除标签 ${tag}`} disabled={readOnly} onClick={() => onExperienceChange({ ...experience, tags: experience.tags.filter((item) => item !== tag) })}><X className="ml-1 h-3 w-3" /></button></span>)}</div><div className="mt-1 flex gap-1"><Input aria-label="新标签" disabled={readOnly} value={tagDraft} maxLength={32} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} /><Button size="icon" aria-label="添加标签" disabled={readOnly || !tagDraft.trim()} onClick={addTag}><Plus className="h-4 w-4" /></Button></div></div>
      <div><div className="text-12 text-muted-foreground">回应</div><div className="mt-1 flex gap-1">{REACTIONS.map((emoji) => { const actors = experience.reactions[emoji] ?? []; return <Button key={emoji} size="sm" disabled={readOnly} aria-pressed={actors.includes(actorId)} aria-label={`${emoji} 回应 ${actors.length}`} onClick={() => toggleReaction(emoji)}>{emoji} {actors.length || ""}</Button>; })}</div></div>
      <div><div className="flex items-center gap-1 text-12 text-muted-foreground"><Link2 className="h-3.5 w-3.5" />链接预览</div><Input aria-label="预览链接" disabled={readOnly} value={linkUrl} placeholder="https://" onChange={(event) => setLinkUrl(event.target.value)} /><Input aria-label="预览标题" disabled={readOnly} value={linkTitle} placeholder="标题" onChange={(event) => setLinkTitle(event.target.value)} /><Input aria-label="预览描述" disabled={readOnly} value={linkDescription} placeholder="描述" onChange={(event) => setLinkDescription(event.target.value)} /><Button size="sm" disabled={readOnly || !/^https?:\/\//.test(linkUrl)} onClick={savePreview}>保存预览</Button>{experience.linkPreview ? <a href={experience.linkPreview.url} target="_blank" rel="noreferrer" className="mt-1 block rounded-control border border-border p-2 text-12 underline"><strong>{experience.linkPreview.title}</strong><span className="block text-muted-foreground">{experience.linkPreview.description || experience.linkPreview.url}</span></a> : null}</div>
    </div>
    </BoardToolPopover>
    <div className="flex items-center gap-1"><Button size="icon" className="min-h-11 min-w-11" variant="ghost" aria-label="评论" onClick={() => onFutureAction("comment")}><MessageCircle className="h-4 w-4" /></Button></div>
    {actions}
      </div>
    </details>
    {object.kind === "sticky" ? <p className="text-11 leading-relaxed text-muted-foreground">双击便利贴即可编辑文字；样式更改会实时同步给协作者。</p> : null}
    </div>
  </BoardSelectedObjectPanel>;
}
