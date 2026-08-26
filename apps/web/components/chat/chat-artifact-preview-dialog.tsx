"use client";

import * as React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ApiError } from "@/lib/api-client";
import { getThreadArtifactSource } from "@/lib/live-chat";

/**
 * issue #2099（真实 devapp 实测：右栏「产物」列表点了没反应）—— 根因调查确认这从来
 * 不是回归，是两条轨道（`copilotkit-v2-shell.tsx`/旧轨道 `chat-read-screen.tsx`
 * 共用同一份 `ChatArtifactsPanel`）都从未实现过的功能：条目只是纯展示 `<div>`，
 * 没有任何 `onClick`/预览挂载。真正能取回产物源的读端口
 * （`getThreadArtifactSource`，`GET /chat/threads/:threadId/artifacts/:artifactId/source`）
 * 全仓此前只被消息气泡内联图表的「最大化」编辑弹窗调用，从未被右栏产物列表调用过。
 *
 * 这个组件只做**只读预览**：取回 `markdown` 字段，走既有 `MarkdownMessage`
 * （react-markdown + mermaid 围栏 → fabric 渲染）渲染——与消息气泡里同一条产物源
 * 渲染成的内容逐字一致，不是另起一套展示逻辑。**不传** `threadId`/`messageId`/
 * `bearer` 给 `MarkdownMessage`（`canPersist` 门槛，见 issue #2070）：这是"看别人
 * /自己已经落地的产物"，不是"正在编辑一条消息里的图表"，不该在这里画一个"保存"
 * 入口——那会画出第二条、语义不清的落地路径。
 */
export function ChatArtifactPreviewDialog({
  threadId,
  projectId,
  artifactId,
  title,
  bearer,
  onClose,
}: {
  threadId: string;
  /** `null` = 个人线程——同 `getThreadArtifactSource` 同名参数注释。 */
  projectId: string | null;
  artifactId: string;
  title: string;
  bearer: string | undefined;
  onClose: () => void;
}): JSX.Element {
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; markdown: string; version: number | null; savedAt: string }
  >({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const out = await getThreadArtifactSource(threadId, artifactId, projectId, bearer);
        if (cancelled) return;
        setState({ status: "ready", markdown: out.markdown, version: out.version, savedAt: out.savedAt });
      } catch (e) {
        if (cancelled) return;
        // 契约错码：NOT_VISIBLE（他人草稿/不存在，同一出口）、STORAGE_UNAVAILABLE
        // （字节存储读不回）——原样回显 reasonCode，不糊成一句「加载失败」（同一条
        // 纪律全仓反复出现：用户对这两种失败的处置完全不同）。
        setState({
          status: "error",
          message: e instanceof ApiError ? (e.reasonCode ?? `HTTP ${e.status}`) : "产物加载失败",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, artifactId, projectId, bearer]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto" data-testid="chat-artifact-preview-dialog">
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
        </DialogHeader>
        {state.status === "loading" ? (
          <p className="py-6 text-center text-12 text-muted-foreground" data-testid="chat-artifact-preview-loading">
            正在加载产物…
          </p>
        ) : state.status === "error" ? (
          <p className="py-6 text-center text-12 text-destructive" data-testid="chat-artifact-preview-error">
            {state.message}
          </p>
        ) : (
          <div data-testid="chat-artifact-preview-content">
            <MarkdownMessage text={state.markdown} />
            <p className="mt-3 text-10 text-muted-foreground">
              {state.version !== null ? `版本 ${state.version} · ` : ""}
              保存于 {new Date(state.savedAt).toLocaleString()}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
