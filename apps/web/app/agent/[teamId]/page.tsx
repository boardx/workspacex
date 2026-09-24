import { Bot } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";

import { AGENTS_NAV_LABEL } from "@/lib/navigation";
import { PREVIEW_AGENT_TEAMS, findPreviewAgentTeam } from "@/lib/mock/agent-previews";
import { IcReviewChatEntry } from "@/components/agent/ic-review-chat-entry";
import { findAgent as findIcReviewAgent } from "@/lib/ic-review/agent-directory";

/**
 * 每个 team 一条真实路由（2026-09-15 人类直接要求「每个 team 的 card 点击都要对应有一个 route」）。
 * 地址栏可分享、可刷新、可直达。
 *
 * ⚠ Team3（前沿赛道技术路线研判）已于 2026-09-22 按人类指令**下线**：路由落回本文件
 *   末尾的通用占位卡，前后端实现（`components/agent/team3-chat.tsx`、研判面板、
 *   `research-workflow` 整层、补种脚本）已删除。保留的是那条线顺手修好的通用能力
 *   （mermaid 标签换行、制品版本历史/差异、deploy.sh 加固），它们与 team3 无耦合。
 *   设计档案与验收证据也一并删除——那份 instructions 是私有的分析方法，不留副本。
 *   库里已种下的 agent 行由 `apps/api/scripts/purge-team3-agent.ts` 清除。
 *
 * ⚠ Team2（投后财务项目评级）与 Team4（投后管理报告 AI 生成单元）已于 2026-09-24 按人类
 *   指令**下线**（issue #4012），做法同 team3：路由落回末尾的通用占位卡，各自的前后端
 *   实现、契约、`@repo/maau-postinvest-report` 包、补种脚本与平台内置 Skill 种子已删除。
 *   库里已种下的 agent / Skill 行由 `apps/api/scripts/purge-postinvest-agents.ts` 清除。
 *
 * ⚠ Team1 = 上会材料智能审阅助手（ad-hoc MVP 第六版）：进页面解析/发布 Agent、建或复用
 *   个人线程并入编、把「上会审阅」平台内置 Skill 挂进线程，然后**就地**挂 `/chat` 用的
 *   同一个 `CopilotKitV2Shell`，并把 agentId 作为 `initialAgentId` 交给选择 provider
 *   （第五版"中转 replace 进 /chat"的错：agent 没被选中，回答的是通用助手，挂载的 Skill
 *   一行都没进 system prompt）。之后传材料/追问/两轮确认/Excel 结果文件全部用 chat 自己的
 *   能力。详情见 `docs/agents/team1-ic-review-mvp.md`。
 */
export function generateStaticParams() {
  return PREVIEW_AGENT_TEAMS.map((team) => ({ teamId: team.slug }));
}

export default function AgentTeamPage({ params }: { params: { teamId: string } }) {
  const team = findPreviewAgentTeam(params.teamId);
  if (!team) notFound();

  // team1：就地挂 chat 壳（组件自带 AppShell 与三层 provider），不再套外层壳
  // 与面包屑——上一版是「中转页 + replace 进 /chat」，那条路径下本 Agent 根本没被选中，
  // 回答的是通用助手（见 `ic-review-chat-entry.tsx` 头注的真机根因）。
  if (team.slug === "team1") {
    const agent = findIcReviewAgent("team1");
    if (!agent) notFound();
    return <IcReviewChatEntry agent={agent} />;
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
