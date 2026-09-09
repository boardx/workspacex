"use client";
import * as React from "react";
import type { TraceEntry } from "./run-trace";

/**
 * 「这次工具调用成没成」在执行轨迹里的**唯一**事实源。
 *
 * issue #3204 ①：这件事实此前被算了两遍。
 *   · 外层折叠行：`TraceEntry.status` ← 执行日志的 `tool_end.ok`（权威）；
 *   · 内层工具卡：`@copilotkit/react-core` 的 `ToolCallRenderer` —— 它只看
 *     「有没有 toolMessage」，有就发 `ToolCallStatus.Complete`。框架的三态
 *     （inProgress / executing / complete）**根本没有失败**，于是"失败"这件事在
 *     `render()` 边界上被丢掉、又被重新发明成"成功"：同一屏上外层写「执行工具操作
 *     失败」+ 红色感叹号，内层却是绿色对勾。
 *
 * 修法不是"让两处各自改对"，是收敛：轨迹面板把权威状态经这个 context 下发，
 * 工具卡在拿得到它时**一律以它为准**，不再自己从"有没有结果"推断成败。
 *
 * 值为 `null` = 不在执行轨迹里（实时消息流里的工具卡没有日志条目可依），此时保持
 * 既有行为、仍用框架状态——这条通道不是新的第二事实源，是"没有事实可用"的缺省。
 */
export type JournalToolOutcome = TraceEntry["status"];

export const JournalToolOutcomeContext = React.createContext<JournalToolOutcome | null>(null);

export function useJournalToolOutcome(): JournalToolOutcome | null {
  return React.useContext(JournalToolOutcomeContext);
}

/** 工具卡的展示态：框架三态 + 日志才有的失败态。 */
export type ToolCardStatus = "inProgress" | "executing" | "complete" | "failed";

/** 有权威日志状态就用它，没有才回落到框架状态。 */
export function useToolCardStatus(frameworkStatus: "inProgress" | "executing" | "complete"): ToolCardStatus {
  const journal = useJournalToolOutcome();
  if (journal === null) return frameworkStatus;
  return journal === "failed" ? "failed" : journal === "running" ? "executing" : "complete";
}

/** 已落定（成功或失败）——「进行中」徽标与结果正文都以它为界，不再以 `=== "complete"` 为界。 */
export function isSettled(status: ToolCardStatus): boolean {
  return status === "complete" || status === "failed";
}
