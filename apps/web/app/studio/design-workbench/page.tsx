import { AppShell } from "@/components/shell/app-shell";
import { StudioDesignWorkbenchScreen } from "@/components/design-loop/studio-workbench-screen";
import { resolvePreviewState } from "@/lib/ui-state";
import { resolvePreviewRole } from "@/lib/identity";

/**
 * Studio 一级导航「设计」的独立落点（2026-09-05 人类直接反馈，截图实测）：
 * 选中 STUDIO 的「设计」时，左栏不该带出平台后台的 `AdminNav` 宽侧栏——
 * 那是给平台运维用的两层 chrome，Studio 用户一步直达设计工作台不该看到它。
 *
 * 与 `/platform-admin/design-workbench`（`app/platform-admin/[module]/page.tsx`）
 * 复用同一个真栈组件 `DesignWorkbenchHome`，区别只是这里不套 `AdminNav`、
 * `left` 留空 —— `AppShell` 据此不渲染宽侧栏（见 `components/shell/app-shell.tsx`
 * 对 `left` 的处理）。平台后台那个入口本身不下线，两者是独立路由、独立入口。
 */
export default function StudioDesignWorkbenchPage({
  searchParams,
}: {
  searchParams: { state?: string; as?: string };
}) {
  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);

  return (
    <AppShell previewRole={previewRole}>
      <StudioDesignWorkbenchScreen state={state} />
    </AppShell>
  );
}
