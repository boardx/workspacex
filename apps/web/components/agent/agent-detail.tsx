"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@repo/contracts/locale";
import { localizedText, translatedText } from "@/lib/entity-localization";
import type { agentRole } from "@repo/contracts";
import type { z } from "zod";
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
  type AgentDirectoryProfile,
} from "@/lib/agent-directory";
import { getSkillDetail, listSkills, type SkillListItem } from "@/lib/live-skill";
import { workSkillDisplayName } from "@/lib/work-skill-display-copy";
import { skillTaskDescription as skillDuty } from "@/lib/skill-task-description";
import { WorkflowRunEntry } from "@/components/workflow/workflow-lists";
import { UNNAMED_WORKFLOW_LABEL, agentWorkflowLabel } from "@/lib/workflow-catalog-title-copy";

/**
 * AG04 follow-up（契约束 agent-role UC-4）—— 成员可见的数字人详情页 `/agent/[id]`，挂在标准
 * 应用外壳里（左侧导航，同其他成员页）。
 *
 * 数据全部来自成员可读端点，没有 mock：
 *   · 头像/名字/角色/标签/可发起工作流/就绪 —— `GET /agents/directory/:agentId`
 *     （404 = 不存在或你看不到，E9 不泄露存在性，一律说「找不到」）。
 *   · 职责 / 技能引用 / 可转交对象 —— `GET /agents/directory/:agentId/profile`。
 *   · 技能名字 —— 组织技能目录 `GET /skills?entry=library`（直接挂载的技能不在目录里时再逐个
 *     `GET /skills/:skillId`）。技能按已发布版本的精确 pin 展示；待验证坐标单独列出，不会以组织共享技能替代。
 * 补充信息读失败只影响对应几节，不拖垮整页。就绪只露两档（R5：成员不见授权详情）。
 */
export interface AgentSkillSummary {
  readonly skillId: string;
  readonly versionId?: string;
  readonly name: string;
  readonly duty: string | null;
}

export interface AgentDetailExtras {
  readonly duty: string | null;
  /** Skills are always scoped to the published agent; retained for existing consumers. */
  readonly skillSource: "agent" | "org";
  readonly skills: readonly AgentSkillSummary[];
  readonly pendingSkills?: readonly z.infer<typeof agentRole.PendingSkillBinding>[];
  readonly delegationTargets: Readonly<AgentDirectoryProfile["delegationTargets"]>;
  readonly requireApprovalForHandoff: boolean;
}

const NO_SKILLS: readonly SkillListItem[] = [];

export async function loadAgentDetailExtras(agentId: string, orgId: string | null, locale?: Locale): Promise<AgentDetailExtras> {
  const [profile, catalog] = await Promise.all([
    locale === undefined ? getAgentDirectoryProfile(agentId) : getAgentDirectoryProfile(agentId, locale),
    orgId ? (locale === undefined ? listSkills(orgId) : listSkills(orgId, locale)).catch(() => NO_SKILLS) : Promise.resolve(NO_SKILLS),
  ]);
  const published = profile as typeof profile & {
    pinnedSkills?: readonly { skillId: string; versionId: string }[];
    pendingSkillBindings?: readonly z.infer<typeof agentRole.PendingSkillBinding>[];
  };
  const pins = published.pinnedSkills ?? [];
  const byId = new Map(catalog.map((item) => [item.skillId, item]));
  const missing = [...new Set(pins.filter((pin) => !byId.has(pin.skillId)).map((pin) => pin.skillId))];
  const fetched = await Promise.allSettled(missing.map((id) => locale === undefined ? getSkillDetail(id) : getSkillDetail(id, locale)));
  for (let i = 0; i < missing.length; i++) {
    const result = fetched[i];
    // Only directory metadata is used; a detail response's latest contract is never substituted for a pin.
    if (result?.status === "fulfilled") byId.set(missing[i]!, result.value.skill);
  }
  const skills = pins.flatMap((pin): AgentSkillSummary[] => {
    const item = byId.get(pin.skillId);
    if (!item) return [];
    const display = item.currentVersionId === pin.versionId ? item.display : undefined;
    const name = localizedText(display, "name", workSkillDisplayName(item.name));
    return name ? [{ skillId: pin.skillId, versionId: pin.versionId, name,
      duty: item.currentVersionId === pin.versionId ? localizedText(display, "duty", skillDuty(item)) : null }] : [];
  });
  return {
    duty: localizedText(profile.display, "duty", profile.duty), skillSource: "agent", skills,
    pendingSkills: published.pendingSkillBindings ?? [],
    delegationTargets: profile.delegationTargets,
    requireApprovalForHandoff: profile.requireApprovalForHandoff,
  };
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
  readonly fetchCard?: (agentId: string, locale?: Locale) => Promise<AgentDirectoryCard>;
  readonly fetchExtras?: (agentId: string, orgId: string | null, locale?: Locale) => Promise<AgentDetailExtras>;
}

