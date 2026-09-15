import { Bot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

import { AGENTS_NAV_LABEL } from "@/lib/navigation";
import { PREVIEW_AGENT_TEAMS, findPreviewAgentTeam } from "@/lib/mock/agent-previews";

/**
 * 每个 team 一条真实路由（2026-09-15 人类直接要求「每个 team 的 card 点击都要对应有一个 route」）。
 * 这里不是弹层、不是 query 参数——地址栏可分享、可刷新、可直达。
 * 内容仍是只读示例（上游没有真实 Agent 项目数据），示例数据的单一事实源在
 * `lib/mock/agent-previews.ts`，本页不另写一份 team 名单。
 */
export function generateStaticParams() {
  return PREVIEW_AGENT_TEAMS.map((team) => ({ teamId: team.slug }));
}

export default function AgentTeamPage({ params }: { params: { teamId: string } }) {
  const team = findPreviewAgentTeam(params.teamId);
  if (!team) notFound();

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
