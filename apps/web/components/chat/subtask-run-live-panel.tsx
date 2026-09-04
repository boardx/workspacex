"use client";
import { useSubtaskRuns, useRetrySubtaskRun } from "@/lib/chat/use-subtask-runs";
import { SubtaskRunPanel } from "./subtask-run-panel";
import type { SubtaskRunView } from "@/lib/mock/subtask-run";

/**
 * `SubtaskRunPanel` 接真实数据的薄容器——`useSubtaskRuns` 轮询
 * `GET /agent-runs/:runId/subtask-runs`（issue #2666），"重试这一个"接
 * `POST /agent-runs/:runId/subtask-runs/:id/retry`（简化实现，见该端点头注）。
 *
 * 与纯展示的 `SubtaskRunPanel` 分开成两个文件：后者拿 `runs` 数组即可渲染，
 * 组件测试（mock 三态数据）与故事化预览都直接用它，不需要真的起一个 query
 * client/mock fetch；只有接真实后端的调用点（页面 / `ai-message.tsx` 真实挂载处）
 * 才需要这层轮询与 mutation 的胶水。
 *
 * `parentRunId` 为 `null`（这条 AI 消息没有触发任何子任务）时不渲染任何东西——
 * 与 `SubtaskRunPanel` 自己在 `runs.length === 0` 时的处理一致。
 */
export function SubtaskRunLivePanel({ parentRunId }: { parentRunId: string | null }) {
  const { data } = useSubtaskRuns(parentRunId);
  const retry = useRetrySubtaskRun(parentRunId ?? "");

  if (parentRunId === null) return null;
  const runs: SubtaskRunView[] = data ?? [];
  if (runs.length === 0) return null;

  return (
    <SubtaskRunPanel
      parentRunId={parentRunId}
      runs={runs}
      onRetry={(run) => retry.mutate(run.id)}
      retryingId={retry.isPending ? (retry.variables ?? null) : null}
    />
  );
}
