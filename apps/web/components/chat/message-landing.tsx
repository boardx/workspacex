"use client";

import * as React from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeMessageFailure, landAsArtifact } from "@/lib/live-chat";

/**
 * 「落地为产物（草稿）」—— 逐条消息把 agent 产出转成一条真实产物行。
 *
 * ## 为什么是一个独立模块（issue #2050）
 *
 * 这套控件 + 它的状态机原本长在 `chat-live-message-panel.tsx`（旧手写轨道）里面，是
 * 那个 2200 行文件的私有实现。CopilotKit v2 轨道（`copilotkit-v2-panel.tsx`）现在也要
 * 这个能力，而本仓硬约束写得很清楚：**同一事实不得声明在两处**。把状态机原样抄第二份
 * 到 v2 面板里，两条轨道的「落地」行为就会各自漂移（标题默认值、错误措辞、`mode`
 * 取值、成功后要不要重读右栏……全是会分叉的点）。所以这里抽成两条轨道**共用的一份**：
 * 展示件 `MessageLandingControls` + 状态机 `useMessageLanding`，两个都不含任何一条
 * 轨道自己的概念（不认识 `DurableMessage`，只认 `LandableMessage` 这个最小形状）。
 *
 * ## 只提供 `mode: "draft"`
 *
 * `live`/`pinned` 要求非空 citations，而 citations 的写入路径目前不存在——提供那两个
 * 选项就是摆一个必炸的按钮。这条判断是从旧轨道原样搬过来的，不是本次新下的结论。
 */

/** 落地只需要消息的这两个字段；刻意不认任何一条轨道自己的消息类型。 */
export interface LandableMessage {
  readonly id: string;
  readonly text: string;
}

export type MessageLandingState =
  | { readonly status: "form"; readonly title: string }
  | { readonly status: "submitting"; readonly title: string }
  | { readonly status: "done"; readonly title: string; readonly artifactId: string }
  | { readonly status: "error"; readonly title: string; readonly error: string };

export function defaultArtifactTitle(text: string): string {
  const firstLine = text.split("\n")[0]?.trim() ?? "";
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : (firstLine || "未命名产物");
}

/**
 * 落地状态机——两条轨道共用同一份「打开表单 / 改标题 / 取消 / 提交」逻辑。
 *
 * `threadId`/`bearer` 由调用方保证是真实值：本仓既有纪律是「`threadId`/`messageId`/
 * `bearer` 三者俱全才渲染入口」，缺任何一个就根本不该把按钮画出来（见
 * `copilotkit-v2-panel.tsx` 对这条纪律的引用），而不是画出来等它 403。
 */
export function useMessageLanding(input: {
  readonly threadId: string;
  readonly bearer: string;
  readonly onArtifactLanded?: () => void;
}): {
  readonly stateFor: (messageId: string) => MessageLandingState | undefined;
  readonly open: (message: LandableMessage) => void;
  readonly updateTitle: (messageId: string, title: string) => void;
  readonly cancel: (messageId: string) => void;
  readonly submit: (message: LandableMessage) => Promise<void>;
} {
  const [landingState, setLandingState] = React.useState<Record<string, MessageLandingState>>({});
  const { threadId, bearer, onArtifactLanded } = input;

  const open = React.useCallback((message: LandableMessage) => {
    setLandingState((current) => ({
      ...current,
      [message.id]: { status: "form", title: defaultArtifactTitle(message.text) },
    }));
  }, []);

  const updateTitle = React.useCallback((messageId: string, title: string) => {
    setLandingState((current) => {
      const existing = current[messageId];
      if (!existing || existing.status !== "form") return current;
      return { ...current, [messageId]: { ...existing, title } };
    });
  }, []);

  const cancel = React.useCallback((messageId: string) => {
    setLandingState((current) => {
      const rest = { ...current };
      delete rest[messageId];
      return rest;
    });
  }, []);

  const landingStateRef = React.useRef(landingState);
  landingStateRef.current = landingState;

  const submit = React.useCallback(async (message: LandableMessage) => {
    const entry = landingStateRef.current[message.id];
    if (!entry || entry.status !== "form") return;
    const title = entry.title.trim();
    if (title === "") return;
    setLandingState((current) => ({ ...current, [message.id]: { status: "submitting", title } }));
    try {
      const result = await landAsArtifact(
        threadId,
        { messageId: message.id, mode: "draft", title, payloadRef: message.text },
        bearer,
      );
      setLandingState((current) => ({
        ...current,
        [message.id]: { status: "done", title, artifactId: result.artifactId },
      }));
      onArtifactLanded?.();
    } catch (failure) {
      setLandingState((current) => ({
        ...current,
        [message.id]: { status: "error", title, error: describeMessageFailure(failure, "落地为产物") },
      }));
    }
  }, [threadId, bearer, onArtifactLanded]);

  const stateFor = React.useCallback(
    (messageId: string) => landingState[messageId],
    [landingState],
  );

  return { stateFor, open, updateTitle, cancel, submit };
}

