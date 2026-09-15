import { Bot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

import { AGENTS_NAV_LABEL } from "@/lib/navigation";
import { PREVIEW_AGENT_TEAMS, findPreviewAgentTeam } from "@/lib/mock/agent-previews";
import { Team3StartChatButton } from "@/components/agent/team3-start-chat-button";
import { RatingChat } from "@/components/postinvest-rating/rating-chat";
import { IcReviewLauncher } from "@/components/agent/ic-review-launcher";
import { findAgent as findIcReviewAgent } from "@/lib/ic-review/agent-directory";

/**
 * 每个 team 一条真实路由（2026-09-15 人类直接要求「每个 team 的 card 点击都要对应有一个 route」）。
 * 地址栏可分享、可刷新、可直达。
 *
 * ⚠ Team1 = 上会材料智能审阅助手（ad-hoc MVP，走真实 chat 后端而非 UI 原型）：要调真实
 *   `lib/live-chat.ts` API（建线程/传附件/发消息），必须走真实登录会话，因此不传 `identity`
 *   覆盖，复用页面自身默认的真实 `AppShell`。详情见 `docs/agents/team1-ic-review-mvp.md`。
 * ⚠ Team2 = 投后财务项目评级 Agent（issue #3676，ad-hoc MVP）：真聊天框 + 真算分，不经过
 *   模型工具调用循环——数值全部来自 `apps/api/src/domain/postinvest-rating/scoring.ts`
 *   的确定性评分引擎（真实 `POST /postinvest-ratings/score`），不是编出来的。同 Team1 一样
 *   不传 mock identity，走真实登录会话。此前 UI 先行阶段的原型
 *   （`components/postinvest-rating/rating-workbench.tsx`，mock 数据）仍保留在仓库供
 *   Phase 16 契约束签核材料回溯，但不再是这个路由渲染的东西。
 */
export function generateStaticParams() {
  return PREVIEW_AGENT_TEAMS.map((team) => ({ teamId: team.slug }));
}

export default function AgentTeamPage({ params }: { params: { teamId: string } }) {
  const team = findPreviewAgentTeam(params.teamId);
  if (!team) notFound();
  // 2026-09-15 ad-hoc MVP（`docs/design/agent-team3-mvp-backlog.md`）——只有 team3 接了
  // 真实 Agent + 真实对话；其余五个 team 上游没有真实项目数据，维持原占位行为不变。
  const isTeam3 = team.slug === "team3";

  if (team.slug === "team1") {
    const agent = findIcReviewAgent("team1");
    if (!agent) notFound();
    return (
      <AppShell previewRole={null}>
        <div className="min-w-0 flex-1 overflow-y-auto bg-background">
          <div data-testid="agent-team-page" data-team="team1" className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
            <p className="text-11 font-medium text-muted-foreground">
              <Link href="/agent" className="transition-colors duration-base hover:underline">Studio / {AGENTS_NAV_LABEL}</Link> / {agent.name}
            </p>
            <div className="mt-4"><IcReviewLauncher agent={agent} /></div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (team.slug === "team2") {
    return (
      <AppShell previewRole={null}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
          <RatingChat />
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
              {isTeam3
                ? "点击下方按钮开始与该 Agent 的真实对话——会新建一条绑定该 Agent 的会话。"
                : "该 team 对应一个 Agent 的项目。当前为示例展示，尚未接入真实项目数据。"}
            </p>
            {isTeam3 ? <Team3StartChatButton /> : null}
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
