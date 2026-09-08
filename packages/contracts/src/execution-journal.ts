import { SkillActivityFact } from "./skill-activity";
import { z } from "zod";
import { InterjectionStatus } from "./interjection-status";
import { StandardCapabilityDescriptor } from "./standard-capabilities";

/**
 * `skillDisplayName`（#3063）—— `call_skill` 这一跳被调用 skill 的**展示名**快照，
 * 由 run 侧从本轮已 pin 的 skill（`readPinnedSkills` 的 `PinnedSkillContent.name`）
 * 按 `args.skill_stable_name` 解析后写下。#3058 把 `stable_name` 收回为合规 slug
 * （中文名 ⇒ `skill-<8 位 hex>`），身份字段不再可读；可读性由这里承担。
 *
 * ⚠ 这不是第二张「id → 名字」映射表：名字只有 `skills.name` 一个事实源，这里是它在
 * 这一跳发生时刻的投影（与 `args`/`packageDigest` 同一性质的快照），消费端不再自己查。
 * 解析不到（skill 没挂 / 参数形状不对 / 非 `call_skill`）时键缺席，展示层退回
 * `skill_stable_name` 原样回显——不猜、不兜一个可能过时的译名。
 */
/** Durable public execution activity; never contains private model reasoning. */
export const AGUI_EXECUTION_EVENT_NAME = "execution_event" as const;
const base = { source: z.literal("legacy").optional(), attemptId: z.string().optional(), runId: z.string().min(1), seq: z.number().int().nonnegative(), emittedAt: z.string() };
/**
 * 一次工具调用在账本里的两半（`tool_start` / `tool_end`）的字段本体，**提为具名常量而不是
 * 内联进 union**——`packages/contracts/src/subtask-run.ts` 的子任务工具明细（issue #3100 D6）
 * 要复用同一批字段名与校验规则，而 AGENTS.md「同一事实不得声明在两处」禁止在那边照抄一份。
 * 这里只是把原本内联的对象字面量抬出来，union 成员的形状逐字不变。
 */
export const ToolCallStartFields = {
  toolCallId: z.string().min(1), sourceToolCallId: z.string().min(1).optional(), toolName: z.string(),
  capability: StandardCapabilityDescriptor.optional(), args: z.unknown(),
  planningNote: z.string().max(4000).optional(), skillDisplayName: z.string().min(1).max(200).optional(),
} as const;
export const ToolCallEndFields = {
  toolCallId: z.string().min(1), sourceToolCallId: z.string().min(1).optional(), toolName: z.string(),
  capability: StandardCapabilityDescriptor.optional(), result: z.unknown(), ok: z.boolean(),
} as const;
export const ExecutionEvent = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("skill_activity"), fact: SkillActivityFact }),
  z.object({ ...base, kind: z.literal("interjection"), interjectionId: z.string(), text: z.string(), status: InterjectionStatus }),
  z.object({ ...base, kind: z.literal("status"), status: z.enum(["running", "succeeded", "failed", "paused", "cancelled", "awaiting_tool_permission"]) }),
  z.object({ ...base, kind: z.literal("final_message"), messageId: z.string().min(1) }),
  z.object({ ...base, kind: z.literal("text_delta"), messageId: z.string().min(1), delta: z.string() }),
  z.object({ ...base, kind: z.literal("tool_start"), ...ToolCallStartFields }),
  z.object({ ...base, kind: z.literal("tool_end"), ...ToolCallEndFields }),
]);
export type ExecutionEvent = z.infer<typeof ExecutionEvent>;
export type ExecutionEventInput = ExecutionEvent extends infer E ? E extends ExecutionEvent ? Omit<E, "runId" | "seq" | "emittedAt"> : never : never;
export function parseExecutionEvent(value: unknown): ExecutionEvent | null {
  const parsed = ExecutionEvent.safeParse(value);
  return parsed.success ? parsed.data : null;
}