export function AgentDetail({
  agentId,
  onStartChat,
  fetchCard = getAgentDirectoryCard,
  fetchExtras = loadAgentDetailExtras,
}: AgentDetailProps) {
  const { locale, t } = useI18n();
  const orgId = useOptionalSession()?.session?.currentOrgId ?? null;
  const [state, setState] = React.useState<CardState>({ kind: "loading" });
  const [extras, setExtras] = React.useState<ExtrasState>({ kind: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setExtras({ kind: "loading" });
    fetchCard(agentId, locale).then(
      (card) => { if (alive) setState({ kind: "ready", card }); },
      (error: unknown) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) setState({ kind: "denied" });
        else if (error instanceof ApiError && error.status === 404) setState({ kind: "not-found" });
        else setState({ kind: "error", message: error instanceof ApiError ? httpFailureText(error.status, locale) : t("agent.detail.network") });
      },
    );
    fetchExtras(agentId, orgId, locale).then(
      (value) => { if (alive) setExtras({ kind: "ready", extras: value }); },
      () => { if (alive) setExtras({ kind: "error" }); },
    );
    return () => { alive = false; };
  }, [agentId, orgId, locale, t, fetchCard, fetchExtras, attempt]);

  return (
    <div data-testid="agent-detail" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-4 md:px-6 md:py-6">
          <nav aria-label={t("agent.detail.breadcrumbs")}>
            <Link
              href="/agent"
              data-testid="agent-detail-back"
              className="inline-flex items-center gap-1 rounded-control px-1.5 py-1 text-12 text-muted-foreground transition-colors hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              {t("agent.detail.directory")}
            </Link>
          </nav>
          {state.kind === "loading" && <DetailSkeleton />}
          {state.kind === "denied" && <DeniedState testid="agent-detail-denied" />}
          {state.kind === "not-found" && (
            <div data-testid="agent-detail-not-found" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
              <p className="text-14 font-medium text-background-foreground">{t("agent.detail.missing")}</p>
              <p className="text-12 text-muted-foreground">{t("agent.detail.missingHint")}</p>
              <Button asChild size="sm" variant="outline"><Link href="/agent">{t("agent.detail.back")}</Link></Button>
            </div>
          )}
          {state.kind === "error" && (
            <ErrorState testid="agent-detail-error" message={t("agent.detail.loadError", { error: state.message })} onRetry={() => setAttempt((n) => n + 1)} />
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

/** 只有真有中文显示名才把名字拼进句子；纯英文名 / 占位名一律用中性句，避免「发起「未命名流程」」。 */
export function workflowPrefill(name: string): string {
  if (name === UNNAMED_WORKFLOW_LABEL || !/\p{Script=Han}/u.test(name)) return "帮我发起一个工作流。我的目标是：";
  return `请帮我发起「${name}」工作流。我的目标是：`;
}

function AgentDetailBody({ card, extras, onStartChat }: {
  card: AgentDirectoryCard;
  extras: ExtrasState;
  onStartChat: (agentId: string, prefill?: string) => void;
}) {
  const { t } = useI18n();
  const name = agentDisplayName(card);
  const avatarAlt = translatedText(card.display, "avatarAlt");
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
          {...(avatarAlt ? { "aria-label": avatarAlt } : {})}
          tone="ai"
          className="h-20 w-20 text-24 ring-2 ring-ai-tint"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 data-testid="agent-detail-name" className="text-20 font-bold text-background-foreground">{name}</h1>
            {card.catalogSource === "official" && <Badge tone="ai">{t("agent.detail.official")}</Badge>}
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
            {extras.kind === "ready" && (extras.extras.pendingSkills?.length ?? 0) > 0
              ? <><CircleDashed aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning-tint-foreground" />{t("agent.detail.readinessPending", { count: extras.extras.pendingSkills!.length })}</>
              : ready
              ? <><CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />{t("agent.detail.readinessReady")}</>
              : <><CircleDashed aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning-tint-foreground" />{t("agent.detail.readinessRestricted")}</>}
          </p>
        </div>
        <Button
          variant="primary"
          data-testid="agent-detail-start-chat"
          className="shrink-0 self-start sm:self-center"
          onClick={() => onStartChat(card.agentId)}
        >
          <MessageSquare aria-hidden className="h-4 w-4" />
          {t("agent.detail.chat")}
        </Button>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section id="agent-detail-duty-h" testid="agent-detail-duty-section" icon={Target} title={t("agent.detail.responsibilities")}>
            <p data-testid="agent-detail-duty" className="mt-2 text-13 leading-relaxed text-card-foreground">
              {duty ?? `${card.roleCategory ? t("agent.detail.dutyCategory", { category: ROLE_CATEGORY_LABEL[card.roleCategory] }) : ""}${t("agent.detail.dutyFallback")}`}
            </p>
            <p className="mt-2 text-11 text-muted-foreground">{t("agent.detail.escalation")}</p>
          </Section>

          <Section
            id="agent-detail-workflows-h"
            testid="agent-detail-workflows"
            icon={Workflow}
            title={t("agent.detail.workflows")}
            aside={card.workflows.length > 0 ? <span className="text-11 text-muted-foreground">{t("agent.detail.workflowCount", { count: card.workflows.length })}</span> : undefined}
          >
            {card.workflows.length === 0 ? (
              <SectionEmpty
                testid="agent-detail-workflows-empty"
                icon={Workflow}
                title={t("agent.detail.noWorkflows")}
                hint={t("agent.detail.workflowHint")}
                action={<Button size="sm" variant="outline" onClick={() => onStartChat(card.agentId)}>{t("agent.detail.startChat")}</Button>}
              />
            ) : (
              <ul className="mt-3 flex flex-col divide-y divide-border rounded-control border border-border">
                {card.workflows.map((wf) => ({ ...wf, name: agentWorkflowLabel(wf) })).map((w) => (
                  <li key={w.stableId} data-testid="agent-detail-workflow" className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground">
                      <Workflow aria-hidden className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-13 text-card-foreground">{w.name}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="agent-detail-workflow-launch"
                      aria-label={t("agent.detail.launchNamed", { name: w.name })}
                      onClick={() => onStartChat(card.agentId, workflowPrefill(w.name))}
                    >
                      {t("agent.detail.workflowLaunch")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {ready ? <WorkflowRunEntry key={card.agentId} agentId={card.agentId} /> : null}
          </Section>

          <Section id="agent-detail-skills-h" testid="agent-detail-skills" icon={Sparkles} title={t("agent.detail.skills")}>
            {extras.kind === "loading" && (
              <div data-testid="agent-detail-skills-loading" aria-busy className="mt-3 grid animate-pulse gap-2 sm:grid-cols-2">
                <div className="h-12 rounded-control bg-muted" /><div className="h-12 rounded-control bg-muted" />
              </div>
            )}
            {extras.kind === "error" && (
              <SectionEmpty testid="agent-detail-skills-error" icon={Sparkles} title={t("agent.detail.skillsError")} hint={t("agent.detail.skillsRetry")} />
            )}
            {extras.kind === "ready" && extras.extras.skills.length === 0 && (extras.extras.pendingSkills?.length ?? 0) === 0 && (
              <SectionEmpty
                testid="agent-detail-skills-empty"
                icon={Sparkles}
                title={t("agent.detail.noSkills")}
                hint={t("agent.detail.skillsHint")}
              />
            )}
            {extras.kind === "ready" && extras.extras.skills.length > 0 && (
              <>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {extras.extras.skills.map((s) => (
                    <li key={`${s.skillId}/${s.versionId ?? ""}`} className="rounded-control border border-border px-3 py-2" data-testid="agent-detail-skill" data-skill-id={s.skillId} data-skill-version-id={s.versionId} data-state="available">
                      <p className="truncate text-12 font-medium text-card-foreground">{s.name}</p>
                      {s.duty ? <p className="mt-0.5 line-clamp-2 text-11 text-muted-foreground">{s.duty}</p> : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {extras.kind === "ready" ? (
              <>
                <p className="mt-2 text-11 text-muted-foreground" data-testid="agent-detail-skill-counts" data-available-count={extras.extras.skills.length} data-pending-count={extras.extras.pendingSkills?.length ?? 0}>
                  {t("agent.detail.skillCounts", { available: extras.extras.skills.length, pending: extras.extras.pendingSkills?.length ?? 0 })}
                </p>
                {(extras.extras.pendingSkills?.length ?? 0) > 0 ? (
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {extras.extras.pendingSkills!.map((skill) => (
                      <li key={`${skill.stableId}/${skill.contentDigest}`}><button type="button" disabled className="w-full rounded-control border border-border px-3 py-2 text-left text-muted-foreground" data-testid="agent-detail-pending-skill" data-state={skill.reason} data-skill-stable-id={skill.stableId} data-skill-stable-name={skill.stableName} aria-disabled="true">
                        <p className="truncate text-12 font-medium">{skill.displayName ?? skill.stableName}</p>
                        <p className="mt-0.5 text-11">{skill.reason === "missing_version" ? t("agent.detail.missingVersion") : t("agent.detail.pendingValidation")} · {t("agent.detail.unavailable")}</p>
                      </button></li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </Section>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <Section id="agent-detail-handoff-h" testid="agent-detail-handoff" icon={ArrowRightLeft} title={t("agent.detail.handoff")}>
            {extras.kind === "loading" && <div aria-busy className="mt-3 h-10 animate-pulse rounded-control bg-muted" />}
            {extras.kind === "error" && (
              <SectionEmpty testid="agent-detail-handoff-error" icon={ArrowRightLeft} title={t("agent.detail.handoffError")} hint={t("agent.detail.retryLater")} />
            )}
            {extras.kind === "ready" && extras.extras.delegationTargets.length === 0 && (
              <SectionEmpty
                testid="agent-detail-handoff-empty"
                icon={ArrowRightLeft}
                title={t("agent.detail.noHandoff")}
                hint={t("agent.detail.handoffHint")}
                action={<Button asChild size="sm" variant="ghost"><Link href="/agent">{t("agent.detail.browse")}</Link></Button>}
              />
            )}
            {extras.kind === "ready" && extras.extras.delegationTargets.length > 0 && (
              <>
                <ul className="mt-3 flex flex-col gap-1">
                  {extras.extras.delegationTargets.map((t) => {
                    const targetAvatarAlt = translatedText(t.display, "avatarAlt");
                    return (
                      <li key={t.agentId} data-testid="agent-detail-handoff-target">
                        <Link
                          href={`/agent/${encodeURIComponent(t.agentId)}`}
                          className="flex items-center gap-2.5 rounded-control px-2 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Avatar initials={t.initials} avatarKey={t.avatar?.key ?? null} {...(targetAvatarAlt ? { "aria-label": targetAvatarAlt } : {})} tone="ai" size="lg" />
                          <span className="min-w-0 truncate text-12 font-medium text-card-foreground">
                            {agentDisplayNameByAvatar(t.avatar?.key, t.name, t.display)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-2 text-11 text-muted-foreground">
                  {extras.extras.requireApprovalForHandoff ? t("agent.detail.handoffApproval") : t("agent.detail.handoffAutomatic")}
                </p>
              </>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
