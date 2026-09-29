import { AppShell } from "@/components/shell/app-shell";
import { resolvePreviewRole } from "@/lib/identity";
import { TodayBoardLive } from "@/components/tasks/today-board-live";

/**
 * 任务看板 · 我的今天 —— UC-11.5（四语义分区）。
 *
 * 只走真实数据：`AppShell` 不传 `identity`，顶栏身份/组织来自登录会话（未登录由壳层
 * 跳 `/login`）；内容区 `TodayBoardLive` 只读 `GET /tasks/today`。
 * 七态 mock 演示与原型左右栏已搬到 `/preview/tasks`，生产路径不再回落到 mock。
 */
export default function TasksPage({ searchParams }: { searchParams: { as?: string } }) {
  const previewRole = resolvePreviewRole(searchParams.as);
  return (
    <AppShell previewRole={previewRole}>
      <TodayBoardLive />
    </AppShell>
  );
}
