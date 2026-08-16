/**
 * F190（design-delta `tool-trace-cross-run-context`，人类 2026-08-16 对收窄后的选项作答，
 * PR #1409 签核）—— 工具调用轨迹跨 run 回喂上下文：L1/L2/L3 之外的**第四类**上下文来源。
 *
 * ## 这个文件是什么，不是什么
 *
 * `agent_run_steps`（`kind='tool_call'`）已经记录了 `tool_name`/`tool_args_summary`/
 * `tool_result_summary`/`planning_note`（各 ≤1000 字符，见 wave2-runtime.ts 契约）——数据
 * 已经在采集、已经在持久化，本文件只是把它接进历史组装管线的一层薄读取 + 纯组装，不新建表、
 * 不新建列、不重新实现工具调用本身的记录逻辑（那是 `execute-run.ts` 的 `record()`）。
 *
 * ## 与 L3（file-retrieval.ts）刻意同构：失败降级，不 block
 *
 * 同 L3 的既有纪律（见该文件头注）：读取失败时「本次没有工具轨迹」是诚实的答案，不是错误。
 * 降级发生在调用点（`execute-run.ts`），本文件只保证自己的纯函数不抛。
 *
 * ## §1① 范围窗口：最近 3 轮 run
 *
 * 覆盖单轮直接追问与跨多轮的慢任务，不像"只读上一次 run"那样第 2 轮之后立刻断链。
 * `TOOL_TRACE_RUN_LIMIT` 是唯一事实源，可后续 ±1 微调；超出此范围需回到 delta 重签
 * （见 design-signoff.md）。
 *
 * ## §1② 与 L1 去重
 *
 * 若某轮 run 的输出消息仍落在 L1 近端窗口内，跳过该轮的工具轨迹——L1 原文已经包含触发该次
 * 工具调用的用户消息与最终回复文字，信息更完整，重复注入只会挤占预算又不增加信息量。
 * `buildToolTraceMessage` 的 `l1MessageIds` 参数就是这条判据：调用点把 L1 已保留消息的 id
 * 集合传进来，本函数据此过滤。
 *
 * ## 自身预算：`TOOL_TRACE_MAX_CHARS`
 *
 * 这份代码库里 L1（`HISTORY_MAX_CHARS`）与 L3（`FILE_RETRIEVAL_TOTAL_MAX_CHARS`）都是「自己
 * 有一个独立预算上限」，而不是与其它层共享一个跨层仲裁的总预算池——L2 摘要与 L3 检索目前也
 * 是无条件前置、不参与任何跨层裁剪。工具轨迹遵循同一个既有现实：自身有界（装不下的整条丢弃，
 * 不截半句，同 `buildFileContextMessage` 的既有纪律），不是发明一个这份代码库里其它层都没有
 * 的跨层预算仲裁器。§1②"L1 > L2 > 工具轨迹 > L3"这条优先级顺序体现在**注入位置**
 * （见 `execute-run.ts` 调用点：`[L3, 工具轨迹, L2摘要, ...L1]`，越靠后越贴近当前轮、越优先）
 * 而不是一个精确控制字节分配的裁剪器。
 */
import type { OrgId } from "../../domain/org-id";
import type { ThreadHistoryMessage } from "./ports";

/** F190 §1①：最近几轮 run 的 tool_call 作为候选来源。 */
export const TOOL_TRACE_RUN_LIMIT = 3;

/** 整条工具轨迹伪消息的字符上限（同 L3 `FILE_RETRIEVAL_TOTAL_MAX_CHARS` 一样的独立预算）。 */
export const TOOL_TRACE_MAX_CHARS = 4_000;

/** 伪消息正文的开头——同 `FILE_CONTEXT_MESSAGE_HEADER_PREFIX` 的既有判据用途：读侧用它区分
 *  "这是系统注入的工具轨迹" 与 "agent 历史回复里字面提到了同样的词"。 */
