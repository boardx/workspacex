/**
 * 工具调用链 —— `provenance_events` 的投影，不是第二张表（F111 · uc-8-2 UC-14，I-22）。
 *
 * ## 事件类型是借来的，不是新造的 —— **报告，不是自行扩枚举**
 *
 * `packages/contracts/src/provenance.ts` 的 `ProvenanceEventType` 是封闭枚举，新增走
 * ADR-101（此刻状态 Proposed，需人类追认）。ADR-101 已经补了 8 个成员，但没有一个
 * 对应「一次工具调用」——它补的是 `files` / `project` / `chat`（线程生命周期）三束的
 * 生命周期事件，不是本束（F111）的调用链事件。
 *
 * 这与 F109 撞上的是**同一个根**（封闭枚举里没有可写的类型），处理方式沿用同一个纪律：
 * **不擅自加第 9 个成员**，而是借用最近的既有值，把语义错配写在明处，登记为已知缺口，
 * 等下一次 ADR 一并收敛（就像 F109 曾经的 `CHAT_LIFECYCLE_AUDIT_TYPE = "human-edited"`
 * 那样——只是这次连"最近"都够不上一个专门的名字，只能借"generated"）。
 *
 * 为什么借 `generated` 而不是 `transformed`：两者在全仓迄今**都还没有任何写入者**
 * （零碰撞），`transformed` 的既有释义是「OCR/ASR/摘要/embedding 等对既有材料的转换」，
 * 更贴近"改造一份已存在的材料"；工具调用是"agent 为了回答而调用一个函数、产出一段
 * 结果"，落在"AI 生成"这一侧更近。两者都不精确——真正精确的名字应当是
 * `tool-invoked` 之类，这正是要报告的缺口。
 *
 * ⚠ **target 维度同样是借来的**：`ProvenanceTargetKind` 没有 `message`，
 * 只有 `thread`（ADR-101 代 F109 补的）。工具调用挂在一条消息上，而消息不是
 * target 的合法取值 ⇒ target 记成该消息所在的**线程**，`messageId` 走 `detail`
 * ——与 `mutate-thread.ts` 把 `projectId` 放进 `detail` 同一个处置（ADR-101 决策 B
 * 未裁期间的临时形状，见该文件文件头）。
 */
import { provenance as P, chat as C } from "@repo/contracts";
import type { z } from "zod";

/**
 * ⚠ **借用的类型，不是新语义**。见文件头。下一次 ADR 补上专门的类型时，
 *   全仓搜这一个常量即可找到全部需要跟着改的写点——不散落成字面量 `"generated"`。
 */
export const TOOL_CALL_AUDIT_TYPE: z.infer<typeof P.ProvenanceEventType> = "generated";

/** 一次工具调用写进 `detail` 的形状。`messageId` 是本函数从 target 借用 thread 之后，
 *  用来在同一线程的多条消息间区分「这条调用属于哪条消息」的字段。
 *  ⚠ 形状本身是契约（`@repo/contracts` `chat.ToolCallDetail`），这里只引用，不重定义
 *  （见 `tests/contract-single-source.test.ts` "no backend file declares its own zod object schema"）。 */
export const ToolCallDetail = C.ToolCallDetail;

export type ToolCallDetailT = z.infer<typeof ToolCallDetail>;

/** 一条已落库的事件，投影视角只需要这两个字段。 */
export interface ToolCallEventRow {
  readonly id: string;
  readonly detail: Record<string, unknown>;
}

export type ToolCall = z.infer<typeof C.ToolCall>;

/**
 * 事件 → `ToolCall`。**不是每一条 `provenance_events` 都是工具调用**——同一线程下
 * 还有 `thread-created` 等其它类型的事件，target 相同但 detail 形状不同。
 * `safeParse` 失败即返回 `null`，调用方据此把非工具调用事件排除在链条之外，
 * 而不是让一条形状不符的行让整个投影抛错。
 */
export function toToolCall(event: ToolCallEventRow): ToolCall | null {
  const parsed = ToolCallDetail.safeParse(event.detail);
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    function: d.function,
    args: d.args,
    hitCount: d.hitCount,
    reuseFlag: d.reuseFlag,
    status: d.status,
    tokens: d.tokens,
    callerAgentId: d.callerAgentId,
    model: d.model,
    pipelineVersion: d.pipelineVersion,
    provenanceEventId: event.id,
  };
}

/**
 * 汇总 —— **不是第二处计数**：`callCount` 恒等于 `calls.length`（I-22 / I-25），
 * 这里用 `.length` 而不是另外维护一个计数器，就是把这条不变量焊死在实现里。
 */
export function summarizeToolCalls(calls: readonly ToolCall[]): {
  callCount: number;
  readVolume: number;
  tokens: number;
} {
  return {
    callCount: calls.length,
    readVolume: calls.reduce((sum, c) => sum + (c.hitCount ?? 0), 0),
    tokens: calls.reduce((sum, c) => sum + c.tokens, 0),
  };
}
