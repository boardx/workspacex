"use client";
import * as React from "react";
import { ClipboardList, FileSearch, Link2, Mic, Plus, Unlink, Users, type LucideIcon } from "lucide-react";
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

/**
 * 项目内的研究资源列表（项目中枢 B2-S2）——研究洞察 › 问卷 / 用户洞察 / 深度研究 / 录音转写 四个子页共用。
 *
 * 读：`listProjectResources(projectId)` 一次拉全部四类，这里按 `kind` 过滤（服务端按项目成员校验，
 *     非成员 403 `NO_PROJECT_ROLE`，这里如实显示）。
 * 新建：「在本项目中新建」跳到对应 Studio 的新建入口并带上 `?projectId=`——Studio 创建成功后自己调
 *     `linkProjectResource`（访谈则直接带项目 scope 创建），回来时列表里就有它。
 * 关联已有：列出**调用者自己**的该类资源（走各 Studio 既有的列表 API），减去已挂上的，点一条即
 *     `linkProjectResource`。访谈不走链接表（契约 `ProjectLinkableResourceKind` 不含 `interview`），
 *     所以用户洞察子页没有这个入口。
 * 解挂：`canWrite` 且是可链接类型时每条带「移出项目」；服务端只放行资源所有者，别人得到 403。
 */
type ResourceCandidate = { id: string; title: string; updatedAt: string };

const KIND_META: Record<ProjectResearchSub, {
  resourceKind: ProjectResourceKind;
  icon: LucideIcon;
  meta: string;
  newHref: string;
  detailHref: (id: string) => string;
  /** 「关联已有」候选来源；`null` = 该类型不能手工挂（访谈）。 */
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
    meta: "属于本项目的用户访谈：从项目里新建的访谈自动归到这里",
    newHref: "/itv?create=1",
    detailHref: (id) => `/itv/${encodeURIComponent(id)}/setup`,
    candidates: null,
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
};

export function ProjectResourceSection({ projectId, kind, canWrite }: {
  projectId: string; kind: ProjectResearchSub; canWrite: boolean;
}) {
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
  React.useEffect(() => { setLinkOpen(false); setCandidates(null); setActionError(null); }, [kind]);

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
        {canWrite && (
          <Button size="sm" variant="primary" asChild data-testid="project-resources-new">
            <a href={withProjectId(meta.newHref, projectId)}>
              <Plus aria-hidden className="h-3.5 w-3.5" />在本项目中新建{label}
            </a>
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
                ? `点「在本项目中新建${label}」去 Studio 创建，或点「关联已有${label}」把你已有的挂进来。`
                : `点「在本项目中新建${label}」去 Studio 创建，创建的访谈会自动归到本项目。`
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
