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
/**
 * issue #3322 —— 一次工具调用**执行期间**的中间进展。
 *
 * ## 为什么必须新增一种事件，而不是复用现有的任何一种
 *
 * 在这之前，一次工具调用在账本里**只有两个时刻**：`tool_start` 与 `tool_end`。
 * 于是 `call_skill` 里那次一口气跑几分钟的聚焦模型调用，在用户眼里就是一段真空——
 * 实测（issue #3316 的诊断）：生成 pptx 跑了 03:54、工具 5 次，轨迹里没有任何一条
 * 能说出"在做什么、到第几步"。展示层再怎么改也变不出这些事实，因为它们**从来没有
 * 被产生过**。
 *
 * ⚠ **不要把这些 stage 塞进 `SkillActivityFact`**：那是一条**溯源**契约（哪个 skill、
 * 哪个 digest、读了哪个正文），它的 `.strict()` 闭合联合是**审计**用的，混进"进展到
 * 哪儿了"这种会变、可丢、纯展示的事实会把一份可审计的溯源记录降级成日志。
 *
 * ## `message` 是**系统写的**一句话，不是模型输出的转发
 *
 * 与 `text_delta`/`skill_activity` 同一条隐私纪律：这里**永远不放模型的私有推理**，
 * 也不放子模型正在生成的正文。只放调用方自己知道的、公开安全的事实（第几步、
 * 已产出多少字）。200 字上限是硬的——它是给人看的一行字，不是一个数据通道。
 *
 * ## 可丢失，且**不是**终态的一部分
 *
 * 进展事件是节流过的采样（见 Python 侧 `call_skill` 的 `_ProgressThrottle`），
 * 丢几条不影响任何终态判定。任何消费端都**不许**用它推断工具是否成功——那是
 * `tool_end.ok` 唯一负责的事。
 */
export const ToolProgressFields = {
  toolCallId: z.string().min(1), sourceToolCallId: z.string().min(1).optional(),
  toolName: z.string(), message: z.string().min(1).max(200),
} as const;
/**
 * 这类事件在 deep-agent-service → apps/api 之间的**线格式**（LangGraph `custom` 流）。
 * 与 `SkillActivityStream` 同一条通道、同一种信封形状，只是 `type` 不同——刻意逐字
 * 对齐，好让 `deep-agent-model-provider.ts` 的 SSE 分支多一个分支就够，不用第二套解析。
 */
export const ToolProgressStream = z.object({
  type: z.literal("tool_progress"), version: z.literal(1),
  toolCallId: z.string().min(1).max(256), toolName: z.string().min(1).max(200),
  message: z.string().min(1).max(200),
}).strict();
export type ToolProgressStream = z.infer<typeof ToolProgressStream>;
export const ExecutionEvent = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("skill_activity"), fact: SkillActivityFact }),
  z.object({ ...base, kind: z.literal("interjection"), interjectionId: z.string(), text: z.string(), status: InterjectionStatus }),
  z.object({ ...base, kind: z.literal("status"), status: z.enum(["running", "succeeded", "failed", "paused", "cancelled", "awaiting_tool_permission"]) }),
  z.object({ ...base, kind: z.literal("final_message"), messageId: z.string().min(1) }),
  z.object({ ...base, kind: z.literal("text_delta"), messageId: z.string().min(1), delta: z.string() }),
  z.object({ ...base, kind: z.literal("tool_start"), ...ToolCallStartFields }),
  z.object({ ...base, kind: z.literal("tool_end"), ...ToolCallEndFields }),
  z.object({ ...base, kind: z.literal("tool_progress"), ...ToolProgressFields }),
]);
export type ExecutionEvent = z.infer<typeof ExecutionEvent>;
export type ExecutionEventInput = ExecutionEvent extends infer E ? E extends ExecutionEvent ? Omit<E, "runId" | "seq" | "emittedAt"> : never : never;
export function parseExecutionEvent(value: unknown): ExecutionEvent | null {
  const parsed = ExecutionEvent.safeParse(value);
  return parsed.success ? parsed.data : null;
}
