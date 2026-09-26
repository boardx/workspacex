"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Circle,
  ExternalLink,
  Frame,
  Link2,
  LockKeyhole,
  MessageCircleHeart,
  MousePointer2,
  Redo2,
  RotateCcw,
  Sparkles,
  StickyNote,
  Type,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { BoardObjectAuthoringSurface, type AuthoringScene } from "./board-object-authoring-surface";

export type BoardObjectAuthoringScene = AuthoringScene;

const SCENES: readonly { value: AuthoringScene; label: string }[] = [
  { value: "default", label: "Default · 第一张想法" },
  { value: "continuous", label: "Continuous · 连续创作" },
  { value: "composing", label: "Composing · 中文输入" },
  { value: "resize", label: "Resize · 三种尺寸" },
  { value: "contextual", label: "Contextual · 对象工具" },
  { value: "link-failed", label: "Link failed · 安全降级" },
  { value: "readonly", label: "Readonly · 只读查看" },
  { value: "undo-conflict", label: "Undo conflict · 冲突" },
];

const sceneValues = new Set(SCENES.map(({ value }) => value));
export function isBoardObjectAuthoringScene(value: string | null | undefined): value is AuthoringScene {
  return typeof value === "string" && sceneValues.has(value as AuthoringScene);
}

interface PreviewEvent {
  readonly type: "create" | "text-splice" | "presentation" | "reaction" | "link";
  readonly objectId: string;
  readonly detail: string;
}

function mockDispatch(event: PreviewEvent): PreviewEvent {
  return Object.freeze(event);
}

export function BoardObjectAuthoringPreview({ initialScene = "default" }: { readonly initialScene?: AuthoringScene }) {
  const [scene, setScene] = React.useState(initialScene);
  const [announcement, setAnnouncement] = React.useState("便利贴已创建，文字编辑已就绪");
  const readOnly = scene === "readonly";

  const dispatch = React.useCallback((event: PreviewEvent) => {
    const accepted = mockDispatch(event);
    setAnnouncement(accepted.detail);
  }, []);

  return (
    <main className="relative h-dvh min-h-[40rem] overflow-hidden bg-background text-foreground" data-testid="board-object-authoring-preview" data-scene={scene}>
      <header className="absolute inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/studio" className="text-sm text-muted-foreground transition-colors hover:text-foreground">返回 Studio</Link>
          <span className="h-5 w-px bg-border" aria-hidden />
          <Frame className="h-5 w-5" aria-hidden />
          <strong className="truncate text-sm">产品洞察工作坊</strong>
          <span className="hidden rounded-full border border-border bg-muted px-2 py-1 text-11 text-muted-foreground md:inline">对象创作原型 · mock commands</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"><Users className="h-4 w-4" aria-hidden />3 人在线</span>
          <Select options={SCENES} value={scene} onValueChange={(value) => setScene(value as AuthoringScene)} data-testid="board-authoring-scene-picker" className="min-w-48" />
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 top-14">
        <BoardObjectAuthoringSurface scene={scene} />

        <nav className="absolute left-4 top-4 z-20 flex flex-col gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg" aria-label="白板创作工具">
          <Button variant="primary" size="icon" aria-label="选择" data-testid="board-tool-select"><MousePointer2 className="h-4 w-4" /></Button>
          <Button variant={scene === "default" || scene === "continuous" || scene === "composing" ? "primary" : "ghost"} size="icon" aria-label="便利贴，快捷键 N" data-testid="board-tool-sticky" disabled={readOnly} onClick={() => dispatch({ type: "create", objectId: "sticky-focus", detail: "便利贴已创建，文字编辑已就绪" })}><StickyNote className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="文字，快捷键 T" data-testid="board-tool-text" disabled={readOnly}><Type className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="圆形便利贴" disabled={readOnly}><Circle className="h-4 w-4" /></Button>
        </nav>

        <section className="absolute left-1/2 top-4 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card px-2 py-1.5 shadow-lg" aria-label="历史操作">
          <Button variant="ghost" size="icon" aria-label="撤销" data-testid="board-action-undo" disabled={readOnly} onClick={() => scene === "undo-conflict" ? setAnnouncement("无法撤销：另一位成员已继续编辑这个对象") : setAnnouncement("已撤销，恢复相同对象编号")}><RotateCcw className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" aria-label="重做" data-testid="board-action-redo" disabled={readOnly}><Redo2 className="h-4 w-4" /></Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          <span className="px-2 text-xs text-muted-foreground">{readOnly ? "只读 · 仍可浏览对象" : scene === "continuous" ? "11 张 · 间距 24" : "已选便利贴"}</span>
        </section>

        {(scene === "default" || scene === "composing") && <InlineEditor scene={scene} dispatch={dispatch} />}
        {(scene === "contextual" || scene === "link-failed") && <ContextualToolbar scene={scene} dispatch={dispatch} />}
        {scene === "continuous" && <ContinuousStatus />}
        {scene === "resize" && <ResizeToolbar />}
        {scene === "readonly" && <ReadOnlyNotice />}
        {scene === "undo-conflict" && <UndoConflict />}

        <PropertiesPanel scene={scene} readOnly={readOnly} dispatch={dispatch} />

        <div className="absolute bottom-4 left-4 z-20 rounded-xl border border-border bg-card px-3 py-2 shadow-lg">
          <p className="text-xs font-medium">100%</p>
          <p className="text-11 text-muted-foreground">World space · 间距 24</p>
        </div>
        <p className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-11 text-muted-foreground shadow-sm">真实 Fabric.js 7.4.0 · mock command adapter · 未连接 Yjs/服务端</p>
      </div>

      <p className="sr-only" aria-live="polite" data-testid="board-authoring-announcer">{announcement}</p>
      <output className="sr-only" data-testid="board-authoring-trace">board-ready:0 create-intent:820 caret-ready:1040 continued-count:{scene === "continuous" ? 10 : 0}</output>
    </main>
  );
}

