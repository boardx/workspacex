import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { AgentScreen } from "@/components/admin/agent-screen";
import { ModelScreen } from "@/components/admin/model-screen";
import { McpScreen } from "@/components/admin/mcp-screen";
import { CanvasTemplateScreen } from "@/components/admin/canvas-template-screen";
import { MembersScreen } from "@/components/admin/members-screen";
import { FeedbackScreen } from "@/components/admin/feedback-screen";
import { LocalOrgScreen } from "@/components/admin/local-org-screen";
import { resolvePreviewState, type UiState } from "@/lib/ui-state";
import { resolvePreviewRole } from "@/lib/identity";
import type { AdminModuleKey } from "@/lib/mock/admin";

/**
 * module 段 → 屏组件。overview 走 /admin（见同级 page.tsx），这里接其余各项。
 *
 * ⚠ 左栏「AI 能力」组的六项**必须**在这里都有落点：只补左栏而不给落点，
 * 会把「缺入口」换成「点进去 404」——那正是 F132 要修的那条投诉的另一半。
 *
 * ⚠ 2026-08-11（人类直接裁决，真合并）：`blueprint` 与 `skill` **不再在这里落地**——
 *   `ADMIN_NAV` 的这两项 href 已经直接指向 `/tpl`、`/skill`（真实的蓝本设计器 / Skill
 *   库与市场，不再经过 `/admin/blueprint`、`/admin/skill` 这两个曾经的空壳/简单 CRUD 页）。
 *   旧路由**保留重定向**（见下方 `REDIRECTS`），不留死链，给还停在旧书签的人一个去处。
 */
const REDIRECTS: Partial<Record<string, string>> = {
  blueprint: "/tpl",
  skill: "/skill?screen=catalog",
};

const SCREENS: Partial<Record<AdminModuleKey, (p: { state: UiState }) => React.ReactNode>> = {
  agent: AgentScreen,
  model: ModelScreen,
  mcp: McpScreen,
  canvasadmin: CanvasTemplateScreen,
  members: MembersScreen,
  feedback: FeedbackScreen,
  local: LocalOrgScreen,
};

export function generateStaticParams() {
  return [...Object.keys(SCREENS), ...Object.keys(REDIRECTS)].map((module) => ({ module }));
}

export default function AdminModulePage({
  params, searchParams,
}: {
  params: { module: string };
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const redirectTo = REDIRECTS[params.module];
  if (redirectTo) redirect(redirectTo);

  const Screen = SCREENS[params.module as AdminModuleKey];
  if (!Screen) notFound();

  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);

  return (
    <AppShell
      previewRole={previewRole}
      left={<AdminNav active={params.module as AdminModuleKey} />}
    >
      <Screen state={state} />
    </AppShell>
  );
}
