"use client";

import * as React from "react";
import { CopilotChatUserMessage } from "@copilotkit/react-core/v2";
import { MessageAttachments } from "@/components/chat/chat-composer-attachments";
import type { ChatAttachment } from "@/lib/live-chat";
import {
  useCopilotKitV2MessageActions,
  CopilotKitV2RememberMessageButton,
} from "@/components/chat/copilotkit-v2-message-actions";
import { MESSAGE_ANCHOR_ATTR } from "@/lib/chat-message-focus";
import { ExtractionFeedbackChip } from "@/components/chat/knowledge/extraction-feedback-chip";

/**
 * issue #2787（review #2787 结论，回指 issue #728 同类根因）—— `userMessage` slot
 * 此前完全没有本仓自己的替换实现：`copilotkit-v2-panel-body.tsx` 只给
 * `CopilotChatMessageView` 接了 `assistantMessage={V2AssistantMessage}`
 * （`copilotkit-v2-assistant-message.tsx`），`userMessage` 一直是
 * `@copilotkit/react-core/v2` 框架自带的默认实现。
 *
 * 框架默认 `CopilotChatUserMessage.MessageRenderer`（读编译产物
 * `dist/copilotkit-nRjRp2_5.mjs` 确认）正文容器的 className 是
 * `cpk:prose cpk:dark:prose-invert cpk:bg-muted cpk:relative cpk:max-w-[80%]
 * cpk:rounded-[18px] cpk:px-4 cpk:py-1.5 cpk:data-[multiline]:py-3
 * cpk:inline-block cpk:whitespace-pre-wrap`——**没有任何字号工具类**，字号本应
 * 完全来自框架自带 Tailwind v4 编译产物 `@copilotkit/react-core/v2/index.css`
 * 里 `cpk:prose` 的基准字号。而这份 CSS 被 `next.config.mjs` 的
 * `NormalModuleReplacementPlugin` 整体替换成空文件（DA-19 决策：那时
 * `assistantMessage`/`reasoningMessage` 都还没有真实内容需要它，见
 * `app/chat/copilotkit-v2/layout.tsx:12-24`），`cpk:*` 类因此在浏览器里没有
 * 任何对应规则，正文回落到浏览器/`<body>` 默认字号——不在 `lib/font-scale.ts`
 * 的档位序列里，`lint-design.sh` §1.2 的 `text-<数字>` 扫描也扫不到第三方包
 * JSX 里的类名，两层门禁都盖不到这条路径。
 *
 * 气泡外壳（背景/圆角/内边距）本身不受影响——`app/chat/copilotkit-v2/
 * copilotkit-v2.css` 已经绕过失效的 `cpk:*` 类，直接锚定框架输出的稳定
 * `data-testid="copilot-user-message"` 补了一套气泡样式（`bg-secondary` +
 * 圆角 + `padding`）；本文件不重复这一层，只补正文本身缺失的字号/文字色。
 *
 * 修法与 `copilotkit-v2-assistant-message.tsx` 的 `V2AssistantMessage` 同一条
 * 思路——`assistantMessage` slot 早已经过 `V2AssistantMessage` 换成本仓
 * `MarkdownMessage`（`chat-markdown text-13 text-card-foreground` 容器），
 * 这里让 `userMessage` 也接一个本仓自己的 `messageRenderer`，取同一档
 * `text-13`（`lib/font-scale.ts` 唯一事实源），与 AI 侧正文同一字号，只是
 * 文字色换成气泡底色 `--secondary` 配对的 `--secondary-foreground`（与
 * `components/ui/button.tsx` 的 `secondary` 变体同一组语义 token 配对，不是
 * 新造一组）。
 *
 * 不重写整个 `CopilotChatUserMessage`：复制/编辑/分支切换等其余部分继续用
 * 框架自带实现，本组件只换 `messageRenderer` 这一个子 slot——与
 * `V2AssistantMessage` 只换 `markdownRenderer`/`copyButton`/`toolCallsView`
 * 等指定子 slot、不另起一套气泡外壳，是同一条纪律。
 */

/* ── 消息气泡上的附件 ──────────────────────────────────────────────────── */

/**
 * 2026-09-15 人类实测反馈（截图）——「文件在 chat 提交完以后，应该要在 message 上，
 * 而不是在 chat composer 上」。v2 工作台此前只有旧轨道
 * （`chat-live-message-panel.tsx`）有「消息气泡下的附件」这一件，v2 的 `userMessage`
 * slot 从来没接过：附件发出去以后，用户能看到它的唯一地方仍是 composer 里那张
 * pending 预览卡，看起来像"还没发出去"。
 *
 * 这里接的是同一个展示件 `MessageAttachments`（`chat-composer-attachments.tsx`），
 * 不为 v2 另写一份附件卡片。
 *
 * ⚠ 为什么走 context 而不是 props：框架 `CopilotChatUserMessage.MessageRenderer`
 * 的 props 只有 `{ content, className }`（读 `dist/copilotkit-D0aAnD3i.d.mts` 的
 * 类型声明确认，不是猜测）——slot 内部够不着 `message.id`，而"这条消息带了哪些
 * 附件"必须按 id 查。所以由外面这一层（拿得到 `props.message.id`）解析好之后，
 * 经一层不产生任何 DOM 的 provider 递给 slot 本体。
 */
