import { Bot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

import { AGENTS_NAV_LABEL } from "@/lib/navigation";
import { PREVIEW_AGENT_TEAMS, findPreviewAgentTeam } from "@/lib/mock/agent-previews";
import { Team3ChatScreen } from "@/components/agent/team3-chat";
import { RatingChat } from "@/components/postinvest-rating/rating-chat";
import { Team3StartChatButton } from "@/components/agent/team3-start-chat-button";
import { RatingAgentLauncher } from "@/components/postinvest-rating/rating-agent-launcher";
import { IcReviewLauncher } from "@/components/agent/ic-review-launcher";
import { findAgent as findIcReviewAgent } from "@/lib/ic-review/agent-directory";
import { RATING_AGENT } from "@/lib/postinvest-rating/agent-directory";

/**
 * 每个 team 一条真实路由（2026-09-15 人类直接要求「每个 team 的 card 点击都要对应有一个 route」）。
 * 地址栏可分享、可刷新、可直达。
 *
 * ⚠ Team1 = 上会材料智能审阅助手（ad-hoc MVP，走真实 chat 后端而非 UI 原型）：要调真实
 *   `lib/live-chat.ts` API（建线程/传附件/发消息），必须走真实登录会话，因此不传 `identity`
 *   覆盖，复用页面自身默认的真实 `AppShell`。详情见 `docs/agents/team1-ic-review-mvp.md`。
 * ⚠ Team2 = 投后财务项目评级 Agent（issue #3676，ad-hoc MVP 第三版）：同 Team1 架构——
 *   不自建分析/解析引擎，材料作为真实附件（Excel/PDF/PPT/Word/录音，MIME 已在
 *   `chat-file-upload` 白名单里）发进一条真实项目对话，交给挂载了真实模型的 Agent 用
 *   既有的 `wx_document_parse`/`data-analysis`/`pdf-create`/`xlsx-create` 完成解析、
 *   沙箱算分、出报告，全过程不新增后端端点或工具。详情见
 *   `docs/agents/team2-postinvest-rating-mvp.md`。此前的两版原型
 *   （`rating-workbench.tsx` mock UI；`rating-chat.tsx` 直连
 *   `POST /postinvest-ratings/score` 不经模型）已被这一版取代，前者仍留仓库供 Phase 16
 *   契约束签核材料回溯，后者已删除。
 */
export function generateStaticParams() {
  return PREVIEW_AGENT_TEAMS.map((team) => ({ teamId: team.slug }));
}

export default function AgentTeamPage({ params }: { params: { teamId: string } }) {
  const team = findPreviewAgentTeam(params.teamId);
  if (!team) notFound();

  // 2026-09-15 人类指令：「入口点击以后，会打开类似 chatui 的界面，可以用所有的 chat
  // 的能力，但是这个是 team3 的 agent」——因此 team3 不再是落地页 + 跳转按钮，而是
  // 就地挂载 `/chat` 用的同一个 `CopilotKitV2Shell`（同一套 provider、同一套能力），
  // 线程在进页面时解析成"挂着 team3 的那条"。详见 `components/agent/team3-chat.tsx`。
  if (team.slug === "team3") {
    return <Team3ChatScreen />;
  }

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
        <div className="min-w-0 flex-1 overflow-y-auto bg-background">
          <div data-testid="agent-team-page" data-team="team2" className="mx-auto w-full max-w-screen-2xl px-5 py-6 md:px-8 lg:px-10">
            <p className="text-11 font-medium text-muted-foreground">
              <Link href="/agent" className="transition-colors duration-base hover:underline">Studio / {AGENTS_NAV_LABEL}</Link> / {RATING_AGENT.name}
            </p>
            <div className="mt-4"><RatingAgentLauncher agent={RATING_AGENT} /></div>
          </div>
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
