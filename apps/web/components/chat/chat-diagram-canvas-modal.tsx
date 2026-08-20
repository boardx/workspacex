"use client";
import * as React from "react";
import { MousePointer2, Square, Spline, Trash2, Maximize, Save, X, Check } from "lucide-react";
import { wrapAsMermaidBlock, extractMermaidBlocks } from "@repo/fabric-markdown";
import { CanvasStage } from "@/components/canvas/canvas-stage";
import { decodeMermaidEntities } from "@/lib/chat/decode-mermaid-entities";
import { describeMessageFailure, landAsArtifact } from "@/lib/live-chat";
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
 *   · 「保存」动作。
 *
 * ## 保存 = 真实调用既有 `landAsArtifact`（不新起持久化通道）
 * main agent 决定 ①（SIGNOFF-INCREMENT）：保存派生一个独立 canvas artifact（`mode:"draft"`，
 * 同 `chat-live-message-panel.tsx` 的 `submitLand` 用法——`live`/`pinned` 要求非空 citations，
 * 编辑后的图目前没有，传那两个模式会 100% 撞 `MISSING_PROVENANCE_BACKLINK`，这是后端契约
 * 现状，不是本组件的限制）。真实调用需要 `threadId`/`messageId`/`bearer` 三者俱全——
 * **调用方（`ChatDiagramFabric` → `MarkdownMessage`）没传全就退回本地 mock 演示**：
 * `/preview/chat-diagram-fabric` 这类无鉴权预览路由、以及流式草稿消息（还没有稳定
 * `messageId`）都会走这条退路，不是 bug，是刻意的降级——没有真实身份/消息可挂，
 * 硬发请求只会 100% 撞 401/404。
 */
/**
 * G1 读回（design-delta chat-persona-roundtrip，confirmed 2026-08-18）：调用方
 * （`ChatDiagramFabric`）在打开 modal 前查回的「本消息最新保存版」。有值 ⇒ modal 用
 * 保存版初始化，并显示「已加载你 X 前保存的版本」提示条 + 「回到原始版本」出口——
 * **不静默替换**，用户任何时刻能分辨在看哪个版本。无值 ⇒ 行为与从前完全一致。
 */
export interface DiagramSavedSource {
  /** 保存时落库的 mermaid 源（不带围栏，`getThreadArtifactSource.out.markdown`）。 */
  readonly markdown: string;
  /** ISO 时间戳（landing 行 created_at），提示条「X 前」的数据源。 */
  readonly savedAt: string;
}

