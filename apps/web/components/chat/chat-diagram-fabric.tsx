"use client";
import * as React from "react";
import { Maximize2 } from "lucide-react";
import { Canvas as FabricCanvas } from "fabric";
import {
  markdownToCanvas,
  fitToContent,
  wrapAsMermaidBlock,
} from "@repo/fabric-markdown";
import { resolveDiagramType } from "@/lib/mermaid-diagram-type";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChatDiagramCanvasModal } from "./chat-diagram-canvas-modal";

/**
 * 单个 ```mermaid 围栏在 AI 气泡内的 **fabric 渲染**（VZ-02，替换 VZ-01 的静态 SVG）。
 *
 * 用户诉求（devapp 实测）：「渲染的这个图，必须要可以最大化，必须是使用 fabricjs
 * 渲染的，修改渲染以后的内容可以保存下来。参考 packages/fabric-markdown。」
 *
 * ── 状态机：validating → (valid | error)，**先判后挂** ────────────────────────
 * 关键架构约束：fabric 会把 `<canvas>` 元素包进它自己造的 `.canvas-container` div
 * 并加一层 upper-canvas 兄弟节点。**这些 DOM 节点不是 React 建的**。若我们先挂
 * canvas、渲染后才发现语法错、再把 canvas 卸载换成错误框，React 的 reconciler 会
 * 撞上 fabric 塞进来的包裹节点，抛 `removeChild ... not a child of this node`，
 * **整页崩塌**（实测：scene=error 时 xychart 的错误框也一起消失）。
 * 因此：**先**做白名单 + `mermaid.parse` 校验（此阶段不挂任何 canvas），只有
 * 校验通过（status==="valid"）才把 `<canvas>` 挂进 DOM 并交给 fabric。错误内容
 * 从头到尾不碰 fabric → 不会有 fabric 包裹节点 → 不会崩。
 *
 * 三条出口（沿用 VZ-01 诚实契约，无静默丢弃、无崩溃、绝不留破损/空白画布）：
 * · 图类型**不在**白名单 → 错误态（不支持的图类型 + 原始围栏源）。
 * · 在白名单但 `mermaid.parse` 抛错（语法错误）→ 错误态（语法错误 + 原始围栏源）。
 * · 白名单内且 parse 通过 → 挂 canvas，`markdownToCanvas` 渲成**只读** fabric 图，
 *   `fitToContent` 适配气泡尺寸。
 *
 * 「最大化」→ 打开可编辑全屏 `ChatDiagramCanvasModal`（复用 `CanvasStage`）。
 * 复用（不重写）：`markdownToCanvas` / `fitToContent` / `wrapAsMermaidBlock`。
 * 性能：每张图一张 fabric 画布是重对象 → 按「进入视口才校验+渲染」惰性化。
 */
type Status =
  | { phase: "validating" }
  | { phase: "valid" }
  | { phase: "error"; reason: "whitelist" | "syntax"; detail: string };

