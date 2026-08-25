"use client";
import * as React from "react";
import type { AbstractAgent } from "@ag-ui/client";
import {
  AGUI_CHAT_MESSAGE_ID_EVENT_NAME,
  parseAguiChatMessageIdValue,
} from "@repo/contracts/agui-state-events";

/**
 * CK-P3（issue #2054）—— 「气泡上这条消息，在 `chat_messages` 里的真实主键是什么？」
 *
 * ## 为什么需要一个索引，而不是直接用 `message.id`
 *
 * `CopilotChatMessageView` 渲染的 `agent.messages` 里，同一个 `id` 字段有**两种来源**，
 * 而它们的可用性完全不同（读代码取证，不是推测）：
 *
 *   · **hydration 回灌的历史消息**：`copilotkit-v2-panel.tsx` 的 `listMessages` 分页
 *     回读，`id` 就是 `chat_messages` 主键——**能**用来调 `rateMessage`/`landAsArtifact`。
 *   · **本轮流式到达的 assistant 消息**：`id` 来自 wire 上的 `TEXT_MESSAGE_START.messageId`，
 *     而那是 `copilotkit-agui.controller.ts` 里 `randomUUID()` 出来的临时聚合 id，
 *     `chat_messages` 里**没有**这一行。
 *
 * 直接拿后者去调 `rateMessage`，服务端 `submit-message-rating.ts` 第一道
 * `findMessageLocation` 就查不到 → `MessageNotRateableError` → 404。也就是说按钮画得
 * 出来、点下去必炸。本仓对这种入口的既有裁决是：**不画**，不是画完再解释。
 *
 * 所以有了这个索引：真实 id 拿得到才回答，拿不到就回答 `null`，调用方据此不渲染
 * 依赖它的按钮。它不合成、不兜底、不"先用临时 id 顶着"。
 *
 * ## 两个来源怎么进来
 *
 *   · 流式那半：订阅 `CUSTOM {name:"chat_message_id"}`（后端在 run `succeeded` 后、
 *     `RUN_FINISHED` 之前发；契约与理由见 `@repo/contracts/agui-state-events`
 *     的 `AguiChatMessageIdValue`）。`value` 在协议层是 `unknown`，这里用契约导出的
 *     同一个 zod schema 原地再校验——解析失败丢弃这一帧，同 `useAguiFileEvents` 的纪律。
 *   · 历史那半：由 panel 在 hydration 时调 `registerHydrated` 显式登记。
 *
 * ## ⚠ 为什么历史那半还要带一个 `rateable` 判断
 *
 * 「消息真实存在」只是 `rateMessage` 的第一道门。第三道是
 * `ratings.resolveForMessage(messageId)` 取归因——它从 `agent_runs` 查，早于
 * `chat_messages.agent_run_id` 的历史消息归不了因，同样 404。旧轨道对此的处理逐字是
 * 「`isAgent && message.agentRunId` 两个条件缺一不可…给它画一个点了必然失败的按钮，
 * 比不画更糟」（`chat-live-message-panel.tsx`）。这里沿用同一条判断，不放宽。
 *
 * 流式那半不需要这个判断：能收到 `chat_message_id` 回显，就意味着这条消息是这一轮
 * run 写回的，`agent_run_id` 必然非空。
 *
 * ## 为什么是 state 而不是 ref
 *
 * 评分按钮要在 run 结束、真实 id 到达的那一刻**出现**。存进 ref 不触发重渲染，
 * 用户要等下一次无关的状态变化才看得到按钮——那就成了一个时有时无的入口。
 */
