"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, FolderOpen, Link2, MessagesSquare, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { SectionTitle } from "./parts";
import { ProjectConversations, DEFAULT_PROJECT_THREAD_TITLE } from "./project-conversations";
import {
  ProjectResourceSection, RESOURCE_KIND_TO_SUB, projectResourceHref, projectResourceIcon,
  startNewProjectResource, describeProjectResourceFailure,
} from "./project-resource-section";
import type { ProjectResearchSub } from "./project-links";
import { getStoredSessionToken } from "@/lib/api-client";
import { listThreads, createProjectThread, type ListThreadsOut } from "@/lib/live-chat";
import { listProjectResources, type ListProjectResourcesOut, type ProjectResourceKind } from "@/lib/live-project-resources";
import { cn } from "@/lib/utils";

/**
 * 通用项目 ·「内容」tab（#4615，PROP-PROJECT-WORKSPACE-001 §3.4）—— 项目里的一切内容一张列表。
 *
 * 类型筛选：全部 / 对话 / 白板 / 访谈 / 问卷 / 研究 / 转写 / 设计，另有「文件」直达 `/projects/<id>/files`。
 *   - 「全部」= 对话（`listThreads`）+ 挂在项目上的资源（`listProjectResources`）按最近更新合并；
 *   - 选了某一类 = 复用既有的 `ProjectConversations` / `ProjectResourceSection`（各自带新建 / 关联 / 移出）。
 * 右上「新建 ▾」「关联已有 ▾」：新建对话直接建线程进入；白板 / 设计就地创建并挂到本项目；其余类型去对应
 * Studio（带 `?projectId=`）。关联已有 = 切到该类型并展开它的候选面板。
 * 筛选键与研究洞察子导航同一套（`sub=conv|survey|itv|research|transcript|whiteboard|design`），
 * 各 Studio「← 返回项目」的链接因此在通用项目里落到这里对应的筛选。
 */
export type ContentFilter = "all" | "conv" | ProjectResearchSub;

/** 筛选 chip 的顺序与文案（唯一一份）。 */
export const CONTENT_FILTERS: ReadonlyArray<{ key: ContentFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "conv", label: "对话" },
  { key: "whiteboard", label: "白板" },
  { key: "itv", label: "访谈" },
  { key: "survey", label: "问卷" },
  { key: "research", label: "研究" },
  { key: "transcript", label: "转写" },
  { key: "design", label: "设计" },
];
const TYPE_FILTERS = CONTENT_FILTERS.filter((f) => f.key !== "all") as ReadonlyArray<{ key: Exclude<ContentFilter, "all">; label: string }>;
const LINKABLE_FILTERS = TYPE_FILTERS.filter((f) => f.key !== "conv") as ReadonlyArray<{ key: ProjectResearchSub; label: string }>;
const FILTER_LABEL = Object.fromEntries(CONTENT_FILTERS.map((f) => [f.key, f.label])) as Record<ContentFilter, string>;

export function resolveContentFilter(sub: string | null | undefined): ContentFilter {
  return CONTENT_FILTERS.some((f) => f.key === sub) ? (sub as ContentFilter) : "all";
}

/** 统一列表里的一条：对话或一条挂在项目上的资源。 */
export interface ContentEntry {
  type: Exclude<ContentFilter, "all">;
  id: string;
  title: string;
  updatedAt: string;
  href: string;
  resourceKind: ProjectResourceKind | null;
}

/**
 * 项目内容索引：一次拉对话 + 资源，给出合并后的条目（按更新时间倒序）与各类计数。
 * 「内容」tab 与「概览」共用这一个取数口，不各自拼一份。
 */