/**
 * 十项 UX 缺口第 5 项（issue #708）——内联「落地为产物」控件。
 * 真实调用 `landAsArtifact`（`POST /chat/threads/:threadId/artifacts`）。
 */
export function MessageLandingControls({
  message, state, onOpen, onTitleChange, onCancel, onSubmit,
}: {
  message: LandableMessage;
  state: MessageLandingState | undefined;
  onOpen: () => void;
  onTitleChange: (title: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): JSX.Element {
  if (state === undefined) {
    return (
      // issue #2126（A续，真实 devapp 实测）—— 这个入口按钮此前是 `variant="outline"`
      // （带边框 + 卡片底色），与紧挨着它的框架自带 复制/反馈/评分 toolbar（那三个都是
      // 无边框的行内图标按钮）视觉上不对齐，读成两个不相关的区块。#2132/#2133 已经把
      // 外层容器间距从 `gap-1.5` 收紧到 `gap-1`（见 `copilotkit-v2-panel.tsx` 里
      // `V2AssistantMessageImpl` 的注释），但按钮本身的 variant 当时没有一并改——这里
      // 补上 issue 原文明确要求的那一半：换成 `ghost`（无边框、无底色，只在 hover 时
      // 才出现背景），视觉上更贴近"同一组操作的延续"而不是另起一个独立区块。
      <Button
        size="xs"
        variant="ghost"
        className="self-start text-10"
        data-testid={`chat-land-artifact-open-${message.id}`}
        onClick={onOpen}
      >
        落地为产物（草稿）
      </Button>
    );
  }

  if (state.status === "done") {
    return <LandedArtifactCard messageId={message.id} title={state.title} sourceText={message.text} />;
  }

  const busy = state.status === "submitting";
  return (
    <form
      className="flex w-full max-w-xs flex-col gap-1 rounded-md border border-border-subtle bg-card p-2"
      data-testid={`chat-land-artifact-form-${message.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="text-10 text-muted-foreground" htmlFor={`chat-land-artifact-title-${message.id}`}>
        产物标题（草稿，落地后仍可在右栏「产物」看到）
      </label>
      <input
        id={`chat-land-artifact-title-${message.id}`}
        data-testid={`chat-land-artifact-title-${message.id}`}
        className="h-7 rounded-md border border-input bg-transparent px-2 text-11"
        value={state.title}
        disabled={busy}
        onChange={(event) => onTitleChange(event.target.value)}
      />
      <div className="flex items-center gap-1">
        <Button
          size="xs"
          type="submit"
          data-testid={`chat-land-artifact-submit-${message.id}`}
          disabled={busy || state.title.trim() === ""}
        >
          {busy ? "落地中…" : "确认落地"}
        </Button>
        <Button size="xs" type="button" variant="outline" disabled={busy} onClick={onCancel}>
          取消
        </Button>
      </div>
      {state.status === "error" ? (
        <p className="text-10 text-destructive" data-testid={`chat-land-artifact-error-${message.id}`}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * #728 D7——已落地产物的结构化卡片。
 *
 * ⚠ 「展开」展开的是**这条消息本来就有的正文**（`message.text`，本地已持有，零额外
 *   请求）——不是链到一个产物详情页。本仓目前**没有**任何独立的产物查看路由，链一个
 *   不存在的页面就是判据明令禁止的「没有真实数据支撑的能力」。
 */
function LandedArtifactCard({
  messageId, title, sourceText,
}: {
  messageId: string;
  title: string;
  sourceText: string;
}): JSX.Element {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div
      className="flex w-full max-w-xs flex-col gap-1.5 rounded-md border border-border-subtle bg-card p-2"
      data-testid={`chat-land-artifact-done-${messageId}`}
    >
      <div className="flex items-center gap-1.5">
        <FileText aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-11 font-medium">{title}</p>
        <Badge tone="ai">AI</Badge>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-10 text-muted-foreground">已落地为产物（草稿）</span>
        <Button
          size="xs"
          variant="ghost"
          className="h-5 px-1.5 text-10"
          aria-expanded={expanded}
          data-testid={`chat-land-artifact-expand-${messageId}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "收起" : "展开"}
        </Button>
      </div>
      {expanded ? (
        <p
          className="whitespace-pre-wrap text-10 text-muted-foreground"
          data-testid={`chat-land-artifact-content-${messageId}`}
        >
          {sourceText}
        </p>
      ) : null}
    </div>
  );
}
