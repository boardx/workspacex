"use client";
import * as React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SectionTitle } from "./parts";
import { ApiError, getStoredSessionToken } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";
import {
  listProjectEvidence,
  PROJECT_EVIDENCE_SOURCE_KINDS,
  PROJECT_EVIDENCE_SOURCE_LABEL_ZH,
  PROJECT_EVIDENCE_TO_AI_SOURCE,
  type ListProjectEvidenceOut,
  type ProjectEvidenceItem,
  type ProjectEvidenceSourceKind,
} from "@/lib/live-project-evidence";
import { getProjectAiSettings, type ProjectAiSourceKind } from "@/lib/live-project-ai-settings";
import { cn } from "@/lib/utils";

/**
 * 研究洞察 › 来源（项目中枢 B3-T1，#4495）——本项目证据库的真实列表。
 *
 * 读：`listProjectEvidence(projectId, { sourceKind?, cursor? })`，服务端按项目成员校验（观察者也可读；非成员
 *     403 `NO_PROJECT_ROLE`，这里如实显示）。每条显示来源标签 / 摘录 / 说话人 / 材料标题；按来源筛选的 chips
 *     用 `countsBySource` 标数（六类含 0，服务端给的，不在这里数）。
 * 「已关闭」：设置页「AI 权限」（`getProjectAiSettings`）关掉的开关，经契约 `PROJECT_EVIDENCE_TO_AI_SOURCE`
 *     投影到证据来源——被关掉的来源在 chip 与条目上标「已关闭」（证据还在库里，只是不进项目大脑）。
 *     AI 权限读不到（非 lead 的 403 / 网络失败）⇒ 不标，也不当成错误：它只是个附加标记。
 * 分页：`nextCursor` 非空时给「加载更多」，追加到已列出的条目后面。
 */
const PAGE_SIZE = 50;

