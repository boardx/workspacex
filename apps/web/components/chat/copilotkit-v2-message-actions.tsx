"use client";
import * as React from "react";
import { Copy, Check } from "lucide-react";
import { MessageRating } from "@/components/chat/message-rating";
import { PersistedAgentFeedback } from "@/components/chat/workbench/persisted-agent-feedback";
import type { ChatMessageIdentityIndex } from "@/lib/copilotkit-v2-message-identity";
import {
  MessageLandingTrigger, MessageLandingPanel, type MessageLandingState,
} from "@/components/chat/message-landing";

/**
 * CK-P3（issue #2054）—— v2 轨道逐条 AI 消息的操作条：复制 / 👍👎 评分 / 对 agent 提反馈。
 *
 * 差距单一事实源 `.harness/state/chat-feature-parity-gap-2026-08-25.md` 第 7 项。
 *
 * ## 接哪一层 slot：`assistantMessage` 整组件，不是 `markdownRenderer`
 *
 * `markdownRenderer` 子 slot 的类型签名是 `Omit<ComponentProps<Streamdown>,"children">
 * & {content: string}`——只有正文，**不带 `messageId`**，逐条操作在那一层根本接不上
 * （#2046 已排除这条路，别再从那里进）。而 `CopilotChatAssistantMessageProps` 在
 * **整组件**这一层是携带 `message` 的（读 `@copilotkit/react-core@1.66.4` 的
 * `dist/copilotkit-D0aAnD3i.d.mts:757` 确认）。所以这里覆盖整个 `assistantMessage`
 * slot，内部仍然渲染框架默认的 `CopilotChatAssistantMessage`，只是补三样东西——
 * 不是本仓另写一个气泡组件（那会让两条轨道的消息渲染各自漂移）。
 *
 * ## 复制：框架**已经**有一个能用的，这里只是给它本仓的锚点
 *
 * 差距表把复制记成"全无"，实测代码更正：`CopilotChatAssistantMessage` 默认就渲染
 * toolbar，其中 `CopyButton` 的 `onClick` 是真的
 * `copyToClipboard(message.content)`（`dist/copilotkit-nRjRp2_5.mjs:5892`）。它缺的
 * 是**被验证过**和**本仓的 testid**——旧轨道 e2e 靠 `chat-message-copy` 定位。
 * 所以这里覆盖 `copyButton` slot、**沿用框架传进来的 `onClick`**（不是自己再写一次
 * `navigator.clipboard.writeText`，那就成了同一件事的第二份实现），只换外观与锚点。
 *
 * ## 评分：`resolve` 拿不到真实落库 id 就**不画**
 *
 * `rateMessage` 要求 `messageId` 指向真实 `chat_messages` 行且可归因，否则 404
 * （`submit-message-rating.ts` 三道门）。而流式消息在视图里的 `id` 是临时聚合 id。
 * 完整取证与索引怎么来的见 `lib/copilotkit-v2-message-identity.ts` 文件头。
 * 这里的纪律只有一句：`index.resolve(...)` 返回 `null` → 不渲染评分按钮。
 * 「入口消失比入口失灵诚实」——与同目录 `FeedbackButton` 在没有 `FeedbackProvider`
 * 时返回 `null` 是同一条既有裁决。
 *
 * ## 反馈：按 agent 归因，与评分不是一件事
 *
 * 消息级 👍/👎 答的是"这一条回答好不好"；`FeedbackButton` 答的是"这个 agent 老是
 * 漏掉附件"这类跨很多条消息的话，两者在下游走两条不同的路（旧轨道
 * `chat-live-message-panel.tsx` 同一段注释）。它只需要 agent id，**不**需要
 * messageId。工作台先确认该回复的持久消息身份，再从所属 run 解析真实 agent。
 * 当前 composer 的选择不会改变历史回复的反馈归属；未持久化或无法核实归属时不显示。
 */

/**
 * issue #2052（CK-P7）—— 「落地为产物」这一件的状态机接口。
 *
 * `null` = 这次挂载不具备落地条件（没有真实线程 id 或没有 bearer）⇒ 入口整个不渲染。
 * ⚠ 这里**没有** id 解析函数：那件事由上面同一个 context 里的 `identity` 回答。
 *   评分与落地问的是同一个问题（"这条气泡在 `chat_messages` 里的主键是什么"），
 *   各存一份就是同一事实两处声明。
 */
