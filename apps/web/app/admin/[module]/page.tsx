import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { AgentScreen } from "@/components/admin/agent-screen";
import { SkillScreen } from "@/components/admin/skill-screen";
import { ModelScreen } from "@/components/admin/model-screen";
import { McpScreen } from "@/components/admin/mcp-screen";
import { CanvasTemplateScreen } from "@/components/admin/canvas-template-screen";
import { BlueprintScreen } from "@/components/admin/blueprint-screen";
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
 */
const SCREENS: Partial<Record<AdminModuleKey, (p: { state: UiState }) => React.ReactNode>> = {
  agent: AgentScreen,
  skill: SkillScreen,
  model: ModelScreen,
  mcp: McpScreen,
  canvasadmin: CanvasTemplateScreen,
  blueprint: BlueprintScreen,
  members: MembersScreen,
  feedback: FeedbackScreen,
  local: LocalOrgScreen,
};

export function generateStaticParams() {
  return Object.keys(SCREENS).map((module) => ({ module }));
}

export default function AdminModulePage({
  params, searchParams,
}: {
  params: { module: string };
  searchParams: { state?: string; as?: string; org?: string };
}) {
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
