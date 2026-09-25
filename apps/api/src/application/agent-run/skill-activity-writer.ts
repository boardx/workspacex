import type { SkillActivityFact } from "@repo/contracts/skill-activity";
import type { ToolProgressStream } from "@repo/contracts/execution-journal";
import type { OrgId } from "../../domain/org-id";
import type { AgentRunStore } from "./ports";

/** Bind identity in the trusted executor; acknowledge only a completed journal write. */
export function createSkillActivityWriter(
  store: Pick<AgentRunStore, "appendExecutionEvent">,
  orgId: OrgId,
  runId: string,
  attemptId: string,
): (fact: SkillActivityFact) => Promise<void> {
  return async fact => {
    if (!store.appendExecutionEvent) throw new Error("skill_activity_writer_unavailable");
    await store.appendExecutionEvent(orgId, runId, { kind: "skill_activity", attemptId, fact });
  };
}

/**
 * 2026-09-22 —— 写一条**缺页标记**（`skill_activity_gap`）。
 *
 * 与 `createSkillActivityWriter` 的纪律相反：那条写不进去要抛（事实丢了就是账本缺页，
 * 而那正是它要证明的东西）；这条**本身就是**「有东西没收到」的记录，为它再失败一次只会
 * 把一条本来被救回来的 run 重新判死。所以吞掉写失败并 log。
 */
export function createSkillActivityGapWriter(
  store: Pick<AgentRunStore, "appendExecutionEvent">,
  orgId: OrgId,
  runId: string,
  attemptId: string,
  log: (message: string, fields: Record<string, unknown>) => void,
): (note: string) => Promise<void> {
  return async note => {
    try {
      await store.appendExecutionEvent?.(orgId, runId, { kind: "skill_activity_gap", attemptId, note });
      log("skill activity gap recorded", { runId, code: "SKILL_ACTIVITY_GAP" });
    } catch (error) {
      log("skill activity gap append failed", {
        runId, code: "SKILL_ACTIVITY_GAP_APPEND_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

/**
 * issue #3322 —— 把 kernel 报上来的一条工具内进展写进账本。
 *
 * ## `toolCallId` 必须用**账本自己的命名**，不是 kernel 给的那个
 *
 * `execute-run.ts` 写 `tool_start`/`tool_end` 时用的是 `${attemptId}:${providerToolCallId}`
 * （见那里的 `appendExecutionEvent` 调用）。进展事件要挂到**同一行工具**下面，就必须用
 * 逐字相同的构造——这里照抄那一处的形状，不是第二种 id 语义。kernel 原始 id 同时留在
 * `sourceToolCallId` 里，与 `tool_start` 的做法一致。
 *
 * ## 写失败**不抛**
 *
 * 见 `ModelCallInput.onToolProgress` 的头注：进展是有损通道。这里吞掉写失败并 log，
 * 不让它把一次本来会成功的 run 变成失败——但不静默，log 带错误码。
 */
export function createToolProgressWriter(
  store: Pick<AgentRunStore, "appendExecutionEvent">,
  orgId: OrgId,
  runId: string,
  attemptId: string,
  log: (message: string, fields: Record<string, unknown>) => void,
): (progress: ToolProgressStream) => Promise<void> {
  return async progress => {
    try {
      await store.appendExecutionEvent?.(orgId, runId, {
        kind: "tool_progress", attemptId,
        toolCallId: `${attemptId}:${progress.toolCallId}`,
        sourceToolCallId: progress.toolCallId,
        toolName: progress.toolName, message: progress.message,
      });
    } catch (error) {
      log("tool progress append failed", {
        runId, code: "TOOL_PROGRESS_APPEND_FAILED",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