export interface AssistantMessageLandingValue {
  readonly stateFor: (chatMessageId: string) => MessageLandingState | undefined;
  readonly open: (message: { readonly id: string; readonly text: string }) => void;
  readonly updateTitle: (chatMessageId: string, title: string) => void;
  readonly cancel: (chatMessageId: string) => void;
  readonly submit: (message: { readonly id: string; readonly text: string }) => void;
}

export interface CopilotKitV2MessageActionsContextValue {
  readonly identity: ChatMessageIdentityIndex;
  /** 当前发送 agent 的真实 id；用户未选择（走服务端默认）时为 `null`。 */
  readonly agentId: string | null;
  readonly agentLabel: string | null;
  /** issue #2052（CK-P7）—— 「落地为产物」；`null` = 本次挂载不具备落地条件。 */
  readonly landing: AssistantMessageLandingValue | null;
}

const Ctx = React.createContext<CopilotKitV2MessageActionsContextValue | null>(null);

export function CopilotKitV2MessageActionsProvider({
  value,
  children,
}: {
  value: CopilotKitV2MessageActionsContextValue;
  children: React.ReactNode;
}): JSX.Element {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopilotKitV2MessageActions(): CopilotKitV2MessageActionsContextValue | null {
  return React.useContext(Ctx);
}

/**
 * `copyButton` slot 的替换实现。`onClick` 由框架绑定好传进来（内容真的进剪贴板），
 * 这里只负责外观与 `chat-message-copy` 锚点，以及"复制成功后 2 秒显对勾"这条与旧轨道
 * 一致的反馈。
 *
 * ⚠ 框架的 `copyToClipboard` 返回 `Promise<boolean>`——失败时**不**显示对勾。
 *   显示一个假的"已复制"，用户会以为剪贴板里有东西，粘出来却是上一次的内容。
 */
export function CopilotKitV2CopyButton({
  onClick,
  messageId,
}: {
  /**
   * 框架绑好的复制动作。⚠ 返回类型写成 `unknown` 是**故意**的：框架 slot 的静态类型是
   * `React.MouseEventHandler`（返回 `void`），而它实际返回的是
   * `copyToClipboard(...)` 的 `Promise<boolean>`。写死成 `Promise<boolean>` 接不上
   * 那个签名，写成 `void` 又会把"复制是否真的成功"这个真实存在的信息类型层面抹掉。
   */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown;
  messageId?: string;
}): JSX.Element {
  const [copied, setCopied] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);
  React.useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <button
      type="button"
      data-testid="chat-message-copy"
      data-message-id={messageId}
      aria-label="复制消息"
      title="复制消息"
      onClick={(event) => {
        void (async () => {
          const ok = await onClick?.(event);
          if (ok === false) return;
          setCopied(true);
          if (timerRef.current !== null) window.clearTimeout(timerRef.current);
          timerRef.current = window.setTimeout(() => setCopied(false), 2_000);
        })();
      }}
      className="inline-grid h-5 w-5 place-items-center rounded text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-card-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? (
        <Check aria-hidden className="h-3 w-3 text-primary" />
      ) : (
        <Copy aria-hidden className="h-3 w-3" />
      )}
    </button>
  );
}

/**
 * 挂进 `additionalToolbarItems` 的那一组：反馈 + 评分。
 * 两者的渲染条件各自独立（见文件头），不是一个开关控制两个。
 */
export function CopilotKitV2MessageExtraActions({ messageId }: { messageId: string }): JSX.Element | null {
  const ctx = useCopilotKitV2MessageActions();
  if (ctx === null) return null;
  const chatMessageId = ctx.identity.resolve(messageId);
  return (
    <>
      <PersistedAgentFeedback messageId={ctx.identity.resolvePersisted(messageId)} />
      {/* ⚠ `revealOnHover={false}`：框架 toolbar 链路上没有 `group` 祖先，
          旧轨道那套 `group-hover:visible` 在这里不是"藏起来"，是「永远不出现」
          （真栈 e2e 第一轮实测点不下去）。见 `message-rating.tsx` 该 prop 的注释。 */}
      {chatMessageId !== null ? (
        <MessageRating messageId={chatMessageId} revealOnHover={false} />
      ) : null}
    </>
  );
}

