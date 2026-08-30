import { listMessages } from "@/lib/live-chat";
import { findPendingRunId } from "@/lib/agent-run";

/**
 * 2026-08-30（引用文件规模纪律拆分）—— 本文件从 `copilotkit-v2-panel.tsx` 拆出，
 * 只是搬家：`readAllPersistedMessages` 是一个纯模块函数（只依赖 `listMessages`/
 * `findPendingRunId`，不闭包依赖 `CopilotKitV2PanelBody` 的任何内部状态），天然
 * 可独立成文件。原文件当时已过 2000 行的业务源文件规模上限（AGENTS.md 硬约束）。
 * 行为逐字节未变，唯一改动是文件边界与 import 路径。
 *
 * 一条线程**已落库**消息的最小投影（`chat_messages` 行 → CopilotKit 消息形状）。
 *
 * ⚠ `id` 是 **`chat_messages.id`**，不是 `agent.messages` 里流式产生的 AG-UI 消息 id。
 *   两者是原文件头注早就记录过的两个独立命名空间；任何要把消息 id 交回后端的操作
 *   （issue #2053 CK-P6「生成用户画像」的锚点 `messageId` 就是一个）**只能**用这一份，
 *   拿流式 id 去调只会做出一个「点了才报错」的假按钮。
 */
export type PersistedMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /**
   * CK-P3（issue #2054）—— 这条消息能不能调 `rateMessage`。
   *
   * 「id 是真实主键」只是服务端三道门里的第一道；第三道
   * （`ratings.resolveForMessage`）要从 `agent_runs` 取归因，人自己说的话没有 agent
   * 可归因、早于 `chat_messages.agent_run_id` 的历史消息同样归不了因，两种都 404。
   * 判据只在这里（`listMessages` 的投影里）看得到——上面那三个字段进了
   * `agent.setMessages` 之后就没有 `agentRunId` 了——所以就地投影出来，
   * 而不是让调用方为了这一个布尔值再读一遍库。
   */
  rateable: boolean;
};

/**
 * 把一条线程的持久化消息**读完**（不是读一页就算数）。
 *
 * `listMessages` 契约（R9）要求调用方分页，单页上限 100；这里跑到 `nextCursor === null`
 * 为止。抽成模块级函数是因为它现在有多个调用方（挂载时的历史灌回、CK-P6 画像的
 * 锚点/结果消息读取、run 恢复后的重读），而"怎么把一条线程读完"必须只有一份写法。
 *
 * session-switch task-state-loss fix —— 同时把 `pendingRunId` 投影出来：最新一条
 * 带 `agentRunId` 的人类消息若还没有回复，说明这个 run 挂载时可能仍未写回终态
 * （见 `findPendingRunId` 文件头）。与 `rateable` 同理，只在这里算一遍，不为它
 * 再单独读一次库——`listMessages` 分页返回的原始 `agentRunId`/`replyToMessageId`
 * 过了这一层投影成 `PersistedMessage` 之后就不再带出去了。
 */
export async function readAllPersistedMessages(
  threadId: string,
  bearer: string | undefined,
): Promise<{ messages: PersistedMessage[]; pendingRunId: string | null }> {
  const collected: PersistedMessage[] = [];
  const rawForPendingRunLookup: {
    id: string;
    authorKind: "human" | "agent";
    agentRunId: string | null;
    replyToMessageId: string | null;
  }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page += 1) {
    const result = await listMessages(threadId, { cursor, limit: 100 }, bearer);
    for (const m of result.messages) {
      collected.push({
        id: m.id,
        role: m.authorKind === "human" ? "user" : "assistant",
        content: m.text,
        rateable: m.authorKind !== "human" && m.agentRunId !== null,
      });
      rawForPendingRunLookup.push({
        id: m.id,
        authorKind: m.authorKind,
        agentRunId: m.agentRunId,
        replyToMessageId: m.replyToMessageId,
      });
    }
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }
  return { messages: collected, pendingRunId: findPendingRunId(rawForPendingRunLookup) };
}
