"use client";
import * as React from "react";
import { Brain, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { SectionTitle } from "./parts";
import { unverifiedHypotheses } from "./research-overview";
import {
  CONTENT_FILTERS, ContentEntryIcon, contentTypeLabel, formatDate, useProjectContentIndex,
} from "./project-content";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import { listNonWorkshopMembers, type NonWorkshopMemberEntry } from "@/lib/live-project-collaborators";
import { fetchProjectKnowledge, fetchProjectReasoning, knowledgeGraphErrorCode } from "@/lib/knowledge-graph-api";
import { PROJECT_STATUS_LABEL, type ProjectOverview } from "@/lib/live-projects";

/**
 * 通用项目 ·「概览」tab（#4615，PROP-PROJECT-WORKSPACE-001 §3.4）。
 *
 * 全部来自已有接口，不出现任何预设数字：
 *   - 项目名 / 状态：`getProjectOverview`（工作台已拉，经 props 传入）；
 *   - 成员：`listNonWorkshopMembers`（负责人 / 协作者两档）；
 *   - 各类内容数量 + 最近更新：`useProjectContentIndex`（对话 `listThreads` + 资源 `listProjectResources`）；
 *   - 项目大脑摘要：`getProjectKnowledge`（结论数 / 待验证——判据同研究总览 `unverifiedHypotheses`）+
 *     `getProjectReasoning`（冲突数）。
 * 不显示工作坊卡片（当前环节 / 角色人数 / 蓝本）。
 */
const RECENT_LIMIT = 5;

export function TabGeneralOverview({ projectId, liveOverview, tabHref }: {
  projectId: string;
  liveOverview: ProjectOverview | null;
  /** 拼到本工作台某个 tab（带 `sub`）的链接——由工作台提供，保留 `?org=` / `?as=` 等参数。 */
  tabHref: (tab: string, sub?: string) => string;
}) {
  const index = useProjectContentIndex(projectId);
  const members = useMembers(projectId);
  const brain = useBrainSummary(projectId);
  const recent = index.entries.slice(0, RECENT_LIMIT);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 p-6" data-testid="project-general-overview">
      <Card>
        <div className="flex flex-col gap-3 p-4" data-testid="project-general-overview-head">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-16 font-semibold tracking-tight">{liveOverview?.name ?? "项目"}</h2>
            {liveOverview && <Badge tone="outline">{PROJECT_STATUS_LABEL[liveOverview.status]}</Badge>}
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="project-general-overview-members">
            <Users aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
            {members.error !== null ? (
              <span className="text-11 text-muted-foreground" data-testid="project-general-overview-members-error">{members.error}</span>
            ) : members.items === null ? (
              <span className="text-11 text-muted-foreground">读取成员中…</span>
            ) : members.items.length === 0 ? (
              <span className="text-11 text-muted-foreground">还没有成员。</span>
            ) : (
              members.items.map((m) => (
                <span key={m.userId} className="inline-flex items-center gap-1.5" data-testid={`project-general-overview-member-${m.userId}`}>
                  <Avatar initials={m.displayName.slice(0, 1)} size="sm" />
                  <span className="text-12">{m.displayName}</span>
                  {m.role === "owner" && <Badge tone="outline">负责人</Badge>}
                </span>
              ))
            )}
          </div>
        </div>
      </Card>

      <section>
        <SectionTitle meta="点一类直达「内容」里的筛选">内容</SectionTitle>
        {index.error !== null && (
          <p className="mb-2 text-11 text-destructive" data-testid="project-general-overview-content-error">{index.error}</p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="project-general-overview-counts">
          {CONTENT_FILTERS.filter((f) => f.key !== "all").map((f) => (
            <a
              key={f.key}
              href={tabHref("content", f.key)}
              data-testid={`project-general-overview-count-${f.key}`}
              className="flex items-baseline justify-between rounded-lg border border-border bg-card px-3 py-2.5 transition-colors duration-base hover:border-primary"
            >
              <span className="text-12 text-muted-foreground">{f.label}</span>
              <span className="font-mono text-16 font-semibold">
                {index.ready ? index.counts[f.key as Exclude<typeof f.key, "all">] : "—"}
              </span>
            </a>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle meta={`最近更新的 ${RECENT_LIMIT} 条`}>最近更新</SectionTitle>
        {!index.ready ? (
          <Card><p className="p-4 text-11 text-muted-foreground">{index.loading ? "读取中…" : "暂无数据。"}</p></Card>
        ) : recent.length === 0 ? (
          <Card>
            <p className="p-4 text-11 text-muted-foreground" data-testid="project-general-overview-recent-empty">
              项目里还没有内容——去「内容」新建一段对话、一块白板，或把已有的访谈、问卷关联进来。
            </p>
          </Card>
        ) : (
          <ul className="flex flex-col gap-1.5" data-testid="project-general-overview-recent">
            {recent.map((e) => (
              <li key={`${e.type}-${e.id}`}>
                <a
                  href={e.href}
                  data-testid={`project-general-overview-recent-${e.type}-${e.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-2 transition-colors duration-base hover:border-primary"
                >
                  <ContentEntryIcon entry={e} className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-12">{e.title}</span>
                  <Badge tone="outline">{contentTypeLabel(e.type)}</Badge>
                  <span className="shrink-0 text-10 text-muted-foreground">{formatDate(e.updatedAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle meta="项目记忆里 AI 与成员沉淀的结论">项目大脑</SectionTitle>
        <a
          href={tabHref("brain")}
          data-testid="project-general-overview-brain"
          className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card px-4 py-3 transition-colors duration-base hover:border-primary"
        >
          <Brain aria-hidden className="h-4 w-4 text-ai" />
          {brain.error !== null ? (
            <span className="text-11 text-muted-foreground" data-testid="project-general-overview-brain-error">{brain.error}</span>
          ) : brain.summary === null ? (
            <span className="text-11 text-muted-foreground">读取中…</span>
          ) : (
            <>
              <BrainStat label="结论" value={brain.summary.claims} testId="project-general-overview-brain-claims" />
              <BrainStat label="待验证" value={brain.summary.unverified} testId="project-general-overview-brain-unverified" />
              <BrainStat label="冲突" value={brain.summary.conflicts} testId="project-general-overview-brain-conflicts" />
            </>
          )}
        </a>
      </section>
    </div>
  );
}

function BrainStat({ label, value, testId }: { label: string; value: number | null; testId: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5" data-testid={testId}>
      <span className="font-mono text-16 font-semibold">{value ?? "—"}</span>
      <span className="text-11 text-muted-foreground">{label}</span>
    </span>
  );
}

function useMembers(projectId: string) {
  const [items, setItems] = React.useState<readonly NonWorkshopMemberEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!getStoredSessionToken()) return;
    let alive = true;
    listNonWorkshopMembers(projectId).then(
      (out) => { if (alive) setItems(out.members); },
      (e: unknown) => { if (alive) setError(e instanceof ApiError ? httpFailureText(e.status) : "成员暂时读不到。"); },
    );
    return () => { alive = false; };
  }, [projectId]);
  return { items, error };
}

function useBrainSummary(projectId: string) {
  const [summary, setSummary] = React.useState<{ claims: number; unverified: number; conflicts: number | null } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!getStoredSessionToken()) return;
    let alive = true;
    // 推演那一路失败只让「冲突」显示「—」，结论数照常。
    const reasoning = fetchProjectReasoning(projectId).then((r) => r.conflicts.length, () => null);
    fetchProjectKnowledge(projectId).then(
      async (k) => {
        const conflicts = await reasoning;
        if (alive) setSummary({ claims: k.claims.length, unverified: unverifiedHypotheses(k.claims).length, conflicts });
      },
      (e: unknown) => {
        if (!alive) return;
        const code = knowledgeGraphErrorCode(e);
        setError(code === "KG_NOT_VISIBLE" ? "你看不到这个项目的项目大脑。" : "项目大脑暂时读不到。");
      },
    );
    return () => { alive = false; };
  }, [projectId]);
  return { summary, error };
}
