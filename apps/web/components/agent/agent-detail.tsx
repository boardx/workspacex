"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRightLeft, CheckCircle2, CircleDashed, MessageSquare, Sparkles, Target, Workflow, type LucideIcon } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeniedState, ErrorState } from "@/components/work-stack/states";
import { useOptionalSession } from "@/components/session/session-provider";
import { ApiError } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  ROLE_CATEGORY_LABEL,
  agentDisplayNameByAvatar,
  agentDisplayName,
  agentSubtitle,
  getAgentDirectoryCard,
  getAgentDirectoryProfile,
  officialRoleDuty,
  type AgentDirectoryCard,
} from "@/lib/agent-directory";
import { getSkillDetail, listSkills, type SkillListItem } from "@/lib/live-skill";
import { workSkillDisplayName } from "@/lib/work-skill-display-copy";
import { workflowDisplayName } from "@/lib/workflow-display-copy";
import { catalogWorkflowTitleZh } from "@/lib/workflow-catalog-title-copy";

/**
 * AG04 follow-up（契约束 agent-role UC-4）—— 成员可见的数字人详情页 `/agent/[id]`，挂在标准
 * 应用外壳里（左侧导航，同其他成员页）。
 *
 * 数据全部来自成员可读端点，没有 mock：
 *   · 头像/名字/角色/标签/可发起工作流/就绪 —— `GET /agents/directory/:agentId`
 *     （404 = 不存在或你看不到，E9 不泄露存在性，一律说「找不到」）。
 *   · 职责 / 技能引用 / 可转交对象 —— `GET /agents/directory/:agentId/profile`。
 *   · 技能名字 —— 组织技能目录 `GET /skills?entry=library`（直接挂载的技能不在目录里时再逐个
 *     `GET /skills/:skillId`）。数字人没有自己的技能时，退回展示「组织共享技能」——对话时它
 *     就用这些，这句话是真的，不是占位。
 * 补充信息读失败只影响对应几节，不拖垮整页。就绪只露两档（R5：成员不见授权详情）。
 */
export interface AgentSkillSummary {
  readonly skillId: string;
  readonly name: string;
  readonly duty: string | null;
}

export interface AgentDetailExtras {
  readonly duty: string | null;
  /** `agent` = 数字人自己的技能；`org` = 没有专属技能，列组织共享技能。 */
  readonly skillSource: "agent" | "org";
  readonly skills: readonly AgentSkillSummary[];
  readonly delegationTargets: readonly {
    readonly agentId: string;
    readonly name: string;
    readonly initials: string;
    readonly roleLabel: string;
    readonly avatar: AgentDirectoryCard["avatar"];
  }[];
  readonly requireApprovalForHandoff: boolean;
}

/** wave2 文件形式技能的 `duty` 是一句「怎么编辑源码」的说明，不是职责——不展示。 */
const FILE_BACKED_DUTY_MARKER = "文件形式";
function skillDuty(item: { readonly duty: string }): string | null {
  const d = item.duty.trim();
  return d.length === 0 || d.includes(FILE_BACKED_DUTY_MARKER) ? null : d;
}

const ORG_FALLBACK_LIMIT = 6;
const NO_SKILLS: readonly SkillListItem[] = [];

