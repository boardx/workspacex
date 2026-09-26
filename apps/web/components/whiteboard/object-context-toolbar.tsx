"use client";

import { useEffect, useState } from "react";
import { Bot, Link2, MessageCircle, Plus, Tag, X } from "lucide-react";
import { STICKY_COLOR_PRESETS, type StickyVariant, type TextAttributes, type TextStylePreset, type WhiteboardObject } from "@repo/whiteboard-core";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoardViewport } from "./fabric/board-fabric-object";

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
  object: WhiteboardObject;
  viewport: BoardViewport;
  readOnly: boolean;
  actorId: string;
  onStickyChange: (patch: { color?: string; variant?: StickyVariant; sizing?: "auto-height" | "fixed" | "auto-size" }) => void;
  onTextChange: (patch: Partial<TextAttributes>, resetPreset?: boolean) => void;
  onExperienceChange: (experience: ObjectExperience) => void;
  onFutureAction: (kind: "comment" | "ai") => void;
}

const PRESETS: Array<{ value: TextStylePreset; label: string }> = [{ value: "title", label: "标题" }, { value: "heading", label: "一级标题" }, { value: "subheading", label: "二级标题" }, { value: "body", label: "正文" }, { value: "caption", label: "说明" }];
const REACTIONS = ["👍", "❤️", "🎉", "❓"];

