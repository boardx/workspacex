import { Bot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

import { AGENTS_NAV_LABEL } from "@/lib/navigation";
import { PREVIEW_AGENT_TEAMS, findPreviewAgentTeam } from "@/lib/mock/agent-previews";
import { mockIdentity } from "@/lib/identity";
import {
  RatingWorkbench,
  type WorkbenchState,
  type WorkbenchDialog,
  type PreviewRoleCode,
} from "@/components/postinvest-rating/rating-workbench";

/**
 * 每个 team 一条真实路由（2026-09-15 人类直接要求「每个 team 的 card 点击都要对应有一个 route」）。
 * 地址栏可分享、可刷新、可直达。
 *
 * ⚠ Team2 = 投后财务项目评级 Agent 工作台（Phase 16 F03，UI 先行）：这里把 Team2 的只读示例
 *   换成用真实组件 + mock 做出的工作台（ui-prototyper 硬规则 ②③④）。其余 team 仍是只读示例，
 *   示例数据的单一事实源在 `lib/mock/agent-previews.ts`，本页不另写一份 team 名单。
 */
export function generateStaticParams() {
  return PREVIEW_AGENT_TEAMS.map((team) => ({ teamId: team.slug }));
}

const WORKBENCH_STATES: readonly WorkbenchState[] = [
  "default", "loading", "empty", "running", "hitl", "result", "validation", "dependency", "forbidden",
];
const WORKBENCH_DIALOGS: readonly WorkbenchDialog[] = ["none", "feedback", "recorded", "confirm"];
const PREVIEW_ROLES: readonly PreviewRoleCode[] = ["consultant", "lead", "admin", "compliance"];

function pick<T extends string>(allowed: readonly T[], raw: string | string[] | undefined, fallback: T): T {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (allowed as readonly string[]).includes(v ?? "") ? (v as T) : fallback;
}

export default function AgentTeamPage({
  params,
  searchParams,
}: {
  params: { teamId: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const team = findPreviewAgentTeam(params.teamId);
  if (!team) notFound();

  if (team.slug === "team2") {
    const state = pick(WORKBENCH_STATES, searchParams?.state, "default");
    const dialog = pick(WORKBENCH_DIALOGS, searchParams?.dialog, "none");
    const role = pick(PREVIEW_ROLES, searchParams?.role, "consultant");
    // 原型预览：传 mock identity 让壳层直接渲染（签核阶段不接真实登录/会话，ui-prototyper 硬规则 ③）。
    return (
      <AppShell identity={mockIdentity("org-yuanyang", null)} previewRole={null} hideRoleSwitcher>
        <div className="min-w-0 flex-1 overflow-y-auto bg-background">
          <RatingWorkbench initialState={state} initialDialog={dialog} initialRole={role} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell previewRole={null}>
      <div className="min-w-0 flex-1 overflow-y-auto bg-background">
        <div data-testid="agent-team-page" data-team={team.slug} className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
          <header className="space-y-2">
            <p className="text-11 font-medium text-muted-foreground">
              <Link href="/agent" className="transition-colors duration-base hover:underline">Studio / {AGENTS_NAV_LABEL}</Link> / {team.name}
            </p>
            <h1 className="text-24 font-semibold tracking-tight">{team.name}</h1>
            <p className="text-12 leading-relaxed text-muted-foreground">{team.summary}</p>
          </header>
          <section className="mt-6 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
            <Bot aria-hidden className="size-8 text-muted-foreground" />
            <p className="mt-4 text-12 leading-relaxed text-muted-foreground">
              该 team 对应一个 Agent 的项目。当前为示例展示，尚未接入真实项目数据。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild variant="outline" size="sm">
                <Link href="/projects">查看项目</Link>
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href="/agent">返回{AGENTS_NAV_LABEL}</Link>
              </Button>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
