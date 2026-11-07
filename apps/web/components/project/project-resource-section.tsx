"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
import { projectResourceTypeLabel } from "@/lib/i18n/project-resource-copy";
import { useRouter } from "next/navigation";
import { ClipboardList, FileSearch, Link2, MoreHorizontal, Mic, Palette, PenLine, Plus, Unlink, Users, type LucideIcon } from "lucide-react";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { ProjectContentCard, CONTENT_GRID_CLASS } from "./project-content-card";
import { SectionTitle } from "./parts";
import { withProjectId, type ProjectResearchSub } from "./project-breadcrumb";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  listProjectResources, linkProjectResource, unlinkProjectResource,
  type ProjectResourceItem, type ProjectResourceKind, type ProjectLinkableResourceKind,
} from "@/lib/live-project-resources";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { listGuidedResearchSessions } from "@/lib/guided-research-api";
import { listPersonalTranscriptions } from "@/lib/live-personal-transcriptions";
import { listMyDigitalInterviews } from "@/lib/live-interviews";
import { createBoard, listBoards } from "@/lib/live-whiteboard";
import { createProject as createDesignProject, listMyProjects as listDesignProjects } from "@/lib/live-design-workbench";

/**
 * 项目内的资源列表（项目中枢 B2-S2）——研究洞察 › 问卷 / 用户洞察 / 深度研究 / 录音转写 子页，以及
 * 通用项目「内容」tab 的各类型筛选（#4615 加白板 / 设计）共用。
 *
 * 读：`listProjectResources(projectId)` 一次拉全部类型，这里按 `kind` 过滤（服务端按项目成员校验，
 *     非成员 403 `NO_PROJECT_ROLE`，这里如实显示）。
 * 新建：问卷 / 访谈 / 深度研究 / 录音转写 ——「在本项目中新建」跳到对应 Studio 的新建入口并带上
 *     `?projectId=`，Studio 创建成功后自己挂到项目，回来时列表里就有它。白板 / 设计 —— 就地创建
 *     （`createBoard` / 设计 `createProject`）→ `linkProjectResource` → 进入新建的那一份。
 * 关联已有：列出**调用者自己**的该类资源（走各 Studio 既有的列表 API），减去已挂上的，点一条即
 *     `linkProjectResource`。#4615 起访谈也走链接表（契约 `ProjectLinkableResourceKind` 含 `interview`）。
 * 解挂：`canWrite` 时每条带「移出项目」；服务端只放行资源所有者，别人得到 403。
 */
type ResourceCandidate = { id: string; title: string; updatedAt: string };

