"use client";
import * as React from "react";
import { MousePointer2, Square, Spline, Trash2, Maximize, Save, X, Check } from "lucide-react";
import { wrapAsMermaidBlock, extractMermaidBlocks } from "@repo/fabric-markdown";
import { CanvasStage } from "@/components/canvas/canvas-stage";
import { decodeMermaidEntities } from "@/lib/chat/decode-mermaid-entities";
import type { CanvasTool } from "@/components/canvas/canvas-toolbar";
import { ZOOM_MIN, ZOOM_MAX } from "@/components/canvas/canvas-toolbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * 最大化 → 全屏**可编辑**画布（VZ-02 第 ② / ③ 件）。复用 `CanvasStage`
 * （readOnly=false）——它已把 fabric 编辑面全接好：拖节点 / 改标签 / ＋节点 / 删除，
 * 并在每次画布变化时经 `onMarkdownChange` 吐出「编辑后的 markdown」（就是 canvasToMarkdown
 * 的输出，也就是「保存」要落的东西）。此处不重写编辑逻辑，只提供：
 *   · 最小工具条（选择 / ＋节点 / 删除 + 适应画布），镜像 CanvasStage 支持的 tool；
 *   · 「保存」动作——原型阶段 mock 持久化：展示「会被存下来」的 mermaid 源 + 落「已保存」态。
 *
 * 真实持久化目标 = **画布 Artifact**（既有 land-as-artifact / canvas-doc 体系）：
 *   保存时把这份编辑后的 markdown 落成一个 canvas artifact 挂在消息/项目下。
 *   原型不接后端，只演示存-回环；真实接线在 design-note.md 里标注。
 */
export function ChatDiagramCanvasModal({
  code,
  onClose,
}: {
  code: string;
  onClose: () => void;
}) {
  const initialMarkdown = React.useMemo(() => wrapAsMermaidBlock(code), [code]);
  const [markdown, setMarkdown] = React.useState(initialMarkdown);
  const [tool, setTool] = React.useState<CanvasTool>("select");
  const [zoom, setZoom] = React.useState(1);
  const [saved, setSaved] = React.useState<{ mermaid: string; at: string } | null>(null);

  const dirty = markdown !== initialMarkdown;

  const handleMarkdownChange = React.useCallback((next: string) => {
    setMarkdown(next);
    setSaved(null); // 有新编辑 → 「已保存」态失效，需重新保存
  }, []);

  // ESC 关闭（全屏覆盖层的基本可达性）。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = React.useCallback(() => {
    // 保存 = 取编辑后 markdown 里的 mermaid 源（canvasToMarkdown 已在 onMarkdownChange 产出）。
    const block = extractMermaidBlocks(markdown).find((b) => b.lang === "mermaid");
    // 序列化边界解转义（main agent 决定 ④）：fabric-markdown 的 canvasToMarkdown 会把节点标签里的
    // `<`/`>`/`&`/`"` HTML 转义（`< 18 个月?` → `&lt; 18 个月?`），落盘再渲染会 mermaid 语法漂移。
    // 修在 chat 保存边界、不动 fabric-markdown 包（避免牵动其他 canvas 消费者）；真实接线沿用同一函数。
    const mermaid = decodeMermaidEntities(block?.code ?? markdown);
    // 原型：mock 持久化——展示会被落成 canvas artifact 的内容 + 落「已保存」态。
    setSaved({
      mermaid,
      at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
    });
  }, [markdown]);

  const TOOLS: { key: CanvasTool; label: string; icon: typeof Square }[] = [
    { key: "select", label: "选择", icon: MousePointer2 },
    { key: "node", label: "＋节点", icon: Square },
    { key: "edge", label: "连线", icon: Spline },
    { key: "delete", label: "删除", icon: Trash2 },
  ];

  return (
    <div
      data-testid="chat-diagram-canvas-modal"
      role="dialog"
      aria-modal="true"
      aria-label="最大化编辑图"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
    >
      {/* 顶栏：标题 + 工具条 + 保存 + 关闭 */}
      <header className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-3 py-2">
        <span className="mr-2 text-13 font-semibold">编辑图</span>
        <Badge tone="ai">fabric 可编辑</Badge>

        <div className="mx-2 h-4 w-px bg-border" aria-hidden />

        {TOOLS.map((t) => (
          <Button
            key={t.key}
            variant={tool === t.key ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTool(t.key)}
            data-testid={`chat-diagram-tool-${t.key}`}
            className={t.key === "delete" ? "text-destructive" : undefined}
          >
            <t.icon aria-hidden className="h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}

        <div className="mx-2 h-4 w-px bg-border" aria-hidden />

        <Button
          variant="ghost"
          size="icon"
          aria-label="适应画布（回到 100%）"
          title="适应画布"
          onClick={() => setZoom(1)}
          data-testid="chat-diagram-zoom-fit"
        >
          <Maximize aria-hidden className="h-3.5 w-3.5" />
        </Button>
        <span className="w-10 text-center font-mono text-10 tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {saved && (
            <Badge tone="primary" data-testid="chat-diagram-saved">
              <Check aria-hidden className="h-3 w-3" />
              已保存 · {saved.at}
            </Badge>
          )}
          {!saved && dirty && (
            <span className="text-11 text-muted-foreground" data-testid="chat-diagram-dirty">
              有未保存的改动
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={!dirty && saved !== null}
            data-testid="chat-diagram-save"
          >
            <Save aria-hidden className="h-3.5 w-3.5" />
            保存
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭"
            onClick={onClose}
            data-testid="chat-diagram-close"
          >
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 主体：可编辑画布 + 保存回环侧栏 */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasStage
            readOnly={false}
            tool={tool}
            zoom={zoom}
            markdown={markdown}
            onMarkdownChange={handleMarkdownChange}
          />
        </div>

        {/* 保存回环：展示「会被存成 canvas artifact 的 mermaid 源」（原型 mock 持久化）。*/}
        <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-card md:flex">
          <div className="border-b border-border px-3 py-2 text-12 font-medium">
            保存目标 · 画布 Artifact
            <span className="ml-1 font-normal text-muted-foreground">（原型 mock）</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {saved ? (
              <>
                <p className="mb-1.5 text-11 text-muted-foreground">
                  以下 mermaid 源会被落成一个 canvas artifact（真实接线见 design-note）：
                </p>
                <pre
                  data-testid="chat-diagram-saved-source"
                  className="overflow-x-auto rounded-md border border-border-subtle bg-panel-alt p-2 font-mono text-11 leading-relaxed text-card-foreground"
                >
                  <code>{saved.mermaid}</code>
                </pre>
              </>
            ) : (
              <p className="text-11 text-muted-foreground" data-testid="chat-diagram-save-hint">
                拖动节点、改标签、＋节点或删除后，点「保存」——这里会显示将被持久化为
                canvas artifact 的 mermaid 源。
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