/**
 * issue #2052（CK-P7）—— 逐条 AI 消息的「落地为产物（草稿）」。
 *
 * ## 为什么在这个文件里，而不是自己再换一次 `assistantMessage` slot
 *
 * CK-P3（#2054）已经为了复制/评分/反馈换过一次这个 slot 了。同一个 slot 换两次
 * 会渲染出**两个气泡外壳**——两条并行线撞在同一层的既知风险，先合入的那份是骨架，
 * 后来的挂件并进去。所以这里只是那条操作条上的第四件，与它们共用同一份 context。
 *
 * ## 2026-08-27：入口拆成 Trigger（进 `additionalToolbarItems`）+ Panel（仍是兄弟节点）
 *
 * 此前整块（含"未打开"态的整行文字按钮）都作为气泡的兄弟节点挂在下方，人类反馈
 * 这个入口应该读作"消息操作条上的一个图标"，不是自成一行的文字按钮（对照 Claude
 * Design 原型）。落地的完整交互仍然是「触发 → 标题表单 → 已落地卡片」三态，后两态
 * 需要的宽度（输入框/错误文案/结构化卡片）塞不进行内工具栏，所以只有**触发器**
 * 这一态挪进 `additionalToolbarItems`（与复制/反馈/评分同一排），表单/完成态仍是
 * 块级兄弟节点渲染在下方（见 `V2AssistantMessageImpl`）——不是把整个三态交互塞进
 * 工具栏撑变形。
 *
 * ## 渲染门（与评分同一条纪律，不是新发明的）
 *
 * 三者俱全才画：真实线程 id + bearer（两者合成 `ctx.landing !== null`）+ 这条消息的
 * 真实落库 id（`ctx.identity.resolve(...)`）。缺任何一件都不渲染——正在流的那条消息
 * 还没落库，它本来就不该能被落地；画出来点了必 404 才是本仓反复判 0 的那种假入口。
 *
 * ⚠ 用 `resolvePersisted` 而**不是** `resolve`：后者额外过一道归因门（`agentRunId`），
 *   那是**评分**的服务端判据（`submit-message-rating.ts` 第三道
 *   `ratings.resolveForMessage`）。落地为产物的服务端门里没有这一条
 *   （`land-as-artifact.ts` 只做 `findMessageLocation` + 可见性），用 `resolve` 会把
 *   一条合法可落地、只是没有 `agentRunId` 的历史消息的入口**静默藏掉**——按钮不
 *   出现、不报错、不留痕，是最难被发现的那种假阴性。两个出口的完整依据见
 *   `lib/copilotkit-v2-message-identity.ts` 的 `resolvePersisted` 文档。
 */
function resolveLandableMessage(
  ctx: CopilotKitV2MessageActionsContextValue,
  messageId: string,
  text: string,
): { chatMessageId: string; message: { id: string; text: string } } | null {
  if (ctx.landing === null) return null;
  const chatMessageId = ctx.identity.resolvePersisted(messageId);
  if (chatMessageId === null || text === "") return null;
  return { chatMessageId, message: { id: chatMessageId, text } };
}

/** 消息动作条里的图标触发器——与 `CopilotKitV2MessageExtraActions` 同一排。 */
export function CopilotKitV2MessageLandingTrigger({
  messageId,
  text,
}: {
  messageId: string;
  text: string;
}): JSX.Element | null {
  const ctx = useCopilotKitV2MessageActions();
  if (ctx === null) return null;
  const resolved = resolveLandableMessage(ctx, messageId, text);
  if (resolved === null) return null;
  const landing = ctx.landing!;
  const { chatMessageId, message } = resolved;
  return (
    <MessageLandingTrigger
      message={message}
      state={landing.stateFor(chatMessageId)}
      onOpen={() => landing.open(message)}
    />
  );
}

/** 打开后的表单/提交中/出错/完成四态——仍是气泡下方的块级兄弟节点。 */
export function CopilotKitV2MessageLandingPanel({
  messageId,
  text,
}: {
  messageId: string;
  text: string;
}): JSX.Element | null {
  const ctx = useCopilotKitV2MessageActions();
  if (ctx === null) return null;
  const resolved = resolveLandableMessage(ctx, messageId, text);
  if (resolved === null) return null;
  const landing = ctx.landing!;
  const { chatMessageId, message } = resolved;
  return (
    <MessageLandingPanel
      message={message}
      state={landing.stateFor(chatMessageId)}
      onTitleChange={(title) => landing.updateTitle(chatMessageId, title)}
      onCancel={() => landing.cancel(chatMessageId)}
      onSubmit={() => landing.submit(message)}
    />
  );
}