export async function loadAgentDetailExtras(agentId: string, orgId: string | null): Promise<AgentDetailExtras> {
  const [profile, catalog] = await Promise.all([
    getAgentDirectoryProfile(agentId),
    orgId ? listSkills(orgId).catch(() => NO_SKILLS) : Promise.resolve(NO_SKILLS),
  ]);
  const byId = new Map(catalog.map((s) => [s.skillId, s]));
  const byVersion = new Map(catalog.flatMap((s) => (s.currentVersionId ? [[s.currentVersionId, s] as const] : [])));
  const seen = new Set<string>();
  const skills: AgentSkillSummary[] = [];
  const push = (s: AgentSkillSummary) => {
    // 平台技能的 name 是稳定编号（S061）——换中文名；查不到就不上屏，绝不打印编号。
    const name = workSkillDisplayName(s.name);
    if (name && !seen.has(s.skillId)) { seen.add(s.skillId); skills.push({ ...s, name }); }
  };

  const missing = profile.mountedSkillIds.filter((id) => !byId.has(id));
  const fetched = await Promise.allSettled(missing.map((id) => getSkillDetail(id)));
  const fetchedById = new Map(missing.map((id, i) => [id, fetched[i]] as const));
  for (const id of profile.mountedSkillIds) {
    const hit = byId.get(id);
    if (hit) { push({ skillId: id, name: hit.name, duty: skillDuty(hit) }); continue; }
    const r = fetchedById.get(id);
    if (r?.status === "fulfilled") push({ skillId: id, name: r.value.skill.name, duty: skillDuty(r.value.skill) });
  }
  for (const versionId of profile.pinnedSkillVersionIds) {
    const hit = byVersion.get(versionId);
    if (hit) push({ skillId: hit.skillId, name: hit.name, duty: skillDuty(hit) });
  }

  const base = {
    duty: profile.duty,
    delegationTargets: profile.delegationTargets,
    requireApprovalForHandoff: profile.requireApprovalForHandoff,
  };
  if (skills.length > 0) return { ...base, skillSource: "agent", skills };
  const org = catalog
    .filter((s) => s.visibility === "org-wide")
    .slice(0, ORG_FALLBACK_LIMIT)
    .flatMap((s) => {
      const name = workSkillDisplayName(s.name);
      return name ? [{ skillId: s.skillId, name, duty: skillDuty(s) }] : [];
    });
  return { ...base, skillSource: "org", skills: org };
}

type CardState =
  | { readonly kind: "loading" }
  | { readonly kind: "denied" }
  | { readonly kind: "not-found" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly card: AgentDirectoryCard };

type ExtrasState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly extras: AgentDetailExtras };

export interface AgentDetailProps {
  readonly agentId: string;
  /** 跳转对话；`prefill` 为预填到输入框的一句话（「在对话中发起」某个工作流）。 */
  readonly onStartChat: (agentId: string, prefill?: string) => void;
  readonly fetchCard?: (agentId: string) => Promise<AgentDirectoryCard>;
  readonly fetchExtras?: (agentId: string, orgId: string | null) => Promise<AgentDetailExtras>;
}

export function AgentDetail({
  agentId,
  onStartChat,
  fetchCard = getAgentDirectoryCard,
  fetchExtras = loadAgentDetailExtras,
}: AgentDetailProps) {
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [state, setState] = React.useState<CardState>({ kind: "loading" });
  const [extras, setExtras] = React.useState<ExtrasState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setExtras({ kind: "loading" });
    fetchCard(agentId).then(
      (card) => { if (alive) setState({ kind: "ready", card }); },
      (error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) setState({ kind: "denied" });
        else if (error instanceof ApiError && error.status === 404) setState({ kind: "not-found" });
        else setState({ kind: "error", message: error instanceof ApiError ? httpFailureText(error.status) : "网络连接出了问题，稍后再试一次" });
      },
    );
    fetchExtras(agentId, orgId).then(
      (value) => { if (alive) setExtras({ kind: "ready", extras: value }); },
      () => { if (alive) setExtras({ kind: "error" }); },
    );
    return () => { alive = false; };
  }, [agentId, orgId, fetchCard, fetchExtras, attempt]);

  return (
    <div data-testid="agent-detail" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
          <nav aria-label="面包屑">
            <Link
              href="/agent"
              data-testid="agent-detail-back"
              className="inline-flex items-center gap-1 rounded-control px-1.5 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              数字人目录
            </Link>
          </nav>
          {state.kind === "loading" && <DetailSkeleton />}
          {state.kind === "denied" && <DeniedState testid="agent-detail-denied" />}
          {state.kind === "not-found" && (
            <div data-testid="agent-detail-not-found" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
              <p className="text-14 font-medium text-background-foreground">找不到这个数字人</p>
              <p className="text-12 text-muted-foreground">它可能已下线，或者不在你能看到的范围内。回到目录看看其他角色。</p>
              <Button asChild size="sm" variant="outline"><Link href="/agent">返回数字人目录</Link></Button>
            </div>
          )}
          {state.kind === "error" && (
            <ErrorState testid="agent-detail-error" message={`数字人详情加载失败：${state.message}`} onRetry={() => setAttempt((n) => n + 1)} />
          )}
          {state.kind === "ready" && (
            <AgentDetailBody card={state.card} extras={extras} onStartChat={onStartChat} />
          )}
        </div>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div data-testid="agent-detail-loading" aria-busy className="flex animate-pulse flex-col gap-4">
      <div className="flex items-center gap-4 rounded-card border border-border bg-card p-5">
        <div className="h-20 w-20 rounded-full bg-muted" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-5 w-40 rounded bg-muted" />
          <div className="h-3 w-72 max-w-full rounded bg-muted" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="h-48 rounded-card bg-muted" />
        <div className="h-48 rounded-card bg-muted" />
      </div>
    </div>
  );
}