export function ProjectEvidenceSection({ projectId }: { projectId: string }) {
  const [filter, setFilter] = React.useState<ProjectEvidenceSourceKind | "all">("all");
  const [page, setPage] = React.useState<ListProjectEvidenceOut | null>(null);
  const [items, setItems] = React.useState<ProjectEvidenceItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [more, setMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [allowed, setAllowed] = React.useState<ReadonlySet<ProjectAiSourceKind> | null>(null);

  const load = React.useCallback(async () => {
    if (!getStoredSessionToken()) { setPage(null); setItems([]); return; }
    setLoading(true); setError(null);
    try {
      const out = await listProjectEvidence({ projectId, limit: PAGE_SIZE, ...(filter === "all" ? {} : { sourceKind: filter }) });
      setPage(out); setItems([...out.items]);
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, filter]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (!getStoredSessionToken()) return;
    let alive = true;
    getProjectAiSettings(projectId)
      .then((s) => { if (alive) setAllowed(new Set(s.allowedSources)); })
      .catch(() => { if (alive) setAllowed(null); });
    return () => { alive = false; };
  }, [projectId]);

  async function loadMore() {
    if (page?.nextCursor == null) return;
    setMore(true); setError(null);
    try {
      const out = await listProjectEvidence({
        projectId, limit: PAGE_SIZE, cursor: page.nextCursor, ...(filter === "all" ? {} : { sourceKind: filter }),
      });
      setPage(out); setItems((prev) => [...prev, ...out.items]);
    } catch (e) {
      setError(describeFailure(e));
    } finally {
      setMore(false);
    }
  }

  const isOff = (kind: ProjectEvidenceSourceKind): boolean => allowed !== null && !allowed.has(PROJECT_EVIDENCE_TO_AI_SOURCE[kind]);
  const total = page === null ? 0 : Object.values(page.countsBySource).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-6" data-testid="project-evidence">
      <SectionTitle meta="五类材料归一后的证据单元：项目大脑的结论只引用这里的条目" className="mb-0">来源</SectionTitle>

      {page !== null && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="project-evidence-filters">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} testId="project-evidence-filter-all">
            全部 {total}
          </FilterChip>
          {PROJECT_EVIDENCE_SOURCE_KINDS.map((k) => (
            <FilterChip key={k} active={filter === k} onClick={() => setFilter(k)} testId={`project-evidence-filter-${k}`} off={isOff(k)}>
              {PROJECT_EVIDENCE_SOURCE_LABEL_ZH[k]} {page.countsBySource[k]}
              {isOff(k) ? <span className="ml-1 opacity-80">· 已关闭</span> : null}
            </FilterChip>
          ))}
        </div>
      )}

      {error !== null ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-panel px-3 py-2">
          <p className="flex-1 text-11 text-destructive" data-testid="project-evidence-error">{error}</p>
          <Button size="xs" variant="outline" onClick={() => void load()} data-testid="project-evidence-retry">重试</Button>
        </div>
      ) : null}

      {error !== null && page === null ? null : (
      <Card>
        {loading && page === null ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-evidence-loading">读取证据库中…</p>
        ) : total === 0 ? (
          <p className="p-4 text-11 leading-relaxed text-muted-foreground" data-testid="project-evidence-empty">
            本项目还没有证据。把问卷 / 深度研究 / 录音转写挂到项目上，或在项目对话里聊起来，材料会被整理成证据出现在这里。
          </p>
        ) : items.length === 0 ? (
          <p className="p-4 text-11 text-muted-foreground" data-testid="project-evidence-filtered-empty">这个来源下还没有证据。</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border px-3.5" data-testid="project-evidence-list">
            {items.map((it) => (
              <li key={it.id} className="flex flex-col gap-1 py-2.5 text-11" data-testid={`project-evidence-${it.id}`} data-source-kind={it.sourceKind}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={isOff(it.sourceKind) ? "outline" : "primary"}>{PROJECT_EVIDENCE_SOURCE_LABEL_ZH[it.sourceKind]}</Badge>
                  {isOff(it.sourceKind) ? <Badge tone="outline" data-testid={`project-evidence-${it.id}-off`}>已关闭</Badge> : null}
                  {it.revoked ? <Badge tone="warning">源已撤回</Badge> : null}
                  <span className="min-w-0 flex-1 truncate text-10 text-muted-foreground" title={it.resourceTitle}>{it.resourceTitle}</span>
                  <span className="shrink-0 font-mono text-10 text-muted-foreground">{formatLocator(it)}</span>
                </div>
                <p className="leading-relaxed" data-testid={`project-evidence-${it.id}-excerpt`}>{it.excerpt}</p>
                <p className="text-10 text-muted-foreground" data-testid={`project-evidence-${it.id}-speaker`}>
                  {it.speakerLabel !== null ? it.speakerLabel : it.sourceKind === "survey_response" ? "匿名答题人" : "说话人未识别"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      )}

      {page?.nextCursor != null && (
        <Button size="sm" variant="outline" disabled={more} onClick={() => void loadMore()} data-testid="project-evidence-more">
          {more ? "加载中…" : "加载更多"}
        </Button>
      )}
    </div>
  );
}

/** 定位一句：题 / 段序号、时间、页码；消息类没有定位就空。 */
export function formatLocator(it: Pick<ProjectEvidenceItem, "locator" | "createdAt">): string {
  const parts: string[] = [];
  if (it.locator.ordinal !== undefined) parts.push(`#${it.locator.ordinal}`);
  if (it.locator.page !== undefined) parts.push(`第 ${it.locator.page} 页`);
  if (it.locator.startMs !== undefined) parts.push(msToClock(it.locator.startMs) + (it.locator.endMs !== undefined ? `–${msToClock(it.locator.endMs)}` : ""));
  return parts.join(" · ");
}

function msToClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function describeFailure(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.reasonCode === "NO_PROJECT_ROLE") return "你不在这个项目里，看不到它的证据。";
    return httpFailureText(e.status);
  }
  return e instanceof Error ? e.message : "读取失败，请稍后重试。";
}

function FilterChip({ active, onClick, testId, off = false, children }: {
  active: boolean; onClick: () => void; testId: string; off?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      data-off={off ? "true" : undefined}
      className={cn(
        "rounded-sm border px-1.5 py-0.5 text-10 font-medium transition-colors hover:bg-muted",
        active ? "border-primary bg-primary text-primary-foreground hover:bg-primary-hover" : "border-border text-muted-foreground",
        off && !active ? "border-dashed" : undefined,
      )}
    >
      {children}
    </button>
  );
}
