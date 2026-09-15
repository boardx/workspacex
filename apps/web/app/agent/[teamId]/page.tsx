import { Bot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

import { AGENTS_NAV_LABEL } from "@/lib/navigation";
import { PREVIEW_AGENT_TEAMS, findPreviewAgentTeam } from "@/lib/mock/agent-previews";
import { Team3StartChatButton } from "@/components/agent/team3-start-chat-button";
import { RatingAgentLauncher } from "@/components/postinvest-rating/rating-agent-launcher";
import { IcReviewChatEntry } from "@/components/agent/ic-review-chat-entry";
import { findAgent as findIcReviewAgent } from "@/lib/ic-review/agent-directory";
import { RATING_AGENT } from "@/lib/postinvest-rating/agent-directory";

/**
 * 每个 team 一条真实路由（2026-09-15 人类直接要求「每个 team 的 card 点击都要对应有一个 route」）。
 * 地址栏可分享、可刷新、可直达。
 *
 * ⚠ Team1 = 上会材料智能审阅助手（ad-hoc MVP 第五版）：本路由是**中转页**不是工作台——
 *   它只把 Agent 入编、把「上会审阅」Skill 挂进线程，然后 `replace` 进真正的 chat
 *   （`/chat/<threadId>`），之后传材料/追问/确认全部用 chat 自己的能力（附件、历史、
 *   产物落地…），不自建第二套 UI。要调真实 `lib/live-chat.ts` API，必须走真实登录
 *   会话，因此不传 `identity` 覆盖，复用页面自身默认的真实 `AppShell`。
 *   详情见 `docs/agents/team1-ic-review-mvp.md`。
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
            <div className="mt-4"><IcReviewChatEntry agent={agent} /></div>
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