export const TOOL_TRACE_MESSAGE_HEADER_PREFIX = "[近期工具调用记录";

/** 一次 `tool_call` step 的展示形状——`execute-run.ts` `record()` 落库的四个字段原样传入。 */
export interface ToolCallTraceStep {
  readonly toolName: string;
  readonly toolArgsSummary: string | null;
  readonly toolResultSummary: string | null;
  readonly planningNote: string | null;
}

/**
 * 一轮历史 run 的工具调用轨迹。`outputMessageId` 是该 run 写回的 assistant 消息 id
 * （`chat_messages.agent_run_id` 唯一索引反查，见 `pg-tool-trace-context.ts`）——
 * `null` 表示该 run 还没有（或从未有）写回消息，此时无法判定"是否仍在 L1 窗口内"，
 * 保守地当作"不在 L1 窗口内"处理（不跳过，因为找不到证据说它已被 L1 原文覆盖）。
 */
export interface ToolCallTraceRun {
  readonly runId: string;
  readonly outputMessageId: string | null;
  /** oldest-first，同一 run 内按 `seq` 顺序。 */
  readonly steps: readonly ToolCallTraceStep[];
}

export interface ToolTraceContextPort {
  /**
   * 该线程内、排除当前正在执行的 `excludeRunId`、最近 `runLimit` 轮**曾经记录过至少一个
   * `tool_call` step** 的历史 run，按时间倒序（最近的在前）。
   *
   * 抛错是允许的（DB 抖动）——调用点降级为"本次没有工具轨迹"，绝不 fail run（同
   * `FileRetrievalPort.search` 既有纪律）。
   */
  recent(
    orgId: OrgId,
    threadId: string,
    excludeRunId: string,
    runLimit: number,
  ): Promise<readonly ToolCallTraceRun[]>;
}

/** 单个 step 渲染成一行——四个字段里非空的都带上，全空的 step 不该出现（`recent` 只回
 *  有 `tool_call` step 的 run，但防御性地允许 step 本身字段全 null）。 */
function renderStep(step: ToolCallTraceStep): string {
  const parts = [`工具：${step.toolName}`];
  if (step.toolArgsSummary) parts.push(`参数：${step.toolArgsSummary}`);
  if (step.toolResultSummary) parts.push(`结果：${step.toolResultSummary}`);
  if (step.planningNote) parts.push(`计划说明：${step.planningNote}`);
  return `- ${parts.join(" / ")}`;
}

/**
 * F190 §1②③⑤ 的纯组装函数——`l1MessageIds` 是调用点已经算出的 L1 近端窗口消息 id 集合，
 * 落在其中的 run 被跳过（去重，见本文件头注）。零候选 / 全部被去重后为空 ⇒ 返回 `null`
 * （不插一条"没有工具轨迹"的噪声，同 `buildFileContextMessage` 零命中时的既有纪律）。
 */
export function buildToolTraceMessage(
  runs: readonly ToolCallTraceRun[],
  l1MessageIds: ReadonlySet<string>,
): ThreadHistoryMessage | null {
  const eligible = runs.filter((r) => {
    if (r.outputMessageId === null) return true; // 找不到证据说它已被 L1 覆盖 ⇒ 保守不跳过
    return !l1MessageIds.has(r.outputMessageId);
  });
  const blocks: string[] = [];
  let used = 0;
  outer: for (const run of eligible) {
    for (const step of run.steps) {
      const line = renderStep(step);
      // 总预算是硬的：装不下的整条丢弃，不截半句（同 L3 `buildFileContextMessage` 既有纪律）。
      if (used + line.length > TOOL_TRACE_MAX_CHARS && blocks.length > 0) break outer;
      blocks.push(line);
      used += line.length;
    }
  }
  if (blocks.length === 0) return null;
  return {
    role: "assistant",
    content: `${TOOL_TRACE_MESSAGE_HEADER_PREFIX}（共 ${blocks.length} 条）]\n${blocks.join("\n")}`,
  };
}
