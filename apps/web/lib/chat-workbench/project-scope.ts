import { createPersonalThread, createThread, listPersonalThreads, listThreads, type ListPersonalThreadsOut } from "@/lib/live-chat";
export function workbenchThreadPath(threadId: string | null, projectId: string | null): string {
  const path = threadId ? `/chat/${encodeURIComponent(threadId)}` : "/chat";
  return projectId ? `${path}?projectId=${encodeURIComponent(projectId)}` : path;
}
export function createWorkbenchThread(projectId: string | null) {
  return projectId ? createThread({ projectId, groupId: null, title: "新对话", visibilityScope: "private" }) : createPersonalThread(null);
}
/**
 * issue #3356 —— 分页只加在**个人**对话列表上（`listPersonalThreads`）。
 *
 * 项目对话走的是另一个契约操作（`listThreads`，path 上带 `:projectId`），本次没有
 * 给它加分页——那是一次独立的契约新增，判据/迁移影响都是另一套。这里把它的返回
 * 补上 `nextCursor: null`，让**调用方只有一种形状**要处理：`null` 逐字就是
 * 「没有下一页」，于是项目对话那一侧「加载更多」按钮天然不渲染，不需要在组件里
 * 写一句 `if (projectId)` 的特例——那种特例正是同一件事分两处判的开端。
 *
 * ⚠ 不要把这句 `nextCursor: null` 读成「项目对话已经翻到底了」。它说的是
 *   「这条链路上没有分页这回事」。给 `listThreads` 加分页时，改的是这一行，
 *   不是各个组件。
 */
export function listWorkbenchThreads(
  projectId: string | null,
  bearer: string,
  signal?: AbortSignal,
  page: { limit?: number; cursor?: string | null; q?: string | null } = {},
): Promise<ListPersonalThreadsOut> {
  if (projectId) {
    return listThreads(projectId, {}, bearer, signal).then((out) => ({ ...out, nextCursor: null }));
  }
  return listPersonalThreads(page, bearer, signal);
}