interface UserMessageAttachmentsValue {
  /** 附件预览/下载要打到的真实线程（`MessageAttachments` 的弹窗预览需要）。 */
  readonly threadId: string;
  /**
   * 视图消息 id → 该消息的附件行。键既可能是乐观插入时的 `clientMessageId`，
   * 也可能是历史回读后的真实主键——两者都是"同一条消息"在不同时刻的视图 id，
   * 由填这张表的一方（`copilotkit-v2-panel-body.tsx`）负责两个键都指向同一批行。
   */
  readonly byMessageId: ReadonlyMap<string, readonly ChatAttachment[]>;
  /**
   * issue #4180 —— 本会话真的发出去过的用户消息（视图 id，即乐观插入时的 `clientMessageId`）。
   * 「刚被抽取出新知识」的反馈条只对这些消息轮询，不对 hydration 回读的整段历史轮询
   * （见 `copilotkit-v2-panel-body.tsx` `sentMessageIds` 的头注）。
   */
  readonly sentThisSession: ReadonlySet<string>;
}

export const UserMessageAttachmentsCtx =
  React.createContext<UserMessageAttachmentsValue | null>(null);

/** 当前正在渲染的这一条消息的附件（由 `V2UserMessageImpl` 解析后下发给 slot）。 */
const CurrentUserMessageAttachmentsCtx =
  React.createContext<{ threadId: string; items: readonly ChatAttachment[] } | null>(null);

/**
 * phase-18 F15 —— 这一条消息落库后的真实 id（还没落库 ⇒ 视图 id）。正文上挂成 `data-kg-message-id`，
 * 记忆来源抽屉的「跳到原消息」据此找到它、滚到眼前并高亮（`lib/chat-message-focus.ts`）。
 */
const CurrentUserMessageIdCtx = React.createContext<string | null>(null);

/**
 * issue #4180 —— 当前这条用户消息，够不够格挂「刚被抽取出新知识」的反馈条：够格 = 本会话
 * 真的发出去过（见 `UserMessageAttachmentsValue.sentThisSession`）。`null` = 不挂
 * （没有 provider，或这条是历史回读，不是本会话发的）。
 */
const CurrentUserMessageExtractionCtx =
  React.createContext<{ threadId: string; messageId: string } | null>(null);

function V2UserMessageRenderer({
  content,
}: React.ComponentProps<typeof CopilotChatUserMessage.MessageRenderer>): JSX.Element {
  const attachments = React.useContext(CurrentUserMessageAttachmentsCtx);
  const messageId = React.useContext(CurrentUserMessageIdCtx);
  const extraction = React.useContext(CurrentUserMessageExtractionCtx);
  return (
    <div className="flex flex-col gap-1" {...(messageId === null ? {} : { [MESSAGE_ANCHOR_ATTR]: messageId })}>
      <div data-testid="chat-user-message-text" className="whitespace-pre-wrap text-13 text-secondary-foreground">
        {content}
      </div>
      {attachments !== null && attachments.items.length > 0 ? (
        <MessageAttachments attachments={attachments.items} threadId={attachments.threadId} />
      ) : null}
      {extraction !== null ? (
        <ExtractionFeedbackChip threadId={extraction.threadId} messageId={extraction.messageId} />
      ) : null}
    </div>
  );
}

function V2UserMessageImpl(
  props: React.ComponentProps<typeof CopilotChatUserMessage>,
): JSX.Element {
  const ctx = React.useContext(UserMessageAttachmentsCtx);
  const items = ctx?.byMessageId.get(props.message.id);
  const persistedId = useCopilotKitV2MessageActions()?.identity.resolvePersisted(props.message.id) ?? props.message.id;
  // provider 不产生任何 DOM 节点——气泡外壳仍然只有框架渲染的那一个
  // （`copilotkit-v2.css` 锚定的 `data-testid="copilot-user-message"`），
  // 不会因为这次接线多出一层包装盒子。
  const current = React.useMemo(
    () => (items === undefined || items.length === 0 || ctx === null
      ? null
      : { threadId: ctx.threadId, items }),
    [items, ctx],
  );
  // issue #4179 —— 「记住这句」正文取自框架给的这条消息本身，与 assistant 侧
  // `copilotkit-v2-assistant-message.tsx` 取 `text` 的同一条纪律（`content` 的
  // 静态类型是 `string | 数组`，只有纯字符串这一支有对应的可发送正文）。
  const text = typeof props.message.content === "string" ? props.message.content : "";
  // issue #4180 —— 只有本会话真的发出去过的消息（`sentThisSession` 按视图 id 记，即
  // `clientMessageId`）才挂反馈条；historical 回读的消息 ctx 里查不到，`extraction` 为 null。
  const extraction = React.useMemo(
    () => (ctx !== null && ctx.sentThisSession.has(props.message.id) ? { threadId: ctx.threadId, messageId: persistedId } : null),
    [ctx, props.message.id, persistedId],
  );
  return (
    <CurrentUserMessageIdCtx.Provider value={persistedId}>
      <CurrentUserMessageExtractionCtx.Provider value={extraction}>
        <CurrentUserMessageAttachmentsCtx.Provider value={current}>
          <CopilotChatUserMessage
            {...props}
            messageRenderer={V2UserMessageRenderer}
            additionalToolbarItems={<CopilotKitV2RememberMessageButton text={text} />}
          />
        </CurrentUserMessageAttachmentsCtx.Provider>
      </CurrentUserMessageExtractionCtx.Provider>
    </CurrentUserMessageIdCtx.Provider>
  );
}

/**
 * slot 的静态类型是 `SlotValue<typeof CopilotChatUserMessage>`——同
 * `V2AssistantMessage` 头注一致的理由：`Object.assign` 把框架那份命名空间
 * （`.Container`/`.MessageRenderer`/`.Toolbar`/…）原样搬到包装组件上，不用
 * `as` 断言糊过去，运行期真的去读 `.MessageRenderer` 等子组件的调用点才不会
 * 拿到 `undefined`。
 */
export const V2UserMessage = Object.assign(
  V2UserMessageImpl,
  CopilotChatUserMessage,
) as typeof CopilotChatUserMessage;
