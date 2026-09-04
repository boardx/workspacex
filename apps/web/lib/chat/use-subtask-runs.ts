"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { subtaskRun as C } from "@repo/contracts";
import { apiRequest } from "../api-client";
import { queryKeys } from "../query-keys";
import { isSubtaskRunActive, type SubtaskRunView } from "../mock/subtask-run";

/**
 * `GET /agent-runs/:runId/subtask-runs`（issue #2666）—— 前端后台任务面板的取数源。
 *
 * ## 为什么是轮询，不是 WebSocket/SSE
 *
 * 读过 issue #2664 对应 PR（#2675）的完整 diff：`spawn_async_task` 只回调 TS 侧一个
 * 内部 `POST /internal/subtask-runs` 入队端点，没有任何面向浏览器的推送通路。本 PR
 * （#2666）新增的 `GET /agent-runs/:runId/subtask-runs` 是同一批改动里补的最小可行查询
 * 接口——轮询是 issue 原文明确允许的最小实现（"轮询是可接受的最小实现"），接入真实
 * WebSocket/SSE 推送留作后续，不在本 issue 范围内。
 *
 * ## 轮询节奏：还有子任务未到终态才继续问
 *
 * `refetchInterval` 拿到当前 `data` 后自己判断——一旦这个父 run 下所有子任务都已经是
 * `completed`/`failed`（终态），停止轮询（返回 `false`），不长期占用后端连接；用户重新
 * 打开面板或父 run 又派发新子任务时，`enabled`/`refetchOnMount` 会让它重新问一轮。
 */
export async function fetchSubtaskRuns(parentRunId: string): Promise<SubtaskRunView[]> {
  const result = await apiRequest<C.ListSubtaskRunsResult>(
    `/agent-runs/${encodeURIComponent(parentRunId)}/subtask-runs`,
    { method: "GET" },
  );
  return result.subtaskRuns;
}

const POLL_INTERVAL_MS = 3_000;

export function useSubtaskRuns(parentRunId: string | null) {
  return useQuery({
    queryKey: queryKeys.subtaskRuns.byParentRun(parentRunId ?? ""),
    queryFn: () => fetchSubtaskRuns(parentRunId as string),
    enabled: parentRunId !== null,
    refetchInterval: (query) => {
      const data = query.state.data as SubtaskRunView[] | undefined;
      if (!data || data.length === 0) return POLL_INTERVAL_MS;
      return data.some(isSubtaskRunActive) ? POLL_INTERVAL_MS : false;
    },
  });
}

/**
 * "重试这一个"（issue #2666 验收标准第三条）—— 简化实现：见
 * `subtask-run.controller.ts` 的 `retry()` 头注，重新入队一条新记录，不是让失败那条
 * 原地复活。成功后让本 parentRunId 的列表 query 失效，下一次轮询/`refetch` 会带出
 * 新入队的那条。
 */
export async function retrySubtaskRun(parentRunId: string, subtaskRunId: string): Promise<void> {
  await apiRequest(
    `/agent-runs/${encodeURIComponent(parentRunId)}/subtask-runs/${encodeURIComponent(subtaskRunId)}/retry`,
    { method: "POST" },
  );
}

export function useRetrySubtaskRun(parentRunId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (subtaskRunId: string) => retrySubtaskRun(parentRunId, subtaskRunId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subtaskRuns.byParentRun(parentRunId) });
    },
  });
}