export function ObjectContextToolbar({ object, viewport, readOnly, actorId, onStickyChange, onTextChange, onExperienceChange, onFutureAction }: ObjectContextToolbarProps) {
  const thinking = record(object.extensionData?.thinkingInput), sticky = record(thinking.sticky), text = record(thinking.text);
  const experience = readObjectExperience(object);
  const [tagDraft, setTagDraft] = useState(""), [linkUrl, setLinkUrl] = useState(experience.linkPreview?.url ?? ""), [linkTitle, setLinkTitle] = useState(experience.linkPreview?.title ?? ""), [linkDescription, setLinkDescription] = useState(experience.linkPreview?.description ?? "");
  useEffect(() => { setTagDraft(""); setLinkUrl(experience.linkPreview?.url ?? ""); setLinkTitle(experience.linkPreview?.title ?? ""); setLinkDescription(experience.linkPreview?.description ?? ""); }, [object.id, experience.linkPreview?.url, experience.linkPreview?.title, experience.linkPreview?.description]);
  const addTag = () => { const tag = tagDraft.trim().slice(0, 32); if (!tag || experience.tags.includes(tag) || experience.tags.length >= 20) return; onExperienceChange({ ...experience, tags: [...experience.tags, tag] }); setTagDraft(""); };
  const toggleReaction = (emoji: string) => { const actors = experience.reactions[emoji] ?? [], active = actors.includes(actorId); onExperienceChange({ ...experience, reactions: { ...experience.reactions, [emoji]: active ? actors.filter((id) => id !== actorId) : [...actors, actorId] } }); };
  const savePreview = () => { try { const parsed = new URL(linkUrl); if (!["http:", "https:"].includes(parsed.protocol)) return; onExperienceChange({ ...experience, linkPreview: { url: parsed.toString(), title: linkTitle.trim() || parsed.hostname, description: linkDescription.trim().slice(0, 240) } }); } catch { /* Invalid URL remains editable without mutating canonical data. */ } };
  const style = { left: (object.geometry.x + object.geometry.width / 2) * viewport.zoom + viewport.panX, top: object.geometry.y * viewport.zoom + viewport.panY - 12 };
  return <aside data-testid="board-context-toolbar" aria-label={`${object.kind === "sticky" ? "便利贴" : "文字"}快捷工具`} className="absolute z-30 max-h-[45vh] w-[min(94vw,62rem)] -translate-x-1/2 -translate-y-full overflow-auto rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur" style={style}>
    {object.kind === "sticky" ? <div className="flex flex-wrap items-center gap-2">
      <span className="text-12 text-muted-foreground">颜色</span>{Object.entries(STICKY_COLOR_PRESETS).map(([name, color]) => <button key={name} type="button" data-testid={`sticky-color-${name}`} aria-label={`便利贴颜色 ${name}`} disabled={readOnly} onClick={() => onStickyChange({ color })} className="h-7 w-7 rounded-full border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:bg-disabled" style={{ backgroundColor: color }} />)}
      <label className="text-12">自定义色<input data-testid="sticky-custom-color" aria-label="便利贴自定义颜色" type="color" disabled={readOnly} value={typeof sticky.color === "string" ? sticky.color : "#F8D76E"} onChange={(event) => onStickyChange({ color: event.target.value.toUpperCase() })} className="ml-1 h-8 w-9" /></label>
      <span className="text-12 text-muted-foreground">形状</span>{(["square", "rectangle", "circle"] as const).map((variant) => <Button key={variant} size="sm" variant={sticky.variant === variant ? "primary" : "secondary"} disabled={readOnly} data-testid={`context-sticky-${variant}`} onClick={() => onStickyChange({ variant })}>{({ square: "方形", rectangle: "长方形", circle: "圆形" })[variant]}</Button>)}
      <label className="text-12">尺寸<select data-testid="sticky-sizing" aria-label="便利贴尺寸模式" disabled={readOnly} value={typeof sticky.sizing === "string" ? sticky.sizing : "auto-height"} onChange={(event) => onStickyChange({ sizing: event.target.value as "auto-height" | "fixed" | "auto-size" })} className="ml-1 h-8 rounded-control border border-input bg-card px-2"><option value="auto-height">自动高度</option><option value="fixed">固定尺寸</option><option value="auto-size">自动尺寸</option></select></label>
    </div> : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-12">样式<select aria-label="文字样式" disabled={readOnly} value={typeof text.preset === "string" ? text.preset : "body"} onChange={(event) => onTextChange({ preset: event.target.value as TextStylePreset }, true)} className="ml-1 h-8 rounded-control border border-input bg-card px-2">{PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}</select></label>
      <label className="text-12">字体<select aria-label="字体" disabled={readOnly} value={typeof text.fontFamily === "string" ? text.fontFamily : "Noto Sans SC"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", fontFamily: event.target.value })} className="ml-1 h-8 rounded-control border border-input bg-card px-2"><option>Noto Sans SC</option><option>Noto Serif SC</option><option>JetBrains Mono</option></select></label>
      <label className="text-12">字号<input aria-label="字号" type="number" min={8} max={200} disabled={readOnly} value={typeof text.fontSize === "number" ? text.fontSize : 18} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", fontSize: Number(event.target.value) })} className="ml-1 h-8 w-16 rounded-control border border-input bg-card px-2" /></label>
      <div className="flex gap-1"><Button size="sm" aria-label="粗体" aria-pressed={text.bold === true} disabled={readOnly} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", bold: text.bold !== true })}>B</Button><Button size="sm" aria-label="斜体" aria-pressed={text.italic === true} disabled={readOnly} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", italic: text.italic !== true })}>I</Button><Button size="sm" aria-label="下划线" aria-pressed={text.underline === true} disabled={readOnly} onClick={() => onTextChange({ preset: (text.preset as TextStylePreset) || "body", underline: text.underline !== true })}>U</Button></div>
      <label className="text-12">文字颜色<input aria-label="文字颜色" type="color" disabled={readOnly} value={typeof text.color === "string" ? text.color : "#242424"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", color: event.target.value.toUpperCase() })} className="ml-1 h-8 w-9" /></label>
      <label className="text-12">对齐<select aria-label="文字对齐" disabled={readOnly} value={typeof text.alignment === "string" ? text.alignment : "left"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", alignment: event.target.value as "left" | "center" | "right" })} className="ml-1 h-8 rounded-control border border-input bg-card px-2"><option value="left">左</option><option value="center">中</option><option value="right">右</option></select></label>
      <label className="text-12">行高<input aria-label="行高" type="number" min={0.8} max={3} step={0.05} disabled={readOnly} value={typeof text.lineHeight === "number" ? text.lineHeight : 1.4} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", lineHeight: Number(event.target.value) })} className="ml-1 h-8 w-16 rounded-control border border-input bg-card px-2" /></label>
      <label className="text-12">列表<select aria-label="列表" disabled={readOnly} value={typeof text.list === "string" ? text.list : "none"} onChange={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", list: event.target.value as "none" | "bullet" | "number" })} className="ml-1 h-8 rounded-control border border-input bg-card px-2"><option value="none">无</option><option value="bullet">项目符号</option><option value="number">编号</option></select></label>
      <label className="col-span-full text-12">文字链接<Input aria-label="文字链接" disabled={readOnly} defaultValue={typeof text.link === "string" ? text.link : ""} placeholder="https://" onBlur={(event) => onTextChange({ preset: (text.preset as TextStylePreset) || "body", link: event.target.value || null })} /></label>
    </div>}
    <div className="mt-3 grid gap-2 border-t border-border pt-3 lg:grid-cols-3">
      <div><div className="flex items-center gap-1 text-12 text-muted-foreground"><Tag className="h-3.5 w-3.5" />标签</div><div className="mt-1 flex flex-wrap gap-1">{experience.tags.map((tag) => <span key={tag} className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-11">{tag}<button aria-label={`移除标签 ${tag}`} disabled={readOnly} onClick={() => onExperienceChange({ ...experience, tags: experience.tags.filter((item) => item !== tag) })}><X className="ml-1 h-3 w-3" /></button></span>)}</div><div className="mt-1 flex gap-1"><Input aria-label="新标签" disabled={readOnly} value={tagDraft} maxLength={32} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} /><Button size="icon" aria-label="添加标签" disabled={readOnly || !tagDraft.trim()} onClick={addTag}><Plus className="h-4 w-4" /></Button></div></div>
      <div><div className="text-12 text-muted-foreground">回应</div><div className="mt-1 flex gap-1">{REACTIONS.map((emoji) => { const actors = experience.reactions[emoji] ?? []; return <Button key={emoji} size="sm" disabled={readOnly} aria-pressed={actors.includes(actorId)} aria-label={`${emoji} 回应 ${actors.length}`} onClick={() => toggleReaction(emoji)}>{emoji} {actors.length || ""}</Button>; })}</div></div>
      <div><div className="flex items-center gap-1 text-12 text-muted-foreground"><Link2 className="h-3.5 w-3.5" />链接预览</div><Input aria-label="预览链接" disabled={readOnly} value={linkUrl} placeholder="https://" onChange={(event) => setLinkUrl(event.target.value)} /><Input aria-label="预览标题" disabled={readOnly} value={linkTitle} placeholder="标题" onChange={(event) => setLinkTitle(event.target.value)} /><Input aria-label="预览描述" disabled={readOnly} value={linkDescription} placeholder="描述" onChange={(event) => setLinkDescription(event.target.value)} /><Button size="sm" disabled={readOnly || !/^https?:\/\//.test(linkUrl)} onClick={savePreview}>保存预览</Button>{experience.linkPreview ? <a href={experience.linkPreview.url} target="_blank" rel="noreferrer" className="mt-1 block rounded-control border border-border p-2 text-12 underline"><strong>{experience.linkPreview.title}</strong><span className="block text-muted-foreground">{experience.linkPreview.description || experience.linkPreview.url}</span></a> : null}</div>
    </div>
    <div className="mt-2 flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => onFutureAction("comment")}><MessageCircle className="h-4 w-4" />评论</Button><Button size="sm" variant="ghost" onClick={() => onFutureAction("ai")}><Bot className="h-4 w-4" />AI</Button></div>
  </aside>;
}
