"use client";

import * as React from "react";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ApiError } from "@/lib/api-client";
import { getThreadArtifactSource } from "@/lib/live-chat";

/**
 * 产物的只读视图 —— **取源 + 三态 + 渲染**，与「摆在哪」无关。
 *
 * ## 为什么把它抽出来（2026-09-23）
 *
 * 人类交办：对标 Claude Code / Codex，「应该在右边可以打开结果」。此前产物只有一种打开
 * 方式：**模态对话框**（`ChatArtifactPreviewDialog`）。模态挡住对话，用户没法一边看结果
 * 一边追问——而那正是这两个工具最常用的姿势。
 *
 * 要让同一份产物既能摆进右栏、又能摆进模态，取源与渲染就必须只写一遍。这个组件是那一遍；
 * `ChatArtifactPreviewDialog` 从此只剩一层 `Dialog` 外壳。
 *
 * ⚠ 渲染仍然走既有 `MarkdownMessage`（react-markdown + mermaid 围栏 → fabric），与消息气泡
 * 里同一条产物源渲染出的内容**逐字一致**，不是另起一套展示逻辑。同样**不传**
 * `threadId`/`messageId`/`bearer`（`canPersist` 门槛，见 #2070）：这是「看已经落地的产物」，
 * 不是「编辑一条消息里的图表」，这里不该画第二条落地路径。
 */
export interface LoadedArtifact {
  readonly markdown: string;
  readonly version: number | null;
  readonly savedAt: string;
}

export function ChatArtifactView({
  threadId, projectId, artifactId, bearer, className, onLoaded,
}: {
  readonly threadId: string;
  /** `null` = 个人线程——同 `getThreadArtifactSource` 同名参数注释。 */
  readonly projectId: string | null;
  readonly artifactId: string;
  readonly bearer: string | undefined;
  readonly className?: string;
  /**
   * 载入成功时回一份内容给宿主。动作条（复制 / 下载）要的就是这份文本——
   * 让它自己再取一遍源会出现「看到的是 v3、复制到的是 v4」这种两处不一致。
   */
  readonly onLoaded?: (doc: LoadedArtifact | null) => void;
}): React.JSX.Element {
  const [state, setState] = React.useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; markdown: string; version: number | null; savedAt: string }
  >({ status: "loading" });

  const notify = React.useRef(onLoaded);
  notify.current = onLoaded;

  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    notify.current?.(null);
    (async () => {
      try {
        const out = await getThreadArtifactSource(threadId, artifactId, projectId, bearer);
        if (cancelled) return;
        setState({ status: "ready", markdown: out.markdown, version: out.version, savedAt: out.savedAt });
        notify.current?.({ markdown: out.markdown, version: out.version, savedAt: out.savedAt });
      } catch (e) {
        if (cancelled) return;
        // 契约错码原样回显（NOT_VISIBLE / STORAGE_UNAVAILABLE 用户的处置完全不同），
        // 不糊成一句「加载失败」——这条纪律全仓反复出现。
        setState({
          status: "error",
          message: e instanceof ApiError ? (e.reasonCode ?? `HTTP ${String(e.status)}`) : "产物加载失败",
        });
      }
    })();
    return () => { cancelled = true; };
  }, [threadId, artifactId, projectId, bearer]);

  if (state.status === "loading") {
    return (
      <p className={className} data-testid="chat-artifact-preview-loading">
        <span className="block py-6 text-center text-12 text-muted-foreground">正在加载产物…</span>
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <p className={className} data-testid="chat-artifact-preview-error">
        <span className="block py-6 text-center text-12 text-destructive">{state.message}</span>
      </p>
    );
  }
  return (
    <div className={className} data-testid="chat-artifact-preview-content">
      <MarkdownMessage text={state.markdown} />
      <p className="mt-3 text-10 text-muted-foreground">
        {state.version !== null ? `版本 ${String(state.version)} · ` : ""}
        保存于 {new Date(state.savedAt).toLocaleString()}
      </p>
    </div>
  );
}
