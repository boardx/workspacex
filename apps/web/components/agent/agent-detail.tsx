"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Sparkles, Workflow } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeniedState, ErrorState, LoadingSkeleton } from "@/components/work-stack/states";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { ROLE_CATEGORY_LABEL, getAgentDirectoryCard, type AgentDirectoryCard } from "@/lib/agent-directory";
import { getAgentCapabilityGraph } from "@/lib/live-agent-capability-graph";
import { getSkillDetail } from "@/lib/live-skill";

/**
 * AG04 follow-up（契约束 agent-role UC-4）—— 成员可见的数字人详情页 `/agent/[id]`。
 *
 * 数据全部来自成员可读端点，没有 mock：
 *   · 头像/名字/角色/标签/可发起 Workflow/就绪 —— `GET /agents/directory/:agentId`
 *     （`getAgentDirectoryCard`；404 = 不存在或你看不到，E9 不泄露存在性，一律说「找不到」）。
 *   · 能用的技能 —— `GET /agents/:agentId`（`getAgentCapabilityGraph.skillMounts`），逐个用
 *     `GET /skills/:skillId` 换成人能读的名字与职责。技能读失败只影响这一节，不拖垮整页。
 *
 * 就绪只露两档（R5：成员不见授权详情），与目录卡片同一条纪律。
 */
export interface AgentSkillSummary {
  readonly skillId: string;
  readonly name: string;
  readonly duty: string | null;
}

export async function loadAgentSkills(agentId: string): Promise<readonly AgentSkillSummary[]> {
  const graph = await getAgentCapabilityGraph(agentId);
  const ids = [...new Set(graph.skillMounts.map((m) => m.skillId))].slice(0, 24);
  const details = await Promise.allSettled(ids.map((id) => getSkillDetail(id)));
  return ids.map((skillId, i) => {
    const d = details[i];
    return d?.status === "fulfilled"
      ? { skillId, name: d.value.skill.name, duty: d.value.skill.duty || null }
      : { skillId, name: "一项组织技能", duty: null };
  });
}

type CardState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not-found" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly card: AgentDirectoryCard };

type SkillState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly skills: readonly AgentSkillSummary[] };

export interface AgentDetailProps {
  readonly agentId: string;
  readonly onStartChat: (agentId: string) => void;
  readonly fetchCard?: (agentId: string) => Promise<AgentDirectoryCard>;
  readonly fetchSkills?: (agentId: string) => Promise<readonly AgentSkillSummary[]>;
}

export function AgentDetail({
  agentId,
  onStartChat,
  fetchCard = getAgentDirectoryCard,
  fetchSkills = loadAgentSkills,
}: AgentDetailProps) {
  const [state, setState] = React.useState<CardState>({ kind: "loading" });
  const [skills, setSkills] = React.useState<SkillState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setSkills({ kind: "loading" });
    fetchCard(agentId).then(
      (card) => { if (alive) setState({ kind: "ready", card }); },
      (error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) setState({ kind: "denied" });
        else if (error instanceof ApiError && error.status === 404) setState({ kind: "not-found" });
        else setState({ kind: "error", message: error instanceof ApiError ? httpFailureText(error.status) : "网络连接出了问题，稍后再试一次" });
      },
    );
    fetchSkills(agentId).then(
      (list) => { if (alive) setSkills({ kind: "ready", skills: list }); },
      () => { if (alive) setSkills({ kind: "error" }); },
    );
    return () => { alive = false; };
  }, [agentId, fetchCard, fetchSkills, attempt]);

  return (
    <div data-testid="agent-detail" className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Link
          href="/agent"
          data-testid="agent-detail-back"
          className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
          Agent 目录
        </Link>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {state.kind === "loading" && <LoadingSkeleton testid="agent-detail-loading" />}
        {state.kind === "denied" && <DeniedState testid="agent-detail-denied" />}
        {state.kind === "not-found" && (
          <div data-testid="agent-detail-not-found" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
            <p className="text-14 font-medium text-background-foreground">找不到这个数字人</p>
            <p className="text-12 text-muted-foreground">它可能已下线，或者不在你能看到的范围内。回到目录看看其他角色。</p>
            <Button asChild size="sm" variant="outline"><Link href="/agent">返回 Agent 目录</Link></Button>
          </div>
        )}
        {state.kind === "error" && (
          <ErrorState testid="agent-detail-error" message={`数字人详情加载失败：${state.message}`} onRetry={() => setAttempt((n) => n + 1)} />
        )}
        {state.kind === "ready" && (
          <AgentDetailBody card={state.card} skills={skills} onStartChat={onStartChat} />
        )}
      </div>
    </div>
  );
}