const KIND_META: Record<ProjectResearchSub, {
  resourceKind: ProjectResourceKind;
  icon: LucideIcon;
  meta: MessageKey;
  /** 去 Studio 新建的入口；`null` = 该类型就地创建（见 `create`）。 */
  newHref: string | null;
  /** 就地创建一份并返回它的 id（随后挂到项目并进入它）。 */
  create?: () => Promise<string>;
  detailHref: (id: string) => string;
  /** 「关联已有」候选来源；`null` = 该类型不能手工挂。 */
  candidates: (() => Promise<ResourceCandidate[]>) | null;
}> = {
  survey: {
    resourceKind: "survey",
    icon: ClipboardList,
    meta: "projectResources.meta.survey",
    newHref: "/studio/survey/new",
    detailHref: (id) => `/studio/survey/${encodeURIComponent(id)}`,
    candidates: async () => (await surveyRequest<SurveyRuntime[]>("/surveys"))
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })),
  },
  itv: {
    resourceKind: "interview",
    icon: Users,
    meta: "projectResources.meta.itv",
    newHref: "/itv?create=1",
    detailHref: (id) => `/itv/${encodeURIComponent(id)}/setup`,
    candidates: async () => (await listMyDigitalInterviews()).items
      .map((it) => ({ id: it.interviewId, title: it.name, updatedAt: it.updatedAt })),
  },
  research: {
    resourceKind: "guided_research",
    icon: FileSearch,
    meta: "projectResources.meta.research",
    newHref: "/research?flow=home",
    detailHref: (id) => `/research?session=${encodeURIComponent(id)}`,
    candidates: async () => (await listGuidedResearchSessions()).items
      .map((s) => ({ id: s.sessionId, title: s.title, updatedAt: s.updatedAt })),
  },
  transcript: {
    resourceKind: "personal_transcription",
    icon: Mic,
    meta: "projectResources.meta.transcript",
    newHref: "/rec?create=1",
    detailHref: (id) => `/rec?session=${encodeURIComponent(id)}`,
    candidates: async () => {
      const items: ResourceCandidate[] = [];
      let cursor: string | undefined;
      do {
        const page = await listPersonalTranscriptions(cursor === undefined ? {} : { cursor });
        items.push(...page.items.map((t) => ({ id: t.sessionId, title: t.name, updatedAt: t.updatedAt })));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return items;
    },
  },
  whiteboard: {
    resourceKind: "whiteboard",
    icon: PenLine,
    meta: "projectResources.meta.whiteboard",
    newHref: null,
    create: async () => (await createBoard({ requestId: crypto.randomUUID(), name: "未命名白板" })).id,
    detailHref: (id) => `/studio/board/${encodeURIComponent(id)}`,
    candidates: async () => {
      const items: ResourceCandidate[] = [];
      let cursor: string | undefined;
      do {
        const page = await listBoards(cursor === undefined ? { limit: 100 } : { limit: 100, cursor });
        items.push(...page.items.map((b) => ({ id: b.id, title: b.name, updatedAt: b.updatedAt })));
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return items;
    },
  },
  design: {
    resourceKind: "design",
    icon: Palette,
    meta: "projectResources.meta.design",
    newHref: null,
    create: async () => (await createDesignProject({ name: "未命名设计", template: "ui" })).project.id,
    detailHref: (id) => `/studio/design-workbench/${encodeURIComponent(id)}`,
    candidates: async () => (await listDesignProjects()).items
      .map((d) => ({ id: d.id, title: d.name, updatedAt: d.updatedAt })),
  },
};

/** 资源类型 → 子页键（`KIND_META` 的键；也是通用项目「内容」的类型筛选键）。 */
export const RESOURCE_KIND_TO_SUB: Record<ProjectResourceKind, ProjectResearchSub> = {
  survey: "survey",
  interview: "itv",
  guided_research: "research",
  personal_transcription: "transcript",
  whiteboard: "whiteboard",
  design: "design",
};

/** 一条项目资源的打开链接（带 `?projectId=` 往返）与图标——「内容」统一列表 / 概览最近更新共用。 */
export function projectResourceHref(kind: ProjectResourceKind, id: string, projectId: string): string {
  return withProjectId(KIND_META[RESOURCE_KIND_TO_SUB[kind]].detailHref(id), projectId);
}
export function projectResourceIcon(kind: ProjectResourceKind): LucideIcon {
  return KIND_META[RESOURCE_KIND_TO_SUB[kind]].icon;
}

/**
 * 「新建 ▾」选了某一类：Studio 类型直接给出带 `?projectId=` 的新建入口；白板 / 设计就地创建一份、
 * 挂到本项目，给出进入它的链接。调用方负责跳转。
 */
export async function startNewProjectResource(sub: ProjectResearchSub, projectId: string): Promise<string> {
  const meta = KIND_META[sub];
  if (meta.newHref !== null) return withProjectId(meta.newHref, projectId);
  if (!meta.create) throw new Error("该类型没有新建入口");
  const id = await meta.create();
  await linkProjectResource({ projectId, kind: meta.resourceKind, resourceId: id });
  return withProjectId(meta.detailHref(id), projectId);
}

/** 失败文案（「内容」tab 顶部的新建动作复用同一份）。 */
export function describeProjectResourceFailure(e: unknown, locale: Locale = "zh-CN"): string {
  return describeFailure(e, locale);
}

export function ProjectResourceSection({ projectId, kind, canWrite, initialLinkOpen = false, onChanged }: {
  projectId: string; kind: ProjectResearchSub; canWrite: boolean;
  /** 挂载即展开「关联已有」面板（通用项目「内容」tab 顶部的「关联已有 ▾」选了这一类）。 */
  initialLinkOpen?: boolean;
  /** 挂上 / 移出成功后回调（「内容」tab 据此刷新各类计数）。 */
  onChanged?: () => void;
}) {
  const { locale, t } = useI18n();
  const router = useRouter();
  const meta = KIND_META[kind];
  const label = projectResourceTypeLabel(meta.resourceKind, locale);
  const linkable = meta.candidates !== null;
  const [items, setItems] = React.useState<ProjectResourceItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<{ cause: unknown } | null>(null);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [candidates, setCandidates] = React.useState<ResourceCandidate[] | null>(null);
  const [candidatesError, setCandidatesError] = React.useState<{ cause: unknown } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<{ cause: unknown } | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!getStoredSessionToken()) { setItems(null); return; }
    setLoading(true); setError(null);
    try {
      const out = await listProjectResources(projectId);
      setItems(out.items.filter((it) => it.kind === meta.resourceKind));
    } catch (e) {
      setError({ cause: e });
    } finally {
      setLoading(false);
    }
  }, [projectId, meta.resourceKind]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => {
    setLinkOpen(false); setCandidates(null); setActionError(null);
    if (initialLinkOpen && canWrite) void openLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在切换类型 / 重新要求展开时重置
  }, [kind, initialLinkOpen]);

  async function createHere() {
    if (!meta.create) return;
    setCreating(true); setActionError(null);
    try {
      const href = await startNewProjectResource(kind, projectId);
      onChanged?.();
      router.push(href);
    } catch (e) {
      setActionError({ cause: e });
      setCreating(false);
    }
  }

  async function openLink() {
    if (!meta.candidates) return;
    setLinkOpen(true); setCandidates(null); setCandidatesError(null);
    try {
      setCandidates(await meta.candidates());
    } catch (e) {
      setCandidatesError({ cause: e });
    }
  }

  async function link(resourceId: string) {
    setBusyId(resourceId); setActionError(null);
    try {
      await linkProjectResource({ projectId, kind: meta.resourceKind as ProjectLinkableResourceKind, resourceId });
      await load();
      onChanged?.();
    } catch (e) {
      setActionError({ cause: e });
    } finally {
      setBusyId(null);
    }
  }

  async function unlink(resourceId: string) {
    setBusyId(resourceId); setActionError(null);
    try {
      await unlinkProjectResource({ projectId, kind: meta.resourceKind as ProjectLinkableResourceKind, resourceId });
      await load();
      onChanged?.();
    } catch (e) {
      setActionError({ cause: e });
    } finally {
      setBusyId(null);
    }
  }

  const linkedIds = new Set((items ?? []).map((it) => it.id));
  const unlinkedCandidates = (candidates ?? []).filter((c) => !linkedIds.has(c.id));
  const Icon = meta.icon;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6" data-testid="project-resources" data-kind={meta.resourceKind}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle meta={t(meta.meta)} className="mb-0">{label}</SectionTitle>
        <span className="flex-1" />
        {canWrite && linkable && (
          <Button size="sm" variant="outline" disabled={linkOpen} onClick={() => void openLink()} data-testid="project-resources-link-open">
            <Link2 aria-hidden className="h-3.5 w-3.5" />{t("projectResources.linkExisting", { label })}
          </Button>
        )}
        {canWrite && meta.newHref !== null && (
          <Button size="sm" variant="primary" asChild data-testid="project-resources-new">
            <a href={withProjectId(meta.newHref, projectId)}>
              <Plus aria-hidden className="h-3.5 w-3.5" />{t("projectResources.new", { label })}
            </a>
          </Button>
        )}
        {canWrite && meta.newHref === null && (
          <Button size="sm" variant="primary" disabled={creating} onClick={() => void createHere()} data-testid="project-resources-new">
            <Plus aria-hidden className="h-3.5 w-3.5" />{creating ? t("projectResources.creating", { label }) : t("projectResources.new", { label })}
          </Button>
        )}
      </div>

      {actionError !== null && (
        <p className="text-11 text-destructive" data-testid="project-resources-action-error">{describeFailure(actionError.cause, locale)}</p>
      )}

      {linkOpen && (
        <Card>
          <div className="flex flex-col gap-2 p-4" data-testid="project-resources-link-panel">
            <div className="flex items-center gap-2">
              <span className="text-12 font-medium">{t("projectResources.select", { label })}</span>
              <span className="flex-1" />
              <Button size="xs" variant="ghost" onClick={() => setLinkOpen(false)} data-testid="project-resources-link-close">{t("projectResources.collapse")}</Button>
            </div>
            {candidatesError !== null ? (
              <p className="text-11 text-destructive" data-testid="project-resources-link-error">{describeFailure(candidatesError.cause, locale)}</p>
            ) : candidates === null ? (
              <p className="text-11 text-muted-foreground">{t("projectResources.candidatesLoading", { label })}</p>
            ) : unlinkedCandidates.length === 0 ? (
              <p className="text-11 text-muted-foreground" data-testid="project-resources-link-empty">
                {t("projectResources.noCandidates", { label })}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {unlinkedCandidates.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-12">{c.title}</div>
                      <div className="text-10 text-muted-foreground">{t("projectResources.updated", { date: formatDate(c.updatedAt, locale) })}</div>
                    </div>
                    <Button size="xs" variant="outline" disabled={busyId === c.id} onClick={() => void link(c.id)} data-testid={`project-resources-link-${c.id}`}>
                      {t("projectResources.link")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {error !== null ? (
        <Card><p className="p-4 text-11 text-destructive" data-testid="project-resources-error">{describeFailure(error.cause, locale)}</p></Card>
      ) : loading && items === null ? (
        <Card><p className="p-4 text-11 text-muted-foreground" data-testid="project-resources-loading">{t("projectResources.loading", { label })}</p></Card>
      ) : items === null ? (
        <Card><p className="p-4 text-11 text-muted-foreground" data-testid="project-resources-anonymous">{t("projectResources.signIn")}</p></Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-resources-empty">
            {t("projectResources.empty", { label })}
            {canWrite
              ? linkable
                ? meta.newHref === null
                  ? t("projectResources.emptyLocal", { label })
                  : t("projectResources.emptyStudioLink", { label })
                : t("projectResources.emptyStudio", { label })
              : ""}
          </p>
        </Card>
      ) : (
        <ul className={CONTENT_GRID_CLASS} data-testid="project-resources-list">
          {items.map((it) => (
            <li key={it.id}>
              <ProjectContentCard
                href={withProjectId(meta.detailHref(it.id), projectId)}
                linkTestId={`project-resource-${it.id}`}
                icon={Icon}
                title={it.title}
                typeLabel={label}
                status={it.status}
                resourceKind={it.kind}
                meta={t("projectResources.itemMeta", { updated: formatDate(it.updatedAt, locale), linked: formatDate(it.linkedAt, locale) })}
                menu={canWrite && linkable ? (
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon" variant="ghost" aria-label={t("projectResources.more")} className="h-7 w-7" data-testid={`project-resource-more-${it.id}`}>
                        <MoreHorizontal aria-hidden className="h-4 w-4" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      <MenuItem disabled={busyId === it.id} onSelect={() => void unlink(it.id)} data-testid={`project-resource-unlink-${it.id}`}>
                        <Unlink aria-hidden className="h-3.5 w-3.5" />{t("projectResources.unlink")}
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                ) : null}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string, locale?: Locale): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString(locale);
}

function describeFailure(e: unknown, locale: Locale = "zh-CN"): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE": return translate(locale, "projectOverview.resource.noRole");
      case "ADMIN_NOT_SUPERUSER": return translate(locale, "projectOverview.resource.admin");
      case "RESOURCE_NOT_FOUND": return translate(locale, "projectOverview.resource.notFound");
      case "AUTH_SERVICE_UNAVAILABLE": return translate(locale, "projectOverview.resource.authUnavailable");
    }
    if (e.status === 401) return translate(locale, "projectOverview.resource.expired");
    return httpFailureText(e.status, locale);
  }
  return e instanceof Error ? e.message : translate(locale, "projectOverview.resource.unexpected");
}