/** 「X 前」相对时间。保存时间在未来/解析失败时如实退回绝对时间，不编一个「刚刚」。 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t) || t > now) return iso;
  const s = Math.floor((now - t) / 1000);
  if (s < 60) return `${Math.max(s, 1)} 秒`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时`;
  return `${Math.floor(s / 86400)} 天`;
}

export function ChatDiagramCanvasModal({
  code,
  onClose,
  threadId,
  messageId,
  bearer,
  savedSource,
}: {
  code: string;
  onClose: () => void;
  /** 三者俱全才真实持久化；任一缺失退回本地 mock（见文件头注释）。 */
  threadId?: string;
  messageId?: string;
  bearer?: string;
  /** ⚠ 命名避开本组件既有的 `saved` 本地 state（「本次会话里刚点过保存」）。 */
  savedSource?: DiagramSavedSource | null;
}) {
  const initialMarkdown = React.useMemo(() => wrapAsMermaidBlock(code), [code]);
  const savedMarkdown = React.useMemo(
    () => (savedSource ? wrapAsMermaidBlock(savedSource.markdown) : null),
    [savedSource],
  );
  // 有保存版 ⇒ 用保存版初始化（签核 G1：读回按最新）；viewing 记录当前看的是哪个版本，
  // 提示条 + 切换按钮让这件事对用户始终可见（硬约束：不静默替换）。
  const [viewing, setViewing] = React.useState<"saved" | "original">(
    savedMarkdown !== null ? "saved" : "original",
  );
  const [markdown, setMarkdown] = React.useState(savedMarkdown ?? initialMarkdown);
  const [tool, setTool] = React.useState<CanvasTool>("select");
  const [zoom, setZoom] = React.useState(1);
  const [saved, setSaved] = React.useState<
    { mermaid: string; at: string; artifactId: string | null } | null
  >(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const canPersist = threadId !== undefined && messageId !== undefined;

  // 「未保存改动」的基线跟着当前查看的版本走：看保存版时相对保存版比对，
  // 否则刚加载完保存版就会被误标成「有未保存的改动」。
  const baseline = viewing === "saved" && savedMarkdown !== null ? savedMarkdown : initialMarkdown;
  const dirty = markdown !== baseline;

  const revertToOriginal = React.useCallback(() => {
    setViewing("original");
    setMarkdown(initialMarkdown);
    setSaved(null);
    setSaveError(null);
  }, [initialMarkdown]);

  const backToSavedVersion = React.useCallback(() => {
    if (savedMarkdown === null) return;
    setViewing("saved");
    setMarkdown(savedMarkdown);
    setSaved(null);
    setSaveError(null);
  }, [savedMarkdown]);

  const handleMarkdownChange = React.useCallback((next: string) => {
    setMarkdown(next);
    setSaved(null); // 有新编辑 → 「已保存」态失效，需重新保存
    setSaveError(null);
  }, []);

  // ESC 关闭（全屏覆盖层的基本可达性）。
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = React.useCallback(async () => {
    // 保存 = 取编辑后 markdown 里的 mermaid 源（canvasToMarkdown 已在 onMarkdownChange 产出）。
    const block = extractMermaidBlocks(markdown).find((b) => b.lang === "mermaid");
    // 序列化边界解转义（main agent 决定 ④）：fabric-markdown 的 canvasToMarkdown 会把节点标签里的
    // `<`/`>`/`&`/`"` HTML 转义（`< 18 个月?` → `&lt; 18 个月?`），落盘再渲染会 mermaid 语法漂移。
    // 修在 chat 保存边界、不动 fabric-markdown 包（避免牵动其他 canvas 消费者）。
    const mermaid = decodeMermaidEntities(block?.code ?? markdown);
    setSaveError(null);

    if (!canPersist) {
      // 无鉴权预览 / 流式草稿：没有真实身份或消息可挂，退回本地演示（不落库）。
      setSaved({
        mermaid, artifactId: null,
        at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
      return;
    }

    setSaving(true);
    try {
      const title = `对话图 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      const result = await landAsArtifact(
        threadId!,
        { messageId: messageId!, mode: "draft", title, payloadRef: mermaid },
        bearer,
      );
      setSaved({
        mermaid, artifactId: result.artifactId,
        at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
    } catch (failure) {
      setSaveError(describeMessageFailure(failure, "保存"));
    } finally {
      setSaving(false);
    }
  }, [markdown, canPersist, threadId, messageId, bearer]);

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
          {saveError && (
            <span className="text-11 text-destructive" data-testid="chat-diagram-save-error">
              {saveError}
            </span>
          )}
          {saved && !saveError && (
            <Badge tone="primary" data-testid="chat-diagram-saved">
              <Check aria-hidden className="h-3 w-3" />
              已保存 · {saved.at}
            </Badge>
          )}
          {!saved && !saveError && dirty && (
            <span className="text-11 text-muted-foreground" data-testid="chat-diagram-dirty">
              有未保存的改动
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || (!dirty && saved !== null && saveError === null)}
            data-testid="chat-diagram-save"
          >
            <Save aria-hidden className="h-3.5 w-3.5" />
            {saving ? "保存中…" : "保存"}
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

      {/* G1 读回提示条（签核硬约束：不静默替换——始终能分辨在看保存版还是原始版）。 */}
      {savedSource && viewing === "saved" ? (
        <div
          data-testid="chat-diagram-loaded-saved"
          className="flex items-center gap-2 border-b border-border bg-panel-alt px-3 py-1.5 text-11 text-muted-foreground"
        >
          <span>已加载你 {formatRelativeTime(savedSource.savedAt)}前保存的版本</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="chat-diagram-revert-original"
            onClick={revertToOriginal}
          >
            回到原始版本
          </Button>
        </div>
      ) : null}
      {savedSource && viewing === "original" ? (
        <div
          data-testid="chat-diagram-viewing-original"
          className="flex items-center gap-2 border-b border-border bg-panel-alt px-3 py-1.5 text-11 text-muted-foreground"
        >
          <span>正在查看原始版本</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="chat-diagram-back-to-saved"
            onClick={backToSavedVersion}
          >
            回到保存版
          </Button>
        </div>
      ) : null}

      {/* 主体：可编辑画布 + 保存回环侧栏 */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasStage
            readOnly={false}
            tool={tool}
            zoom={zoom}
            onZoomChange={setZoom}
            markdown={markdown}
            onMarkdownChange={handleMarkdownChange}
          />
        </div>

        {/* 保存回环：真实接线时展示「已落成的 canvas artifact」；无法持久化（预览/流式草稿）
            时展示本地演示态，明确标出「本地演示」而非佯装已落库。 */}
        <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-card md:flex">
          <div className="border-b border-border px-3 py-2 text-12 font-medium">
            保存目标 · 画布 Artifact
            {!canPersist && (
              <span className="ml-1 font-normal text-muted-foreground">（本地演示，未接后端）</span>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {saved ? (
              <>
                <p className="mb-1.5 text-11 text-muted-foreground">
                  {saved.artifactId
                    ? <>已落成 canvas artifact（<code className="font-mono">{saved.artifactId}</code>），以下是保存的 mermaid 源：</>
                    : "以下 mermaid 源是本地演示——没有真实身份/消息可挂，未落库："}
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