export function ChatDiagramFabric({ code }: { code: string }) {
  const { rawToken, inWhitelist } = React.useMemo(() => resolveDiagramType(code), [code]);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasElRef = React.useRef<HTMLCanvasElement>(null);
  const fabricRef = React.useRef<FabricCanvas | null>(null);
  const [status, setStatus] = React.useState<Status>({ phase: "validating" });
  const [ready, setReady] = React.useState(false);
  const [inView, setInView] = React.useState(false);
  const [maximized, setMaximized] = React.useState(false);

  // 惰性化：进入视口才校验+渲染（性能——一张图一张 fabric 画布）。
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  // 阶段一：校验（**不挂 canvas**）。白名单闸门 + mermaid.parse 语法闸门（与 VZ-01 一致）。
  React.useEffect(() => {
    if (!inView) return;
    if (!inWhitelist) {
      setStatus({ phase: "error", reason: "whitelist", detail: rawToken || "（空）" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        // parse 先行：fabric 的 mermaidToModel 比 mermaid.parse 宽容，会把残缺围栏
        // 解析成「部分模型」而不抛错。若直接喂给 fabric，语法错的图会渲成半截/空白
        // 画布，违背「诚实错误态」。故让 fabric **只**看到已过 parse 的合法源。
        await mermaid.parse(code);
        if (!cancelled) setStatus({ phase: "valid" });
      } catch (e) {
        if (!cancelled)
          setStatus({
            phase: "error",
            reason: "syntax",
            detail: e instanceof Error ? e.message : String(e),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, inWhitelist, rawToken, inView]);

  // 阶段二：仅当 valid（<canvas> 已挂）时建 FabricCanvas 并渲染（只读）。
  React.useEffect(() => {
    if (status.phase !== "valid") return;
    const el = canvasElRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const width = Math.max(320, Math.floor(container.getBoundingClientRect().width) - 2);
    const canvas = new FabricCanvas(el, {
      width,
      height: 320,
      selection: false,
      skipTargetFind: true,
    });
    fabricRef.current = canvas;
    let cancelled = false;
    markdownToCanvas(wrapAsMermaidBlock(code), canvas)
      .then(() => {
        if (cancelled) return;
        canvas.forEachObject((obj) => {
          obj.selectable = false;
          obj.evented = false;
        });
        fitToContent(canvas, { padding: 24 });
        canvas.requestRenderAll();
        setReady(true);
      })
      .catch(() => {
        // parse 已通过却仍渲染失败：不切错误框（避免卸载 fabric 包裹节点崩页），
        // 仅保持画布容器、标记未就绪。parse 通过后理论上不该到这里。
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
      canvas.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.phase, code]);

  if (status.phase === "error") {
    // VZ-01 诚实错误态：testid / 结构 / 文案与 VZ-01 一致。此分支从未挂过 fabric canvas。
    return (
      <div
        data-testid="chat-ai-mermaid-error"
        data-error-reason={status.reason}
        className="my-2 overflow-hidden rounded-md border border-destructive/40 bg-destructive/5"
      >
        <div className="flex items-center gap-1.5 border-b border-destructive/30 px-2.5 py-1.5 text-11 font-medium text-destructive">
          无法渲染此图（
          {status.reason === "whitelist" ? `不支持的图类型：${status.detail}` : "语法错误"}）
        </div>
        <pre className="overflow-x-auto px-2.5 py-2 font-mono text-11 leading-relaxed text-muted-foreground">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        data-testid="chat-diagram-fabric"
        data-diagram-type={rawToken}
        data-ready={ready}
        className="group relative my-2 overflow-hidden rounded-md border border-border-subtle bg-card"
      >
        <div className="pointer-events-none absolute left-2 top-2 z-10">
          <Badge tone="outline">fabric 渲染 · 只读预览</Badge>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMaximized(true)}
          data-testid="chat-diagram-maximize"
          className="absolute right-2 top-2 z-10"
          aria-label="最大化并编辑此图"
          disabled={status.phase !== "valid"}
        >
          <Maximize2 aria-hidden className="h-3.5 w-3.5" />
          最大化
        </Button>

        {/* <canvas> 只有校验通过（valid）才挂——错误内容永不触碰 fabric（见文件头注释）。 */}
        {status.phase === "valid" ? (
          <canvas ref={canvasElRef} data-testid="chat-diagram-fabric-surface" />
        ) : (
          <div
            data-testid="chat-diagram-loading"
            className="flex h-40 items-center justify-center text-11 text-muted-foreground"
          >
            {inView ? "校验并渲染图中…" : "滚动到此处即渲染"}
          </div>
        )}
        {status.phase === "valid" && !ready && (
          <div
            data-testid="chat-diagram-loading"
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-11 text-muted-foreground"
          >
            渲染图中…
          </div>
        )}
      </div>

      {maximized && (
        <ChatDiagramCanvasModal code={code} onClose={() => setMaximized(false)} />
      )}
    </>
  );
}
