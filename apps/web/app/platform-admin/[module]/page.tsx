import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { AgentScreen } from "@/components/admin/agent-screen";
import { ModelScreen } from "@/components/admin/model-screen";
import { McpScreen } from "@/components/admin/mcp-screen";
import { FeedbackScreen } from "@/components/admin/feedback-screen";
import { PlatformMembersScreen } from "@/components/admin/platform-members-screen";
import { resolvePreviewState, type UiState } from "@/lib/ui-state";
import { resolvePreviewRole } from "@/lib/identity";
import type { AdminModuleKey } from "@/lib/mock/admin";
import { PLATFORM_ADMIN_ROUTES } from "@/lib/platform-admin-routes";

/**
 * 平台后台 `/platform-admin/<module>`（2026-09-02 人类直接裁决，后台切成两面——见
 * `lib/mock/admin.ts` 的 `AdminScope`）。
 *
 * 这一面管的是**整个平台**而不是当前组织：AI 能力目录（Agent / 模型 / MCP，2026-09-02
 * 第二次裁决迁入）、全平台账号名册（平台成员）、全体用户反馈（反馈与迭代）。页头不挂「组织：xxx」身份卡（`hideOrgIdentity`），左栏只画平台面的组。
 *
 * 路由段 → 模块键的表在 `lib/platform-admin-routes.ts`；这里只接模块键 → 屏组件。
 * 两张表的键集合与 `adminNavForScope("platform")` 声明的 href 三方一致，由
 * `tests/ui/admin-scope-split.test.tsx` 机械核对——只补左栏不给落点 = 点进去 404。
 */
const SCREENS: Partial<Record<AdminModuleKey, (p: { state: UiState }) => React.ReactNode>> = {
  agent: AgentScreen,
  model: ModelScreen,
  mcp: McpScreen,
  platform: PlatformMembersScreen,
  feedback: FeedbackScreen,
};

export function generateStaticParams() {
  return Object.keys(PLATFORM_ADMIN_ROUTES).map((module) => ({ module }));
}

export default function PlatformAdminModulePage({
  params, searchParams,
}: {
  params: { module: string };
  searchParams: { state?: string; as?: string; org?: string };
}) {
  const key = PLATFORM_ADMIN_ROUTES[params.module];
  const Screen = key ? SCREENS[key] : undefined;
  if (!key || !Screen) notFound();

  const state = resolvePreviewState(searchParams.state);
  const previewRole = resolvePreviewRole(searchParams.as);

  return (
    <AppShell previewRole={previewRole} left={<AdminNav active={key} scope="platform" />}>
      <Screen state={state} />
    </AppShell>
  );
}