function InlineEditor({ scene, dispatch }: { readonly scene: AuthoringScene; readonly dispatch: (event: PreviewEvent) => void }) {
  const composing = scene === "composing";
  return (
    <section className="absolute left-52 top-40 z-30 w-64 rounded-xl border-2 border-foreground bg-card p-3 shadow-xl" data-testid={composing ? "board-inline-editor-composing" : "board-inline-editor-sticky-focus"}>
      <div className="mb-2 flex items-center justify-between text-11 text-muted-foreground"><span>{composing ? "中文输入中…" : "输入想法"}</span><span>{composing ? "IME 优先" : "已自动聚焦"}</span></div>
      <Textarea aria-label="编辑便利贴 把用户的原话放在这里" defaultValue={composing ? "我们可以先从用户旅" : "把用户的原话放在这里"} className="min-h-28 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-2" onCompositionEnd={() => dispatch({ type: "text-splice", objectId: "sticky-focus", detail: "输入已确认，文字已同步到 canonical 文本" })} />
      {composing && <p className="mt-2 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground" role="status">候选：程　景　径 · Tab 暂交给输入法</p>}
    </section>
  );
}

function ContinuousStatus() {
  return <div className="absolute left-1/2 top-24 z-20 -translate-x-1/2 rounded-xl border border-border bg-card px-4 py-3 shadow-md" data-testid="board-continuous-status"><p className="text-sm font-medium">连续创作 10 / 10</p><p className="mt-1 text-xs text-muted-foreground">第一张之后按 Tab 创建 · 24px · 18.4 秒</p></div>;
}

function ResizeToolbar() {
  return <section className="absolute left-1/2 top-24 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-lg" data-testid="board-sticky-resize-mode" aria-label="便利贴尺寸模式"><Button size="sm" variant="outline">Normal</Button><Button size="sm" variant="outline">Free</Button><Button size="sm" variant="primary">Auto-height <Check className="h-3.5 w-3.5" /></Button></section>;
}

function ContextualToolbar({ scene, dispatch }: { readonly scene: AuthoringScene; readonly dispatch: (event: PreviewEvent) => void }) {
  return (
    <section className="absolute left-1/2 top-24 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card p-1.5 shadow-xl" data-testid="board-sticky-contextual-toolbar" aria-label="便利贴快捷属性">
      <Button size="sm" variant="outline">方形 <ChevronDown className="h-3.5 w-3.5" /></Button>
      <Button size="sm" variant="outline">颜色</Button>
      <Button size="sm" variant="outline">正文</Button>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <Button size="sm" variant="outline" data-testid="board-object-reaction-menu" onClick={() => dispatch({ type: "reaction", objectId: "sticky-context", detail: "已添加 👍 Reaction" })}><MessageCircleHeart className="h-4 w-4" />👍 3</Button>
      <Button size="sm" variant={scene === "link-failed" ? "primary" : "outline"} data-testid="board-object-link-editor"><Link2 className="h-4 w-4" />链接</Button>
    </section>
  );
}