type IconType = LucideIcon;

/** 设计过的空态：图标 + 一句结论 + 一句「那我能做什么」，不是一面「暂无」墙。 */
function SectionEmpty({ testid, icon: Icon, title, hint, action }: {
  testid: string;
  icon: IconType;
  title: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div data-testid={testid} className="mt-3 flex items-start gap-3 rounded-control border border-dashed border-border px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-12 font-medium text-card-foreground">{title}</p>
        <p className="mt-0.5 text-11 text-muted-foreground">{hint}</p>
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

function Section({ id, testid, icon: Icon, title, aside, children }: {
  id: string;
  testid: string;
  icon: IconType;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-testid={testid} className="rounded-card border border-border bg-card p-4 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 id={id} className="flex items-center gap-1.5 text-13 font-medium text-background-foreground">
          <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function workflowPrefill(name: string): string {
  return `请帮我发起「${name}」工作流。我的目标是：`;
}

function AgentDetailBody({ card, extras, onStartChat }: {
  card: AgentDirectoryCard;
  extras: ExtrasState;
  onStartChat: (agentId: string, prefill?: string) => void;
}) {
  const name = agentDisplayName(card);
  const serverDuty = extras.kind === "ready" ? extras.extras.duty : null;
  const duty = serverDuty ?? officialRoleDuty(card);
  const subtitle = agentSubtitle(card, duty);
  const tags = card.tags.length > 0 ? card.tags : card.roleCategory ? [ROLE_CATEGORY_LABEL[card.roleCategory]] : [];
  const ready = card.readiness === "ready";

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-4 rounded-card border border-border bg-card p-5 sm:flex-row sm:items-center">
        <Avatar
          data-testid="agent-detail-portrait"
          initials={card.initials}
          avatarKey={card.avatar?.key ?? null}
          tone="ai"
          className="h-20 w-20 text-24 ring-2 ring-ai-tint"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 data-testid="agent-detail-name" className="text-20 font-bold text-background-foreground">{name}</h1>
            {card.catalogSource === "official" && <Badge tone="ai">官方</Badge>}
          </div>
          {subtitle && subtitle !== duty ? (
            <p data-testid="agent-detail-role" className="text-13 text-muted-foreground">{subtitle}</p>
          ) : null}
          {tags.length > 0 && (
            <div data-testid="agent-detail-tags" className="flex flex-wrap gap-1">
              {tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
            </div>
          )}
          <p data-testid="agent-detail-readiness" className="mt-0.5 flex items-center gap-1.5 text-12 text-muted-foreground">
            {ready
              ? <><CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />随时可以开始对话，它需要的能力都已开通。</>
              : <><CircleDashed aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning-tint-foreground" />日常对话可以直接开始；少数要连外部系统的动作，还在等组织管理员开通。</>}
          </p>
        </div>
        <Button
          variant="primary"
          data-testid="agent-detail-start-chat"
          className="shrink-0 self-start sm:self-center"
          onClick={() => onStartChat(card.agentId)}
        >
          <MessageSquare aria-hidden className="h-4 w-4" />
          开始对话
        </Button>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section id="agent-detail-duty-h" testid="agent-detail-duty-section" icon={Target} title="擅长 / 负责什么">
            <p data-testid="agent-detail-duty" className="mt-2 text-13 leading-relaxed text-card-foreground">
              {duty ?? `${card.roleCategory ? `「${ROLE_CATEGORY_LABEL[card.roleCategory]}」方向的事都可以交给它。` : ""}在对话里描述你的目标，它会按自己的职责拆解并推进。`}
            </p>
            <p className="mt-2 text-11 text-muted-foreground">超出它权限的事，它会升级给相应的人拍板，不会自作主张。</p>
          </Section>

          <Section
            id="agent-detail-workflows-h"
            testid="agent-detail-workflows"
            icon={Workflow}
            title="可发起的工作流"
            aside={card.workflows.length > 0 ? <span className="text-11 text-muted-foreground">{card.workflows.length} 个</span> : undefined}
          >
            {card.workflows.length === 0 ? (
              <SectionEmpty
                testid="agent-detail-workflows-empty"
                icon={Workflow}
                title="还没有为它开放成套工作流"
                hint="不影响使用：直接说出你想做的事，它会一步步陪你推进。组织管理员发布相关工作流后会出现在这里。"
                action={<Button size="sm" variant="outline" onClick={() => onStartChat(card.agentId)}>直接开始对话</Button>}
              />
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border rounded-control border border-border">
                {card.workflows.map((wf) => ({ ...wf, name: workflowDisplayName(wf.stableId, catalogWorkflowTitleZh(wf.name)) })).map((w) => (
                  <li key={w.stableId} data-testid="agent-detail-workflow" className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground">
                      <Workflow aria-hidden className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-13 text-card-foreground">{w.name}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="agent-detail-workflow-launch"
                      aria-label={`在对话中发起「${w.name}」`}
                      onClick={() => onStartChat(card.agentId, workflowPrefill(w.name))}
                    >
                      在对话中发起
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="agent-detail-skills-h" testid="agent-detail-skills" icon={Sparkles} title="能用的技能">
            {extras.kind === "loading" && (
              <div data-testid="agent-detail-skills-loading" aria-busy className="mt-3 grid animate-pulse gap-2 sm:grid-cols-2">
                <div className="h-12 rounded-control bg-muted" /><div className="h-12 rounded-control bg-muted" />
              </div>
            )}
            {extras.kind === "error" && (
              <SectionEmpty testid="agent-detail-skills-error" icon={Sparkles} title="技能清单暂时读不到" hint="不影响开始对话，稍后刷新再看。" />
            )}
            {extras.kind === "ready" && extras.extras.skills.length === 0 && (
              <SectionEmpty
                testid="agent-detail-skills-empty"
                icon={Sparkles}
                title="它靠通用能力工作"
                hint="它没有单独配置技能，组织里也还没有共享技能；对话、检索和整理照常可用。"
              />
            )}
            {extras.kind === "ready" && extras.extras.skills.length > 0 && (
              <>
                {extras.extras.skillSource === "org" && (
                  <p data-testid="agent-detail-skills-org-note" className="mt-2 text-11 text-muted-foreground">
                    它没有单独配置技能，对话时使用组织里共享的这些技能：
                  </p>
                )}
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {extras.extras.skills.map((s) => (
                    <li key={s.skillId} className="rounded-control border border-border px-3 py-2" data-testid="agent-detail-skill">
                      <p className="truncate text-12 font-medium text-card-foreground">{s.name}</p>
                      {s.duty ? <p className="mt-0.5 line-clamp-2 text-11 text-muted-foreground">{s.duty}</p> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Section id="agent-detail-handoff-h" testid="agent-detail-handoff" icon={ArrowRightLeft} title="可转交给">
            {extras.kind === "loading" && <div aria-busy className="mt-3 h-10 animate-pulse rounded-control bg-muted" />}
            {extras.kind === "error" && (
              <SectionEmpty testid="agent-detail-handoff-error" icon={ArrowRightLeft} title="转交对象暂时读不到" hint="稍后刷新再看。" />
            )}
            {extras.kind === "ready" && extras.extras.delegationTargets.length === 0 && (
              <SectionEmpty
                testid="agent-detail-handoff-empty"
                icon={ArrowRightLeft}
                title="它会亲自跟到底"
                hint="目前没有给它配置可转交的同事；需要别的角色时，可以在目录里另选数字人。"
                action={<Button asChild size="sm" variant="ghost"><Link href="/agent">浏览数字人目录</Link></Button>}
              />
            )}
            {extras.kind === "ready" && extras.extras.delegationTargets.length > 0 && (
              <>
                <ul className="mt-3 flex flex-col gap-1">
                  {extras.extras.delegationTargets.map((t) => (
                    <li key={t.agentId} data-testid="agent-detail-handoff-target">
                      <Link
                        href={`/agent/${encodeURIComponent(t.agentId)}`}
                        className="flex items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Avatar initials={t.initials} avatarKey={t.avatar?.key ?? null} tone="ai" size="lg" />
                        <span className="min-w-0 truncate text-12 font-medium text-card-foreground">
                          {agentDisplayNameByAvatar(t.avatar?.key, t.name)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-11 text-muted-foreground">
                  {extras.extras.requireApprovalForHandoff ? "转交前会先征得你的确认。" : "遇到对方更擅长的事，它会直接转交。"}
                </p>
              </>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
