/**
 * `recordToolCall` —— 落一条工具调用事件（F111 · uc-8-2 UC-14 的写半边）。
 *
 * ## 谁调用它，以及为什么这里没有 HTTP 路由
 *
 * 全仓目前**没有** agent 执行引擎（`agent-runtime` 束还在 phase-01 之后）：没有任何
 * 代码路径会在一次真实的工具调用发生时写下这一条。这个函数因此是**契约的写半边**
 * ——`expandToolCallChain`（读半边）要投影的行从哪里来，答案就是这个函数——而不是
 * 假装接了一整套 agent 编排。测试直接调它来构造夹具，与 `mutate-thread.ts` 的三个
 * 生命周期事件、`record-audit.ts` 的 `recordBackflow` 同一个地位：一个**唯一**的写入点，
 * 不是"调用点各自拼一个 detail"。
 *
 * ## 借来的类型 —— 见 `domain/chat/tool-call-projection.ts` 文件头
 *
 * `TOOL_CALL_AUDIT_TYPE` 不是新语义，是报告了缺口之后借用的既有值。
 */
import type { OrgId } from "../../domain/org-id";
import {
  TOOL_CALL_AUDIT_TYPE,
  ToolCallDetail,
  type ToolCallDetailT,
} from "../../domain/chat/tool-call-projection";
import type { ProvenanceWriter } from "../provenance/ports";

export interface RecordToolCallInput {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly actorId: string;
  readonly call: ToolCallDetailT;
}

/** `ToolCallDetail` 未通过校验——调用方传了一个形状不对的 detail。 */
export class ToolCallDetailInvalidError extends Error {
  constructor(readonly issues: string) {
    super("tool_call_detail_invalid");
  }
}

export async function recordToolCall(
  writer: ProvenanceWriter,
  input: RecordToolCallInput,
): Promise<string> {
  // 校验一次，写入前。写进去的行如果连自己的 detail schema 都不满足，
  // 读半边（`toToolCall`）只会把它悄悄跳过——那是"这条调用在链条里消失了"，
  // 比"写的时候直接报错"糟糕得多。
  const parsed = ToolCallDetail.safeParse(input.call);
  if (!parsed.success) throw new ToolCallDetailInvalidError(parsed.error.message);

  return writer.append({
    orgId: input.orgId,
    type: TOOL_CALL_AUDIT_TYPE,
    actorId: input.actorId,
    // target = 线程，messageId 走 detail。见 `tool-call-projection.ts` 文件头
    // 「target 维度同样是借来的」——与 `mutate-thread.ts` 把 projectId 放进 detail
    // 同一个处置（ADR-101 决策 B 未裁期间的临时形状）。
    target: { kind: "thread", id: input.threadId },
    detail: parsed.data,
  });
}
