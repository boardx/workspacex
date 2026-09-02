import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { AgentScreen } from "@/components/admin/agent-screen";
import { ModelScreen } from "@/components/admin/model-screen";
import { McpScreen } from "@/components/admin/mcp-screen";
import { MembersScreen } from "@/components/admin/members-screen";
import { FeedbackScreen } from "@/components/admin/feedback-screen";
import { LocalOrgScreen } from "@/components/admin/local-org-screen";
import { PlatformMembersScreen } from "@/components/admin/platform-members-screen";
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
 *   `ADMIN_NAV` 的这两项 href 已经直接指向 `/tpl/list`、`/skill`（真实的蓝本设计器 / Skill
 *   库与市场，不再经过 `/admin/blueprint`、`/admin/skill` 这两个曾经的空壳/简单 CRUD 页）。
 *   旧路由**保留重定向**（见下方 `REDIRECTS`），不留死链，给还停在旧书签的人一个去处。
 *   ⚠ 2026-08-14：`blueprint` 的重定向目标从 `/tpl` 改为 `/tpl/list`（生产入口不带
 *   原型切换器），理由同 `lib/mock/admin.ts` 里 `blueprint` 项 href 的改动注释。
 * ⚠ 2026-08-15（人类直接裁决，D-43，推翻 D-42 ⑤）：`canvasadmin` 同样**不再在这里落地**——
 *   人类看真实后台截图后原话「画布模板……右边的列表，应该和打开模板和编辑器的界面整合，
 *   合并成一个」。`ADMIN_NAV` 的 `canvasadmin` 项 href 已直接指向
 *   `/canvas/template-admin`（真实的模板库与编辑器，`TemplateAdmin` 组件），
 *   `/admin/canvasadmin` 退役为重定向，不留死链。旧的 `CanvasTemplateScreen`（清单 + 跳转链接）
 *   不再被任何路由引用，保留文件留痕（同 `blueprint-screen.tsx` 先例）。见
 *   `phases/requirements/DECISIONS-FINAL.md` D-43。
 *   ⚠ 2026-08-30（路由复盘）：重定向目标从历史 `/canvas?screen=template-admin` 改成
 *   路径段 `/canvas/template-admin`，见 `lib/canvas-screens.ts` 头注。
 */
const REDIRECTS: Partial<Record<string, string>> = {
  blueprint: "/tpl/list",
  skill: "/skill?screen=catalog",
  canvasadmin: "/canvas/template-admin",
};

const SCREENS: Partial<Record<AdminModuleKey, (p: { state: UiState }) => React.ReactNode>> = {
  agent: AgentScreen,
  model: ModelScreen,
  mcp: McpScreen,
  members: MembersScreen,
  feedback: FeedbackScreen,
  local: LocalOrgScreen,
  // member-role-management delta：成员管理的平台级（组织级在 /org-admin 的「成员」标签页）。
  platform: PlatformMembersScreen,
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
