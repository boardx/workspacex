"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, FileSearch, Link2, Mic, Palette, PenLine, Plus, Unlink, Users, type LucideIcon } from "lucide-react";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "./parts";
import { withProjectId, type ProjectResearchSub } from "./project-breadcrumb";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  listProjectResources, linkProjectResource, unlinkProjectResource,
  PROJECT_RESOURCE_KIND_LABEL_ZH,
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
  meta: string;
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
    meta: "挂到本项目的问卷：设计、投放与回收都在问卷 Studio",
    newHref: "/studio/survey/new",
    detailHref: (id) => `/studio/survey/${encodeURIComponent(id)}`,
    candidates: async () => (await surveyRequest<SurveyRuntime[]>("/surveys"))
      .map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })),
  },
  itv: {
    resourceKind: "interview",
    icon: Users,
    meta: "属于本项目的用户访谈：从项目里新建的自动归到这里，也可以把你已有的访谈关联进来",
    newHref: "/itv?create=1",
    detailHref: (id) => `/itv/${encodeURIComponent(id)}/setup`,
    candidates: async () => (await listMyDigitalInterviews()).items
      .map((it) => ({ id: it.interviewId, title: it.name, updatedAt: it.updatedAt })),
  },
  research: {
    resourceKind: "guided_research",
    icon: FileSearch,
    meta: "挂到本项目的深度研究会话",
    newHref: "/research?flow=home",
    detailHref: (id) => `/research?session=${encodeURIComponent(id)}`,
    candidates: async () => (await listGuidedResearchSessions()).items
      .map((s) => ({ id: s.sessionId, title: s.title, updatedAt: s.updatedAt })),
  },
  transcript: {
    resourceKind: "personal_transcription",
    icon: Mic,
    meta: "挂到本项目的录音转写",
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
    meta: "挂到本项目的白板：便签、草图与分组讨论，白板上的内容可进入项目大脑",
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
    meta: "挂到本项目的设计稿：原型与界面设计都在设计工作台",
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
export function describeProjectResourceFailure(e: unknown): string {
  return describeFailure(e);
}

export function ProjectResourceSection({ projectId, kind, canWrite, initialLinkOpen = false, onChanged }: {
  projectId: string; kind: ProjectResearchSub; canWrite: boolean;
  /** 挂载即展开「关联已有」面板（通用项目「内容」tab 顶部的「关联已有 ▾」选了这一类）。 */
  initialLinkOpen?: boolean;
  /** 挂上 / 移出成功后回调（「内容」tab 据此刷新各类计数）。 */
  onChanged?: () => void;
}) {
  const router = useRouter();
  const meta = KIND_META[kind];
  const label = PROJECT_RESOURCE_KIND_LABEL_ZH[meta.resourceKind];
  const linkable = meta.candidates !== null;
  const [items, setItems] = React.useState<ProjectResourceItem[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [candidates, setCandidates] = React.useState<ResourceCandidate[] | null>(null);
  const [candidatesError, setCandidatesError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!getStoredSessionToken()) { setItems(null); return; }
    setLoading(true); setError(null);
    try {
      const out = await listProjectResources(projectId);
      setItems(out.items.filter((it) => it.kind === meta.resourceKind));
    } catch (e) {
      setError(describeFailure(e));
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
      setActionError(describeFailure(e));
      setCreating(false);
    }
  }

  async function openLink() {
    if (!meta.candidates) return;
    setLinkOpen(true); setCandidates(null); setCandidatesError(null);
    try {
      setCandidates(await meta.candidates());
    } catch (e) {
      setCandidatesError(describeFailure(e));
    }
  }

  async function link(resourceId: string) {
    setBusyId(resourceId); setActionError(null);
    try {
      await linkProjectResource({ projectId, kind: meta.resourceKind as ProjectLinkableResourceKind, resourceId });
      await load();
      onChanged?.();
    } catch (e) {
      setActionError(describeFailure(e));
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
      setActionError(describeFailure(e));
    } finally {
      setBusyId(null);
    }
  }

  const linkedIds = new Set((items ?? []).map((it) => it.id));
  const unlinkedCandidates = (candidates ?? []).filter((c) => !linkedIds.has(c.id));
  const Icon = meta.icon;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6" data-testid="project-resources" data-kind={meta.resourceKind}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionTitle meta={meta.meta} className="mb-0">{label}</SectionTitle>
        <span className="flex-1" />
        {canWrite && linkable && (
          <Button size="sm" variant="outline" disabled={linkOpen} onClick={() => void openLink()} data-testid="project-resources-link-open">
            <Link2 aria-hidden className="h-3.5 w-3.5" />关联已有{label}
          </Button>
        )}
        {canWrite && meta.newHref !== null && (
          <Button size="sm" variant="primary" asChild data-testid="project-resources-new">
            <a href={withProjectId(meta.newHref, projectId)}>
              <Plus aria-hidden className="h-3.5 w-3.5" />在本项目中新建{label}
            </a>
          </Button>
        )}
        {canWrite && meta.newHref === null && (
          <Button size="sm" variant="primary" disabled={creating} onClick={() => void createHere()} data-testid="project-resources-new">
            <Plus aria-hidden className="h-3.5 w-3.5" />{creating ? `创建${label}中…` : `在本项目中新建${label}`}
          </Button>
        )}
      </div>

      {actionError !== null && (
        <p className="text-11 text-destructive" data-testid="project-resources-action-error">{actionError}</p>
      )}

      {linkOpen && (
        <Card>
          <div className="flex flex-col gap-2 p-4" data-testid="project-resources-link-panel">
            <div className="flex items-center gap-2">
              <span className="text-12 font-medium">选择要挂到本项目的{label}</span>
              <span className="flex-1" />
              <Button size="xs" variant="ghost" onClick={() => setLinkOpen(false)} data-testid="project-resources-link-close">收起</Button>
            </div>
            {candidatesError !== null ? (
              <p className="text-11 text-destructive" data-testid="project-resources-link-error">{candidatesError}</p>
            ) : candidates === null ? (
              <p className="text-11 text-muted-foreground">读取你的{label}中…</p>
            ) : unlinkedCandidates.length === 0 ? (
              <p className="text-11 text-muted-foreground" data-testid="project-resources-link-empty">
                你名下没有还未挂到本项目的{label}。
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {unlinkedCandidates.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-12">{c.title}</div>
                      <div className="text-10 text-muted-foreground">更新于 {formatDate(c.updatedAt)}</div>
                    </div>
                    <Button size="xs" variant="outline" disabled={busyId === c.id} onClick={() => void link(c.id)} data-testid={`project-resources-link-${c.id}`}>
                      关联
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {error !== null ? (
        <Card><p className="p-4 text-11 text-destructive" data-testid="project-resources-error">{error}</p></Card>
      ) : loading && items === null ? (
        <Card><p className="p-4 text-11 text-muted-foreground" data-testid="project-resources-loading">读取{label}中…</p></Card>
      ) : items === null ? (
        <Card><p className="p-4 text-11 text-muted-foreground" data-testid="project-resources-anonymous">请先登录。</p></Card>
      ) : items.length === 0 ? (
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-resources-empty">
            本项目还没有{label}。
            {canWrite
              ? linkable
                ? meta.newHref === null
                  ? `点「在本项目中新建${label}」直接创建，或点「关联已有${label}」把你已有的挂进来。`
                  : `点「在本项目中新建${label}」去 Studio 创建，或点「关联已有${label}」把你已有的挂进来。`
                : `点「在本项目中新建${label}」去 Studio 创建，创建后会自动归到本项目。`
              : ""}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="project-resources-list">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={withProjectId(meta.detailHref(it.id), projectId)}
                data-testid={`project-resource-${it.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 transition-colors hover:border-primary"
              >
                <Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-12 font-medium">{it.title}</div>
                  <div className="truncate text-10 text-muted-foreground">
                    更新于 {formatDate(it.updatedAt)} · 挂入 {formatDate(it.linkedAt)}
                  </div>
                </div>
                {it.status && <Badge tone="outline">{it.status}</Badge>}
                {canWrite && linkable && (
                  <span onClick={(e) => e.preventDefault()}>
                    <Button size="xs" variant="ghost" disabled={busyId === it.id} onClick={() => void unlink(it.id)} data-testid={`project-resource-unlink-${it.id}`}>
                      <Unlink aria-hidden className="h-3 w-3" />移出项目
                    </Button>
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString();
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.reasonCode) {
      case "NO_PROJECT_ROLE": return "你不在这个项目里，看不到项目内的资源。";
      case "ADMIN_NOT_SUPERUSER": return "管理员身份不能操作项目资源，请用项目成员身份登录。";
      case "RESOURCE_NOT_FOUND": return "这条资源不存在，或不属于你——只有资源所有者能把它挂到项目或移出项目。";
      case "AUTH_SERVICE_UNAVAILABLE": return "身份校验服务暂时不可用，请稍后重试。";
    }
    if (e.status === 401) return "登录已失效，请重新登录。";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "操作失败，请稍后重试。";
}
