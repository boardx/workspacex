import type { subtaskRun as C } from "@repo/contracts";

export type SubtaskRunStatus = C.SubtaskRunStatus;
export type SubtaskRunView = C.SubtaskRun;

export const SUBTASK_RUN_STATUS_LABEL: Record<SubtaskRunStatus, string> = {
  pending: "排队中",
  running: "进行中",
  completed: "已完成",
  failed: "出错",
  cancelled: "已取消",
};

export const SUBTASK_RUN_STATUS_TONE: Record<
  SubtaskRunStatus,
  "primary" | "ai" | "danger" | "neutral"
> = {
  pending: "neutral",
  running: "ai",
  completed: "primary",
  failed: "danger",
  cancelled: "neutral",
};

export function isSubtaskRunActive(run: SubtaskRunView): boolean {
  return run.status === "pending" || run.status === "running";
}
