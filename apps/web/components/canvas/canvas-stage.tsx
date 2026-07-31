"use client";
import * as React from "react";
import { Canvas as FabricCanvas } from "fabric";
import {
  markdownToCanvas,
  canvasToMarkdown,
  FlowNode,
  type DiagramModel,
} from "@repo/fabric-markdown";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CanvasTool } from "./canvas-toolbar";

let nodeSeq = 0;

/**
 * 画布本体 —— **真实 mermaid 引擎渲染**（F103，替换此前「非 mermaid 渲染」的静态壳）。
 *
 * 数据链（D-08 硬约束）：`markdown`（含 mermaid 围栏）由父组件持有，是唯一事实来源。
 * 挂载/`markdown` 被**源码视图手改**（外部变化）时，重新走一次
 * `markdown → mermaid 文本 → DiagramModel → fabric` 完整解析并重渲染；
 * 画布内对象被**用户在这张画布上编辑**（拖动 / 加节点 / 删除）时，走反方向
 * `fabric → DiagramModel → mermaid 文本 → markdown`，只把变化点回写给父组件 ——
 * 用 `lastEmittedRef` 记录「这次 markdown 变化是不是我自己刚发出去的」，避免
 * 画布编辑触发的回写又被当成「外部改动」重新解析一遍、把 mermaid 自动布局出的
 * 新坐标覆盖用户刚拖好的位置（R7 ②「坐标不写回 Markdown」的直接推论：
 * 一份 markdown 可以对应多种画布坐标，不能拿它当„画布状态"的权威）。
 */
