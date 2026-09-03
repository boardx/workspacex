"use client";
import * as React from "react";
import { MousePointer2, StickyNote, Trash2, Maximize, Save, X, Check, ImageDown, FileDown } from "lucide-react";
import { wrapAsMermaidBlock, extractMermaidBlocks, getTemplate } from "@repo/fabric-markdown";
import { CanvasStage, type CanvasStageHandle } from "@/components/canvas/canvas-stage";
import { checkCanvasFence, isCanvasFenceLang, type CanvasFenceLang } from "@/lib/canvas/canvas-fence";
import { capFenceBulletsToCapacity, sectionRenderCapacities } from "@/lib/canvas/cap-fence-bullets";
import { decodeMermaidEntities } from "@/lib/chat/decode-mermaid-entities";
import { downloadDataUrl, exportPngAsPdf } from "@/lib/canvas/export-image";
import { describeMessageFailure, landAsArtifact } from "@/lib/live-chat";
import type { CanvasTool } from "@/components/canvas/canvas-toolbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatRelativeTime } from "./chat-diagram-canvas-modal";

/**
 * 最大化 → 全屏**可编辑**工作坊画布模板（人类 2026-08-19 明确要求：之前的判断是
 * 「宁可暂时没有这个入口」，人类推翻，现在补上）。
 *
 * ## 为什么不能直接复用 `ChatDiagramCanvasModal`
 *
 * 那个 modal 处处假设 `lang === "mermaid"`：`wrapAsMermaidBlock(code)` 默认参数、
 * 保存时 `extractMermaidBlocks(...).find(b => b.lang === "mermaid")`。canvas/persona
 * 围栏塞进去会保存出一份 lang 错、内容被 mermaid 序列化器改写过的源——这正是当初
 * `chat-canvas-fabric.tsx` 文件头「没有最大化按钮」那段决定要避免的后果。本组件是
 * 同一个 `CanvasStage` 编辑器，换了三处：入参带 `lang`、保存时按 `isCanvasFenceLang`
 * 过滤围栏、工具条只留「选择/＋便签/删除」（模板的分区结构固定，没有「＋节点/连线」
 * 这两种自由画图操作）。
 *
 * ## 保存序列化的正确性
 *
 * `CanvasStage` 内部已经换用 `serializeCanvasMarkdown`（见该文件头注释）而不是上游
 * `canvasToMarkdown`——后者对 `kind:'template'` 模型的序列化有真实 bug（恒用
 * `modelToMermaid`，不认分区/便签节点）。本组件不需要重复处理这件事，它是
 * `CanvasStage` 的既有职责。
 *
 * ## 保存 = 复用既有 `landAsArtifact`（与 mermaid modal 同一条既有理由）
 * 三者俱全（threadId/messageId/bearer）才真实持久化；否则退回本地演示，不落库、
 * 不佯装已保存。G1 读回（`fetchLatestSavedDiagramSource`）是纯逻辑、与围栏语言无关，
 * 调用方（`ChatCanvasFabric`）直接复用，不需要为 canvas 围栏另写一份。
 */