export function useProjectContentIndex(projectId: string) {
  const [threads, setThreads] = React.useState<ListThreadsOut | null>(null);
  const [resources, setResources] = React.useState<ListProjectResourcesOut | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const reload = React.useCallback(async () => {
    if (!projectId || !getStoredSessionToken()) { setThreads(null); setResources(null); return; }
    setLoading(true); setError(null);
    const [t, r] = await Promise.allSettled([listThreads(projectId), listProjectResources(projectId)]);
    if (t.status === "fulfilled") setThreads(t.value);
    if (r.status === "fulfilled") setResources(r.value);
    const failed = t.status === "rejected" ? t.reason : r.status === "rejected" ? r.reason : null;
    setError(failed === null ? null : describeProjectResourceFailure(failed));
    setLoading(false);
  }, [projectId]);

  React.useEffect(() => { void reload(); }, [reload]);

  const entries = React.useMemo<ContentEntry[]>(() => {
    const out: ContentEntry[] = [];
    for (const g of threads?.groups ?? []) {
      for (const c of g.cards) {
        out.push({
          type: "conv", id: c.id, title: c.title, updatedAt: c.lastActivityAt, resourceKind: null,
          href: projectThreadHref(c.id, projectId),
        });
      }
    }
    for (const it of resources?.items ?? []) {
      out.push({
        type: RESOURCE_KIND_TO_SUB[it.kind], id: it.id, title: it.title, updatedAt: it.updatedAt, resourceKind: it.kind,
        href: projectResourceHref(it.kind, it.id, projectId),
      });
    }
    return out.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  }, [threads, resources, projectId]);

  const counts = React.useMemo(() => {
    const c = Object.fromEntries(TYPE_FILTERS.map((f) => [f.key, 0])) as Record<Exclude<ContentFilter, "all">, number>;
    for (const e of entries) c[e.type] += 1;
    return c;
  }, [entries]);

  const ready = threads !== null || resources !== null;
  return { entries, counts, error, loading, ready, reload };
}

export function ContentEntryIcon({ entry, className }: { entry: ContentEntry; className?: string }) {
  const Icon = entry.resourceKind ? projectResourceIcon(entry.resourceKind) : MessagesSquare;
  return <Icon aria-hidden className={className} />;
}

export function contentTypeLabel(type: Exclude<ContentFilter, "all">): string {
  return FILTER_LABEL[type];
}

