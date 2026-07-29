import { AppShell } from "@/components/shell/app-shell";
import { ProjectsScreen } from "@/components/projects/projects-screen";
import { resolvePreviewState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";

/**
 * 项目列表（UC-2.2 / 原型第三节）
 *
 * 服务端组件：只读 searchParams（state / as / org），解析身份，套 AppShell。
 * 交互与七态 StateShell（含 onCreate/retry 事件处理器）都在 ProjectsScreen（"use client"）里。
 * 原型此屏为「单一宽栏」，不带左右上下文栏——故 AppShell 只填 children。
 */
export default function ProjectsPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell identity={identity} previewRole={previewRole}>
      <ProjectsScreen state={state} />
    </AppShell>
  );
}
