"use client";

import * as React from "react";
import { FileOutput, FileText } from "lucide-react";
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
 * 展示件 `MessageLandingTrigger`（未打开时的入口，2026-08-27 起是图标）+
 * `MessageLandingPanel`（打开后的表单/提交中/出错/完成四态）+ 状态机
 * `useMessageLanding`，三者都不含任何一条轨道自己的概念（不认识 `DurableMessage`，
 * 只认 `LandableMessage` 这个最小形状）。
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
 * 十项 UX 缺口第 5 项（issue #708）——内联「落地为产物」触发按钮。
 *
 * 2026-08-27 人类反馈（对照 Claude Design 原型）：此前这是一个独占一整行的
 * outline 文字按钮（"落地为产物（草稿）"），在消息动作条（复制/反馈/评分）之外
 * 另起一行，读作与那一排不相关的东西。原型里这类附加动作是与复制/评分同一排的
 * 小图标——所以这里拆成两块：**未打开**时只是这个图标触发器，调用方把它塞进与
 * 复制/反馈同一个 flex 行；一旦打开（表单/提交中/出错/完成）交给下面
 * `MessageLandingPanel` 渲染，那三态需要的宽度（标题输入框、错误文案、结构化卡片）
 * 塞不进一排小图标，所以仍然是块级、挂在气泡下方——两个组件对应"未打开"与"已打开"
 * 两种互斥状态，不是重复渲染同一件事。
 *
 * 图标选 `FileOutput`（"产出一个文件"的直观语义），与 `LandedArtifactCard` 里
 * 表示"已经是一个产物"的 `FileText` 区分开，读者能从图标本身分辨"这是入口"还是
 * "这是结果"。
 */
export function MessageLandingTrigger({
  message, state, onOpen,
}: {
  message: LandableMessage;
  state: MessageLandingState | undefined;
  onOpen: () => void;
}): JSX.Element | null {
  // 一旦进入表单/提交中/出错/完成任一态，块级的 `MessageLandingPanel` 接管展示，
  // 这个触发器不再需要（避免同一操作出现两个可点入口）。
  if (state !== undefined) return null;
  return (
    <button
      type="button"
      data-testid={`chat-land-artifact-open-${message.id}`}
      aria-label="落地为产物（草稿）"
      title="落地为产物（草稿）"
      onClick={onOpen}
      className="inline-grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <FileOutput aria-hidden className="h-3 w-3" />
    </button>
  );
}

/**
 * 「落地为产物」表单/提交中/出错/完成四态的块级展示——只在 `state !== undefined`
 * （即 `MessageLandingTrigger` 已被点开）时渲染，需要的宽度比一排小图标大得多
 * （标题输入框、行内错误文案、结构化的已完成卡片），所以仍是气泡下方的独立块，
 * 不塞进消息动作条。
 */
export function MessageLandingPanel({
  message, state, onTitleChange, onCancel, onSubmit,
}: {
  message: LandableMessage;
  state: MessageLandingState | undefined;
  onTitleChange: (title: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): JSX.Element | null {
  // 2026-08-27（issue #2132 续）—— "未打开"态的入口已经不在这个组件里渲染：
  // 此前这里（以及更早、main 上 issue #2126 修过一次视觉的那版）画的是一个
  // outline/ghost 文字按钮"落地为产物（草稿）"，自成一行，与复制/反馈/评分不在
  // 同一视觉层级。#2126 当时只把它的 variant 从 outline 换成 ghost，缓解了边框
  // 不对齐的问题，但没解决"自成一行"本身——对照 Claude Design 原型，这类附加
  // 动作应该是消息操作条上的一个小图标，见上面 `MessageLandingTrigger`（进
  // `additionalToolbarItems`，与复制/反馈/评分同一排）。这个组件现在只负责
  // "已打开"之后的三态（表单/提交中/出错/完成），未打开时不渲染任何东西。
  if (state === undefined) return null;

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