export interface ChatMessageIdentityIndex {
  /**
   * **评分专用**出口：视图里那条消息的 `id` → 可安全用于 `rateMessage` 的真实
   * `chat_messages.id`；拿不到真实 id、或拿得到但**不可归因**时返回 `null`。
   */
  readonly resolve: (viewMessageId: string) => string | null;
  /**
   * **落地为产物专用**出口（issue #2052 / CK-P7）：只回答"这条消息在
   * `chat_messages` 里真实存在吗"，**不**附加归因门。
   *
   * ## ⚠ 为什么是两个出口，而不是一个（别把它们合并掉）
   *
   * 两个下游操作的**服务端门本来就不一样**，这不是前端多此一举：
   *
   *   · `rateMessage` → `application/skill/submit-message-rating.ts`：
   *     `findMessageLocation` → `resolveVisibility` → **`ratings.resolveForMessage`**。
   *     第三道从 `agent_runs` 查归因，返回 null 即 `MessageNotRateableError` → 404。
   *     所以早于 `chat_messages.agent_run_id` 的历史消息**评不了分** ⇒ `resolve` 必须
   *     对它们回答 `null`（否则就是画一个点了必 404 的按钮）。
   *
   *   · `landAsArtifact` → `application/chat/land-as-artifact.ts`：
   *     `findMessageLocation` → `resolveVisibility`（个人线程再加一道"只能 draft"）。
   *     **全程不碰 `agent_runs`、不要求 `agentRunId`**（读该文件确认，不是推测）。
   *     一条没有 `agentRunId` 的历史 agent 消息**完全可以**被落地。
   *
   * 若落地也走 `resolve`，那种消息的入口会被**静默藏起来**——按钮就是不出现，
   * 不报错、不留痕，属于最难被发现的那类假阴性。所以这里给同一份索引开第二个
   * 出口，而不是第二份映射表：`streamed` 那半两者**完全共用**（本轮 run 写回的
   * 消息必然带 `agentRunId`，两个出口对它答案相同），差别只在回灌那半要不要过
   * `rateable` 门。同一个事实一份状态，两种读法。
   */
  readonly resolvePersisted: (viewMessageId: string) => string | null;
}

export interface HydratedMessageIdentity {
  readonly id: string;
  /** 该消息是否由 agent 写回且带 `agentRunId`——两者缺一即不可评分，见上文。 */
  readonly rateable: boolean;
}

export interface UseChatMessageIdentityResult {
  readonly index: ChatMessageIdentityIndex;
  readonly registerHydrated: (entries: readonly HydratedMessageIdentity[]) => void;
}

export function useChatMessageIdentity(agent: AbstractAgent): UseChatMessageIdentityResult {
  // 流式 id → 真实落库 id。
  const [streamed, setStreamed] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  // hydration 回灌的、且真的**可评分**的那些 id（它们的 id 本身就是真实主键）。
  const [hydrated, setHydrated] = React.useState<ReadonlySet<string>>(() => new Set());
  // issue #2052 —— 回灌的**全部**真实主键（不过 `rateable` 门）。落地为产物只要求
  // 消息真实存在，见 `resolvePersisted` 的文档。
  const [hydratedAll, setHydratedAll] = React.useState<ReadonlySet<string>>(() => new Set());

  React.useEffect(() => {
    const { unsubscribe } = agent.subscribe({
      onCustomEvent: ({ event }) => {
        if (event?.name !== AGUI_CHAT_MESSAGE_ID_EVENT_NAME) return;
        const parsed = parseAguiChatMessageIdValue(event.value);
        // 解析失败：这一帧不可信，丢弃。不退化成"拿 streamingMessageId 顶上"——
        // 那正好是这个索引存在的理由。
        if (parsed === null) return;
        setStreamed((prev) => {
          if (prev.get(parsed.streamingMessageId) === parsed.chatMessageId) return prev;
          const next = new Map(prev);
          next.set(parsed.streamingMessageId, parsed.chatMessageId);
          return next;
        });
      },
    });
    return unsubscribe;
  }, [agent]);

  const registerHydrated = React.useCallback((entries: readonly HydratedMessageIdentity[]) => {
    setHydrated((prev) => {
      const next = new Set(prev);
      for (const e of entries) if (e.rateable) next.add(e.id);
      return next;
    });
    // issue #2052 —— 同一次登记的另一半：不过 `rateable` 门，供 `resolvePersisted` 用。
    setHydratedAll((prev) => {
      const next = new Set(prev);
      for (const e of entries) next.add(e.id);
      return next;
    });
  }, []);

  const index = React.useMemo<ChatMessageIdentityIndex>(
    () => ({
      resolve: (viewMessageId: string) => {
        const mapped = streamed.get(viewMessageId);
        if (mapped !== undefined) return mapped;
        // hydration 回灌的消息：id 本身就是真实主键，但只有登记为可评分的才回答。
        return hydrated.has(viewMessageId) ? viewMessageId : null;
      },
      // issue #2052 —— 与 `resolve` 共用同一份 `streamed`（本轮 run 写回的消息必然
      // 带 agentRunId，两者答案相同），只有回灌那半不过 `rateable` 门。
      resolvePersisted: (viewMessageId: string) => {
        const mapped = streamed.get(viewMessageId);
        if (mapped !== undefined) return mapped;
        return hydratedAll.has(viewMessageId) ? viewMessageId : null;
      },
    }),
    [streamed, hydrated, hydratedAll],
  );

  return { index, registerHydrated };
}