export function ProjectContent({ projectId, canWrite, sub = null }: {
  projectId: string; canWrite: boolean; sub?: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<ContentFilter>(() => resolveContentFilter(sub));
  const [linkRequest, setLinkRequest] = React.useState<{ kind: ProjectResearchSub; nonce: number } | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const index = useProjectContentIndex(projectId);

  React.useEffect(() => { setFilter(resolveContentFilter(sub)); }, [sub]);

  async function createNew(kind: Exclude<ContentFilter, "all">) {
    setCreating(true); setCreateError(null);
    try {
      if (kind === "conv") {
        const out = await createProjectThread(projectId, DEFAULT_PROJECT_THREAD_TITLE);
        router.push(projectThreadHref(out.threadId, projectId));
        return;
      }
      router.push(await startNewProjectResource(kind, projectId));
    } catch (e) {
      setCreateError(describeProjectResourceFailure(e));
      setCreating(false);
    }
  }

  function requestLink(kind: ProjectResearchSub) {
    setFilter(kind);
    setLinkRequest((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  return (
    <div className="flex flex-col" data-testid="project-content" data-filter={filter}>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <SectionTitle className="mb-0" meta="对话、白板、访谈、问卷、研究、转写与设计都在这一张列表里">内容</SectionTitle>
          <span className="flex-1" />
          {canWrite && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="outline" data-testid="project-content-link-menu">
                  <Link2 aria-hidden className="h-3.5 w-3.5" />关联已有<ChevronDown aria-hidden className="h-3.5 w-3.5" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                {LINKABLE_FILTERS.map((f) => (
                  <MenuItem key={f.key} onSelect={() => requestLink(f.key)} data-testid={`project-content-link-${f.key}`}>
                    {f.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
          {canWrite && (
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm" variant="primary" disabled={creating} data-testid="project-content-new-menu">
                  <Plus aria-hidden className="h-3.5 w-3.5" />{creating ? "创建中…" : "新建"}<ChevronDown aria-hidden className="h-3.5 w-3.5" />
                </Button>
              </MenuTrigger>
              <MenuContent align="end">
                {TYPE_FILTERS.map((f) => (
                  <MenuItem key={f.key} onSelect={() => void createNew(f.key)} data-testid={`project-content-new-${f.key}`}>
                    {f.label}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          )}
        </div>

        {createError !== null && (
          <p className="text-11 text-destructive" data-testid="project-content-create-error">{createError}</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="内容类型" data-testid="project-content-filters">
          {CONTENT_FILTERS.map((f) => {
            const active = f.key === filter;
            const count = f.key === "all" ? index.entries.length : index.counts[f.key];
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                data-testid={`project-content-filter-${f.key}`}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-full border px-3 text-12 transition-colors duration-base",
                  active
                    ? "border-primary bg-primary/5 font-medium text-background-foreground"
                    : "border-border text-muted-foreground hover:border-primary hover:text-background-foreground",
                )}
              >
                {f.label}
                {index.ready && <span className="font-mono text-10 text-muted-foreground">{count}</span>}
              </button>
            );
          })}
          <a
            href={`/projects/${encodeURIComponent(projectId)}/files`}
            data-testid="project-content-files"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border px-3 text-12 text-muted-foreground transition-colors duration-base hover:border-primary hover:text-background-foreground"
          >
            <FolderOpen aria-hidden className="h-3.5 w-3.5" />文件
          </a>
        </div>
      </div>

      {filter === "all" ? (
        <AllContentList index={index} canWrite={canWrite} />
      ) : filter === "conv" ? (
        <ProjectConversations projectId={projectId} canWrite={canWrite} />
      ) : (
        <ProjectResourceSection
          key={`${filter}-${linkRequest?.kind === filter ? linkRequest.nonce : 0}`}
          projectId={projectId}
          kind={filter}
          canWrite={canWrite}
          initialLinkOpen={linkRequest?.kind === filter}
          onChanged={() => void index.reload()}
        />
      )}
    </div>
  );
}

function AllContentList({ index, canWrite }: {
  index: ReturnType<typeof useProjectContentIndex>; canWrite: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 p-6" data-testid="project-content-all">
      {index.error !== null && (
        <Card><p className="p-4 text-11 text-destructive" data-testid="project-content-error">{index.error}</p></Card>
      )}
      {!index.ready ? (
        index.error === null && (
          <Card>
            <p className="p-4 text-11 text-muted-foreground" data-testid="project-content-loading">
              {index.loading ? "读取项目内容中…" : "请先登录。"}
            </p>
          </Card>
        )
      ) : index.entries.length === 0 ? (
        <Card>
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-content-empty">
            本项目还没有内容。{canWrite ? "点右上「新建」开一段对话、一块白板或一份问卷，或点「关联已有」把你已有的挂进来。" : ""}
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="project-content-list">
          {index.entries.map((e) => (
            <li key={`${e.type}-${e.id}`}>
              <a
                href={e.href}
                data-testid={`project-content-item-${e.type}-${e.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2.5 transition-colors duration-base hover:border-primary"
              >
                <ContentEntryIcon entry={e} className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-12 font-medium">{e.title}</div>
                  <div className="truncate text-10 text-muted-foreground">更新于 {formatDate(e.updatedAt)}</div>
                </div>
                <Badge tone="outline">{contentTypeLabel(e.type)}</Badge>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleDateString();
}

/** 项目内对话线程的链接（同 `project-conversations.tsx` 的 `threadHref`）：chat 壳层用 `?projectId` 把线程列表限定到本项目。 */
function projectThreadHref(threadId: string, projectId: string): string {
  return `/chat/${encodeURIComponent(threadId)}?projectId=${encodeURIComponent(projectId)}`;
}
