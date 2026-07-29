import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { AdminNav } from "@/components/admin/admin-nav";
import { AgentScreen } from "@/components/admin/agent-screen";
import { SkillScreen } from "@/components/admin/skill-screen";
import { ModelScreen } from "@/components/admin/model-screen";
import { McpScreen } from "@/components/admin/mcp-screen";
import { MembersScreen } from "@/components/admin/members-screen";
import { FeedbackScreen } from "@/components/admin/feedback-screen";
import { LocalOrgScreen } from "@/components/admin/local-org-screen";
import { resolvePreviewState, type UiState } from "@/lib/ui-state";
import { mockIdentity, resolvePreviewRole } from "@/lib/identity";
import type { AdminModuleKey } from "@/lib/mock/admin";

/** module 段 → 屏组件。overview 走 /admin（见同级 page.tsx），这里只接其余 6 个。 */
const SCREENS: Partial<Record<AdminModuleKey, (p: { state: UiState }) => React.ReactNode>> = {
  agent: AgentScreen,
  skill: SkillScreen,
  model: ModelScreen,
  mcp: McpScreen,
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
  const identity = mockIdentity(searchParams.org ?? "org-yuanyang", previewRole);

  return (
    <AppShell
      identity={identity}
      previewRole={previewRole}
      left={<AdminNav active={params.module as AdminModuleKey} />}
    >
      <Screen state={state} />
    </AppShell>
  );
}