function ReadOnlyNotice() {
  return <div className="absolute left-1/2 top-24 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-md" role="status"><LockKeyhole className="h-4 w-4" /><div><p className="text-sm font-medium">你正在查看只读 Board</p><p className="text-xs text-muted-foreground">仍可缩放、浏览对象和打开安全链接</p></div></div>;
}

function UndoConflict() {
  return <div className="absolute left-1/2 top-24 z-30 flex max-w-md -translate-x-1/2 items-start gap-3 rounded-xl border border-destructive bg-card p-4 shadow-lg" role="alert" data-testid="err-board-history-conflict"><AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" /><div><p className="text-sm font-semibold">无法安全撤销</p><p className="mt-1 text-xs text-muted-foreground">林珊已继续编辑这张便利贴。画布保持当前内容，没有闪回旧对象。</p><Button className="mt-3" size="sm" variant="outline">查看对象历史</Button></div></div>;
}

function PropertiesPanel({ scene, readOnly, dispatch }: { readonly scene: AuthoringScene; readonly readOnly: boolean; readonly dispatch: (event: PreviewEvent) => void }) {
  return (
    <aside className="absolute bottom-4 right-4 top-4 z-20 hidden w-72 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl lg:flex" data-testid="board-authoring-properties">
      <div className="border-b border-border p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">{scene === "contextual" ? "文字" : "便利贴"}</h2>{readOnly && <LockKeyhole className="h-4 w-4 text-muted-foreground" />}</div><p className="mt-1 text-xs text-muted-foreground">所有更改通过同一对象 command 提交</p></div>
      <div className="space-y-5 overflow-auto p-4">
        {scene === "contextual" ? <div><p className="mb-2 text-xs font-medium">文字层级</p><div className="grid grid-cols-2 gap-2"><Button size="sm" variant="primary">Heading</Button><Button size="sm" variant="outline">Body</Button><Button size="sm" variant="outline">Caption</Button><Button size="sm" variant="outline">更多样式</Button></div></div> : <div><p className="mb-2 text-xs font-medium">形状</p><div className="grid grid-cols-3 gap-2"><Button size="sm" variant="primary" disabled={readOnly}>方形</Button><Button size="sm" variant="outline" disabled={readOnly}>长方</Button><Button size="sm" variant="outline" disabled={readOnly}>圆形</Button></div></div>}
        <div><p className="mb-2 text-xs font-medium">尺寸</p><Select options={[{ value: "normal", label: "Normal" }, { value: "free", label: "Free" }, { value: "auto", label: "Auto-height" }]} value={scene === "resize" ? "auto" : "normal"} disabled={readOnly} data-testid="board-sticky-resize-mode-select" /></div>
        <div><div className="mb-2 flex items-center justify-between"><p className="text-xs font-medium">Reaction</p><span className="text-xs text-muted-foreground">4 人回应</span></div><div className="flex flex-wrap gap-2" data-testid="board-object-reaction-summary"><span className="rounded-full border border-border bg-muted px-2 py-1 text-xs">👍 3</span><span className="rounded-full border border-border bg-muted px-2 py-1 text-xs">💡 1</span></div></div>
        <LinkPreview failed={scene === "link-failed"} readOnly={readOnly} onRetry={() => dispatch({ type: "link", objectId: "sticky-link", detail: "正在重试安全链接预览" })} />
      </div>
      <div className="mt-auto border-t border-border p-4"><p className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="h-4 w-4" />Yjs canonical → Fabric projection</p></div>
    </aside>
  );
}

function LinkPreview({ failed, readOnly, onRetry }: { readonly failed: boolean; readonly readOnly: boolean; readonly onRetry: () => void }) {
  return (
    <div><p className="mb-2 text-xs font-medium">链接预览</p><div className={cn("rounded-xl border p-3", failed ? "border-destructive" : "border-border")} data-testid="board-object-link-preview">
      {failed ? <><p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="h-4 w-4 text-destructive" />预览被安全策略阻止</p><p className="mt-2 break-all text-xs text-muted-foreground">https://miro.com/templates</p><p className="mt-2 text-xs text-muted-foreground">原链接已保留。没有加载远端内容。</p><Button className="mt-3" size="sm" variant="outline" disabled={readOnly} onClick={onRetry}>重试</Button></> : <><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium">Miroverse templates</p><p className="mt-1 text-xs text-muted-foreground">Workshop templates for collaborative teams</p></div><ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" /></div><p className="mt-3 text-11 text-muted-foreground">miro.com · 安全元数据</p></>}
    </div></div>
  );
}