function AgentDetailBody({ card, skills, onStartChat }: { card: AgentDirectoryCard; skills: SkillState; onStartChat: (agentId: string) => void }) {
  const tags = card.tags.length > 0 ? card.tags : card.roleCategory ? [ROLE_CATEGORY_LABEL[card.roleCategory]] : [];
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-start">
          <Avatar
            data-testid="agent-detail-portrait"
            initials={card.initials}
            avatarKey={card.avatar?.key ?? null}
            tone="ai"
            className="h-24 w-24 text-24"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 data-testid="agent-detail-name" className="text-18 font-bold text-background-foreground">{card.name}</h1>
              {card.catalogSource === "official" && <Badge tone="ai">官方</Badge>}
              {card.readiness === "ready"
                ? <Badge tone="success" data-testid="agent-detail-readiness">可用</Badge>
                : <Badge tone="warning" data-testid="agent-detail-readiness">能力未就绪</Badge>}
            </div>
            <p data-testid="agent-detail-role" className="text-13 text-muted-foreground">{card.roleLabel}</p>
            {tags.length > 0 && (
              <div data-testid="agent-detail-tags" className="flex flex-wrap gap-1">
                {tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
              </div>
            )}
            {card.readiness !== "ready" && (
              <p className="text-11 text-muted-foreground">它需要的部分能力还没接好，对话中有些事可能做不了；组织管理员可以在后台补齐。</p>
            )}
          </div>
          <Button
            variant="primary"
            data-testid="agent-detail-start-chat"
            className="shrink-0"
            onClick={() => onStartChat(card.agentId)}
          >
            <MessageSquare aria-hidden className="h-4 w-4" />
            开始对话
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="agent-detail-duty-h" className="rounded-card border border-border bg-card p-4">
        <h2 id="agent-detail-duty-h" className="text-13 font-medium text-background-foreground">它负责什么</h2>
        <p data-testid="agent-detail-duty" className="mt-1 text-12 text-card-foreground">
          {card.roleLabel}
          {card.roleCategory ? `，归属「${ROLE_CATEGORY_LABEL[card.roleCategory]}」类角色。` : "。"}
          直接在对话里描述你的目标，它会按自己的职责拆解并推进；超出权限的事会升级给相应的人拍板。
        </p>
      </section>

      <section aria-labelledby="agent-detail-skills-h" data-testid="agent-detail-skills" className="rounded-card border border-border bg-card p-4">
        <h2 id="agent-detail-skills-h" className="flex items-center gap-1.5 text-13 font-medium text-background-foreground">
          <Sparkles aria-hidden className="h-3.5 w-3.5 text-ai-tint-foreground" />
          能用的技能
        </h2>
        {skills.kind === "loading" && <p className="mt-2 text-12 text-muted-foreground" data-testid="agent-detail-skills-loading">正在读取技能清单…</p>}
        {skills.kind === "error" && <p className="mt-2 text-12 text-muted-foreground" data-testid="agent-detail-skills-error">技能清单暂时读不到，不影响开始对话。</p>}
        {skills.kind === "ready" && skills.skills.length === 0 && (
          <p className="mt-2 text-12 text-muted-foreground" data-testid="agent-detail-skills-empty">没有单独挂载技能，对话时使用组织默认技能。</p>
        )}
        {skills.kind === "ready" && skills.skills.length > 0 && (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {skills.skills.map((s) => (
              <li key={s.skillId} className="rounded-control bg-muted px-2.5 py-2" data-testid="agent-detail-skill">
                <p className="text-12 font-medium text-card-foreground">{s.name}</p>
                {s.duty ? <p className="mt-0.5 line-clamp-2 text-11 text-muted-foreground">{s.duty}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="agent-detail-workflows-h" data-testid="agent-detail-workflows" className="rounded-card border border-border bg-card p-4">
        <h2 id="agent-detail-workflows-h" className="flex items-center gap-1.5 text-13 font-medium text-background-foreground">
          <Workflow aria-hidden className="h-3.5 w-3.5 text-primary" />
          可发起的工作流
        </h2>
        {card.workflows.length === 0 ? (
          <p className="mt-2 text-12 text-muted-foreground" data-testid="agent-detail-workflows-empty">暂无可发起的工作流，可以直接对话提需求。</p>
        ) : (
          <>
            <ul className="mt-2 flex flex-col gap-1.5">
              {card.workflows.map((w) => (
                <li key={w.stableId} className="flex items-center justify-between gap-2 rounded-control bg-muted px-2.5 py-2 text-12 text-card-foreground">
                  <span className="truncate">{w.name}</span>
                  <span className="shrink-0 text-10 text-muted-foreground">{w.stableId}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-11 text-muted-foreground">开始对话后说出你想做的事，它会在需要时发起对应工作流，并先请你确认。</p>
          </>
        )}
      </section>
    </div>
  );
}