export function CanvasStage({
  readOnly,
  tool,
  zoom,
  markdown,
  onMarkdownChange,
}: {
  readOnly: boolean;
  tool: CanvasTool;
  zoom: number;
  markdown: string;
  onMarkdownChange: (next: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasElRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<FabricCanvas | null>(null);
  const lastEmittedRef = React.useRef<string>(markdown);
  const toolRef = React.useRef(tool);
  const readOnlyRef = React.useRef(readOnly);
  const markdownRef = React.useRef(markdown);
  const onMarkdownChangeRef = React.useRef(onMarkdownChange);
  const [ignoredCount, setIgnoredCount] = React.useState(0);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selectedLabel, setSelectedLabel] = React.useState<string | null>(null);

  toolRef.current = tool;
  readOnlyRef.current = readOnly;
  markdownRef.current = markdown;
  onMarkdownChangeRef.current = onMarkdownChange;

  const emit = React.useCallback((next: string) => {
    lastEmittedRef.current = next;
    onMarkdownChangeRef.current(next);
  }, []);

  const syncFromCanvas = React.useCallback(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    const next = canvasToMarkdown(canvas, markdownRef.current);
    emit(next);
  }, [emit]);

  // 挂载：创建真实 fabric.Canvas（一次）。
  React.useEffect(() => {
    const el = canvasElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const rect = container.getBoundingClientRect();
    const canvas = new FabricCanvas(el, {
      width: Math.max(600, rect.width),
      height: Math.max(400, rect.height),
      selection: true,
    });
    fabricRef.current = canvas;

    canvas.on("object:modified", syncFromCanvas);
    canvas.on("selection:created", (e) => {
      const obj = e.selected?.[0];
      setSelectedLabel(obj instanceof FlowNode ? obj.label : null);
    });
    canvas.on("selection:updated", (e) => {
      const obj = e.selected?.[0];
      setSelectedLabel(obj instanceof FlowNode ? obj.label : null);
    });
    canvas.on("selection:cleared", () => setSelectedLabel(null));

    canvas.on("mouse:down", (opt) => {
      if (readOnlyRef.current) return;
      const t = toolRef.current;
      if (opt.target) {
        if (t === "delete" && opt.target instanceof FlowNode) {
          canvas.remove(opt.target);
          canvas.fire("object:modified", { target: opt.target });
          syncFromCanvas();
        }
        return;
      }
      if (t !== "sticky" && t !== "node") return;
      const pointer = canvas.getScenePoint(opt.e);
      nodeSeq += 1;
      const id = `local-${t}-${nodeSeq}`;
      const node = new FlowNode({
        nodeId: id,
        label: t === "sticky" ? "新便签（点选可改标签）" : "新节点",
        shape: t === "sticky" ? "stadium" : "rect",
        x: pointer.x,
        y: pointer.y,
        width: 200,
        height: 60,
      });
      canvas.add(node);
      canvas.setActiveObject(node);
      syncFromCanvas();
    });

    return () => {
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncFromCanvas]);

  // markdown 变化：只有「不是我自己刚发出的那次」才重新解析并重渲染（源码手改 / 首次挂载）。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    if (markdown === lastEmittedRef.current) return;
    let cancelled = false;
    setLoading(true);
    setParseError(null);
    markdownToCanvas(markdown, canvas)
      .then(({ model }: { model: DiagramModel }) => {
        if (cancelled) return;
        lastEmittedRef.current = markdown;
        const ignored = countIgnoredFences(markdown);
        setIgnoredCount(ignored);
        setLoading(false);
        void model;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setParseError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fabricRef.current is stable after mount; re-run only when markdown text changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  // 首次挂载后立即解析一次初始 markdown（上面的 effect 依赖 markdown 不变时不会触发）。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    let cancelled = false;
    markdownToCanvas(markdown, canvas)
      .then(() => {
        if (cancelled) return;
        setIgnoredCount(countIgnoredFences(markdown));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setParseError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 缩放：滚轮缩放（R8「滚轮缩放」固定口径）以及工具条 +/−/⤢ 的 zoom prop。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.setZoom(zoom);
    canvas.requestRenderAll();
  }, [zoom]);

  // 只读态：禁用所有对象的写操作。
  React.useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas) return;
    canvas.selection = !readOnly;
    canvas.forEachObject((obj) => {
      obj.selectable = !readOnly;
      obj.evented = !readOnly;
    });
    canvas.requestRenderAll();
  }, [readOnly, loading]);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-auto bg-panel-alt"
      data-testid="canvas-stage"
      data-allow-x-scroll="画布需平移；真实引擎会做 pan/zoom"
    >
      <div className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1.5">
        <Badge tone="outline">mermaid 引擎渲染</Badge>
        <Badge tone={tool === "delete" ? "danger" : tool === "select" ? "neutral" : "primary"} data-testid="canvas-active-tool">
          当前工具：{TOOL_LABEL[tool]}
        </Badge>
        {ignoredCount > 0 && (
          <Badge tone="warning" data-testid="canvas-ignored-syntax">
            有 {ignoredCount} 条语法被忽略
          </Badge>
        )}
      </div>

      {parseError && (
        <div
          className="absolute inset-x-2 top-10 z-10 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-11 text-destructive"
          data-testid="canvas-parse-error"
        >
          源码解析失败，画布保留上一次成功渲染的内容：{parseError}
        </div>
      )}

      <div
        data-testid="canvas-surface"
        className={cn(
          "relative h-full min-h-96 w-full",
          tool === "sticky" || tool === "node" ? (readOnly ? "" : "cursor-crosshair") : "",
          tool === "delete" && !readOnly && "cursor-not-allowed",
        )}
      >
        <canvas ref={canvasElRef} data-testid="canvas-fabric-surface" />
      </div>

      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md border border-border-subtle bg-card/90 px-2 py-1">
        <p className="text-10 text-muted-foreground" data-testid="canvas-tool-hint">
          {loading
            ? "渲染中…"
            : readOnly
              ? "只读，写操作已禁用 · 可缩放查看"
              : selectedLabel
                ? `选中：${selectedLabel} · 缩放 ${Math.round(zoom * 100)}%`
                : tool === "sticky" || tool === "node"
                  ? `点画布空白处落一个${tool === "sticky" ? "便签" : "节点"} · 缩放 ${Math.round(zoom * 100)}%`
                  : tool === "delete"
                    ? "点任意节点将其删除"
                    : tool === "edge"
                      ? "连线：按住 shift 点两个节点"
                      : `点选一个对象查看 / 改标签 · 缩放 ${Math.round(zoom * 100)}%`}
        </p>
      </div>
    </div>
  );
}

const TOOL_LABEL: Record<CanvasTool, string> = {
  select: "选择",
  sticky: "＋便签",
  node: "＋节点",
  edge: "连线",
  delete: "删除",
};

/** R7 ③ 白名单忽略计数：mermaid/persona/canvas/usecase 以外的围栏语言按段计数（近似——精确名单在 F101/F102）。 */
function countIgnoredFences(markdown: string): number {
  const re = /^```(\w+)/gm;
  const known = new Set(["mermaid", "persona", "canvas", "usecase"]);
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    if (!known.has(m[1] ?? "")) count += 1;
  }
  return count;
}