export function ChatCanvasModal({
  code,
  lang,
  onClose,
  threadId,
  messageId,
  bearer,
  savedSource,
}: {
  code: string;
  lang: CanvasFenceLang;
  /**
   * 关闭时把「这次会话里最后一次成功保存（真实落库或本地演示皆算）」的围栏源带
   * 回去——调用方（`ChatCanvasFabric`）用它更新气泡里的只读预览，不然「保存」点了、
   * 「已保存」徽标也亮了，退出全屏后气泡卡片却纹丝不动（人类实测反馈：这正是本参数
   * 从 `() => void` 改成带结果的原因，同 `ChatDiagramCanvasModal` 同款修法）。没点过
   * 保存 / 保存失败就关闭 ⇒ 不传，调用方维持原样，不会把「还没保存的编辑」误当成
   * 「已保存」回填进气泡。
   */
  onClose: (result?: { markdown: string }) => void;
  /** 三者俱全才真实持久化；任一缺失退回本地 mock（见文件头注释）。 */
  threadId?: string;
  messageId?: string;
  bearer?: string;
  savedSource?: { readonly markdown: string; readonly savedAt: string } | null;
}) {
  // issue #2564：与只读预览（`chat-canvas-fabric.tsx`）同一份根因——模型实际产出的
  // 条数可能比某个分区的框实际放得下的多，vendor 引擎不裁剪，超出的便签会画进
  // 相邻分区。全屏编辑器打开时也要按这次已经校验通过（`openMaximized` 的前提）的
  // `key` 对应的已注册 spec 截一遍，不能让「最大化」看到只读预览已经修好的同一份
  // 内容又变回溢出的原始版本。
  const initialMarkdown = React.useMemo(() => {
    const check = checkCanvasFence(code, lang);
    const spec = check.ok ? getTemplate(check.key) : undefined;
    const capped = spec ? capFenceBulletsToCapacity(code, sectionRenderCapacities(spec)) : code;
    return wrapAsMermaidBlock(capped, lang);
  }, [code, lang]);
  const savedMarkdown = React.useMemo(
    () => (savedSource ? wrapAsMermaidBlock(savedSource.markdown, lang) : null),
    [savedSource, lang],
  );
  const [viewing, setViewing] = React.useState<"saved" | "original">(
    savedMarkdown !== null ? "saved" : "original",
  );
  const [markdown, setMarkdown] = React.useState(savedMarkdown ?? initialMarkdown);
  const [tool, setTool] = React.useState<CanvasTool>("select");
  const [zoom, setZoom] = React.useState(1);
  const [saved, setSaved] = React.useState<
    { source: string; at: string; artifactId: string | null } | null
  >(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const stageRef = React.useRef<CanvasStageHandle>(null);
  const [exportError, setExportError] = React.useState<string | null>(null);

  const canPersist = threadId !== undefined && messageId !== undefined;

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
    setSaved(null);
    setSaveError(null);
  }, []);

  // 关闭统一走这一个出口（ESC / 右上角 X 都调它）——带不带保存结果只取决于
  // `saved` 是否非空，不重复判断两遍。
  const closeModal = React.useCallback(() => {
    onClose(saved ? { markdown: saved.source } : undefined);
  }, [onClose, saved]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeModal]);

  const handleSave = React.useCallback(async () => {
    const block = extractMermaidBlocks(markdown).find((b) => isCanvasFenceLang(b.lang));
    // 同 mermaid modal 那条既有边界解转义（fabric 文本节点序列化时会把 `<`/`>`/`&`/`"`
    // 转成 HTML 实体，这是 fabric-markdown 序列化器的既有行为，不是本组件引入的）。
    const source = decodeMermaidEntities(block?.code ?? markdown);
    setSaveError(null);

    if (!canPersist) {
      setSaved({
        source, artifactId: null,
        at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
      return;
    }

    setSaving(true);
    try {
      const title = `工作坊画布 · ${new Date().toLocaleString("zh-CN", { hour12: false })}`;
      const result = await landAsArtifact(
        threadId!,
        { messageId: messageId!, mode: "draft", title, payloadRef: source },
        bearer,
      );
      setSaved({
        source, artifactId: result.artifactId,
        at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
    } catch (failure) {
      setSaveError(describeMessageFailure(failure, "保存"));
    } finally {
      setSaving(false);
    }
  }, [markdown, canPersist, threadId, messageId, bearer]);

  // 导出（人类要求："要可以下载，画布在前端要有 pdf，png 的导出"）——同
  // `ChatDiagramCanvasModal` 同款接线，见该文件对应注释；`CanvasStage` 自己截图
  // （内容包围盒 + viewport 复位），这里只决定文件名、把 data URL 交给下载/PDF
  // 工具函数。
  const exportFilenameBase = React.useMemo(
    () => `工作坊画布-${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}`,
    [],
  );
  const handleExportPNG = React.useCallback(() => {
    setExportError(null);
    const result = stageRef.current?.exportPNG();
    if (!result) {
      setExportError("画布是空的，没有可导出的内容");
      return;
    }
    downloadDataUrl(result.dataUrl, `${exportFilenameBase}.png`);
  }, [exportFilenameBase]);
  const handleExportPDF = React.useCallback(async () => {
    setExportError(null);
    const result = stageRef.current?.exportPNG();
    if (!result) {
      setExportError("画布是空的，没有可导出的内容");
      return;
    }
    try {
      await exportPngAsPdf(result.dataUrl, result.width, result.height, `${exportFilenameBase}.pdf`);
    } catch (failure) {
      setExportError(describeMessageFailure(failure, "导出 PDF"));
    }
  }, [exportFilenameBase]);

  const TOOLS: { key: CanvasTool; label: string; icon: typeof StickyNote }[] = [
    { key: "select", label: "选择", icon: MousePointer2 },
    { key: "sticky", label: "＋便签", icon: StickyNote },
    { key: "delete", label: "删除便签", icon: Trash2 },
  ];

  return (
    <div
      data-testid="chat-canvas-modal"
      role="dialog"
      aria-modal="true"
      aria-label="最大化编辑工作坊画布"
      className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <TooltipProvider delayDuration={200}>
      <header className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-3 py-2">
        <span className="mr-2 text-13 font-semibold">编辑工作坊画布</span>
        <Badge tone="ai">fabric 可编辑</Badge>

        <div className="mx-2 h-4 w-px bg-border" aria-hidden />

        {TOOLS.map((t) => (
          <Button
            key={t.key}
            variant={tool === t.key ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTool(t.key)}
            data-testid={`chat-canvas-tool-${t.key}`}
            className={t.key === "delete" ? "text-destructive" : undefined}
          >
            <t.icon aria-hidden className="h-3.5 w-3.5" />
            {t.label}
          </Button>
        ))}

        <div className="mx-2 h-4 w-px bg-border" aria-hidden />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="适应画布（回到 100%）"
              onClick={() => setZoom(1)}
              data-testid="chat-canvas-zoom-fit"
            >
              <Maximize aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>适应画布</TooltipContent>
        </Tooltip>
        <span className="w-10 text-center font-mono text-10 tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          {exportError && (
            <span className="text-11 text-destructive" data-testid="chat-canvas-export-error">
              {exportError}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="导出为 PNG"
                onClick={handleExportPNG}
                data-testid="chat-canvas-export-png"
              >
                <ImageDown aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>导出为 PNG</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="导出为 PDF"
                onClick={() => void handleExportPDF()}
                data-testid="chat-canvas-export-pdf"
              >
                <FileDown aria-hidden className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>导出为 PDF</TooltipContent>
          </Tooltip>
          <div className="mx-1 h-4 w-px bg-border" aria-hidden />
          {saveError && (
            <span className="text-11 text-destructive" data-testid="chat-canvas-save-error">
              {saveError}
            </span>
          )}
          {saved && !saveError && (
            <Badge tone="primary" data-testid="chat-canvas-saved">
              <Check aria-hidden className="h-3 w-3" />
              {/* 2026-09-02 人类实测："保存成功"后刷新全丢——当时其实走的是本地演示
                  （没有稳定消息身份可挂），徽标却与真实落库长得一模一样。未落库就
                  在徽标上直说，不让用户事后才发现。 */}
              {saved.artifactId === null ? `已保存（仅本地演示，刷新后丢失）· ${saved.at}` : `已保存 · ${saved.at}`}
            </Badge>
          )}
          {!saved && !saveError && dirty && (
            <span className="text-11 text-muted-foreground" data-testid="chat-canvas-dirty">
              有未保存的改动
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={saving || (!dirty && saved !== null && saveError === null)}
            data-testid="chat-canvas-save"
          >
            <Save aria-hidden className="h-3.5 w-3.5" />
            {saving ? "保存中…" : "保存"}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="关闭"
            onClick={closeModal}
            data-testid="chat-canvas-close"
          >
            <X aria-hidden className="h-4 w-4" />
          </Button>
        </div>
      </header>
      </TooltipProvider>

      {savedSource && viewing === "saved" ? (
        <div
          data-testid="chat-canvas-loaded-saved"
          className="flex items-center gap-2 border-b border-border bg-panel-alt px-3 py-1.5 text-11 text-muted-foreground"
        >
          <span>已加载你 {formatRelativeTime(savedSource.savedAt)}前保存的版本</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="chat-canvas-revert-original"
            onClick={revertToOriginal}
          >
            回到原始版本
          </Button>
        </div>
      ) : null}
      {savedSource && viewing === "original" ? (
        <div
          data-testid="chat-canvas-viewing-original"
          className="flex items-center gap-2 border-b border-border bg-panel-alt px-3 py-1.5 text-11 text-muted-foreground"
        >
          <span>正在查看原始版本</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="chat-canvas-back-to-saved"
            onClick={backToSavedVersion}
          >
            回到保存版
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasStage
            ref={stageRef}
            readOnly={false}
            tool={tool}
            zoom={zoom}
            onZoomChange={setZoom}
            markdown={markdown}
            onMarkdownChange={handleMarkdownChange}
          />
        </div>

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
                    ? <>已落成 canvas artifact（<code className="font-mono">{saved.artifactId}</code>），以下是保存的围栏源：</>
                    : "以下围栏源是本地演示——没有真实身份/消息可挂，未落库："}
                </p>
                <pre
                  data-testid="chat-canvas-saved-source"
                  className="overflow-x-auto rounded-md border border-border-subtle bg-panel-alt p-2 font-mono text-11 leading-relaxed text-card-foreground"
                >
                  <code>{saved.source}</code>
                </pre>
              </>
            ) : (
              <p className="text-11 text-muted-foreground" data-testid="chat-canvas-save-hint">
                拖动便签、改文字、＋便签或删除后，点「保存」——这里会显示将被持久化为
                canvas artifact 的围栏源。
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
