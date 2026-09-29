"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import {
  ArrowRight, BarChart3, ChevronDown, Clock3, FileText,
  LayoutGrid, MoreHorizontal, Plus, Search,
} from "lucide-react";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectBreadcrumb, withProjectId } from "@/components/project/project-breadcrumb";
import { linkProjectResource } from "@/lib/live-project-resources";
import { hasPendingAiImport } from "@/lib/survey/pending-ai-import";
import { surveyPath } from "@/lib/survey/paths";
import { encodeSurveyCreationDraft } from "@/lib/survey/creation-draft";
import { CreateSurveyDialog } from "./create-survey-dialog";

function statusFor(item: SurveyRuntime) {
  if (item.publication?.status === "collecting") return { label: "发布中", tone: "success" } as const;
  if (item.publication) return { label: "已停止", tone: "warning" } as const;
  return { label: item.status === "ready" ? "待发布" : "草稿", tone: "info" } as const;
}

function LibraryLoading() {
  return (
    <div role="status" aria-label="正在加载问卷" data-testid="survey-library-loading" className="grid gap-4 lg:grid-cols-2">
      <span className="sr-only">正在加载问卷</span>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="animate-pulse rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex gap-4">
            <div className="h-28 w-28 shrink-0 rounded-lg bg-muted" />
            <div className="flex-1 space-y-3 py-1">
              <div className="h-5 w-2/3 rounded bg-muted" />
              <div className="h-4 w-full rounded bg-muted" />
              <div className="h-4 w-1/2 rounded bg-muted" />
            </div>
          </div>
          <div className="mt-4 h-16 rounded-lg bg-muted" />
        </div>
      ))}
    </div>
  );
}

function SurveyStatus({ item }: { item: SurveyRuntime }) {
  const status = statusFor(item);
  const dotClass = status.tone === "success"
    ? "bg-success"
    : status.tone === "warning"
      ? "bg-destructive"
      : "bg-primary";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 rounded-full bg-muted px-3 py-1 text-12 font-medium"
      data-testid={`survey-status-${item.id}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotClass}`} />
      {status.label}
    </span>
  );
}

function SurveyCard({
  item, busy, projectId, onOpen, onRemove, onResponses,
}: {
  item: SurveyRuntime;
  busy: boolean;
  projectId: string | null;
  onOpen: (item: SurveyRuntime) => void;
  onRemove: (item: SurveyRuntime) => void;
  onResponses: (item: SurveyRuntime) => void;
}) {
  const includedResponses = item.responses.filter((response) => response.analysis !== "excluded").length;
  return (
    <article className="group rounded-xl border border-border bg-card p-4 shadow-sm transition-all duration-base hover:shadow-md">
      <div className="flex items-start gap-4">
        <div
          data-testid={`survey-card-cover-${item.id}`}
          className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-muted to-border"
        >
          <FileText aria-hidden="true" className="h-10 w-10 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <Link
              className="line-clamp-1 text-18 font-semibold leading-snug transition-colors hover:text-muted-foreground"
              href={withProjectId(`/studio/survey/${item.id}`, projectId)}
              onClick={(event) => { event.preventDefault(); onOpen(item); }}
            >
              {item.title}
            </Link>
            <SurveyStatus item={item} />
          </div>
          <p className="mt-2 line-clamp-2 min-h-10 text-13 leading-relaxed text-muted-foreground">
            {item.questions[0]?.title
              ? `包含“${item.questions[0].title}”等问题，邀请目标受访者分享真实反馈。`
              : "添加问题、发布问卷并收集真实反馈。"}
          </p>
          {!!item.tags?.length && (
            <div className="mt-2 flex flex-wrap gap-2">
              {item.tags.slice(0, 3).map((value) => (
                <span key={value} className="rounded-full bg-muted px-2.5 py-1 text-11 text-muted-foreground">{value}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 divide-x divide-border border-b border-border pb-4 text-center">
        <div><p className="text-20 font-semibold">{item.questions.length}</p><p className="text-12 text-muted-foreground">题目数</p></div>
        <div><p className="text-20 font-semibold">{item.responses.length}</p><p className="text-12 text-muted-foreground">答卷数</p></div>
        <div><p className="text-20 font-semibold">{includedResponses}</p><p className="text-12 text-muted-foreground">有效答卷</p></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="mr-auto inline-flex items-center gap-2 text-12 text-muted-foreground">
          <Clock3 aria-hidden="true" className="h-4 w-4" />
          最近更新：{new Date(item.updatedAt).toLocaleString("zh-CN")}
        </p>
        <Button variant="outline" size="xs" onClick={() => onResponses(item)}>查看答卷</Button>
        <Button size="xs" onClick={() => onOpen(item)}>{item.publication ? "继续编辑" : "继续设计"}</Button>
        <details className="relative">
          <summary
            aria-label={`更多操作：${item.title}`}
            className="flex h-7 w-9 cursor-pointer list-none items-center justify-center rounded-control border border-border transition-colors hover:bg-muted"
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </summary>
          <div className="absolute right-0 z-10 mt-1 min-w-28 rounded-control border border-border bg-card p-1 shadow-lg">
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => onRemove(item)}>删除问卷</Button>
          </div>
        </details>
      </div>
    </article>
  );
}

/** 项目入口保留 projectId；问卷数据和操作均来自正式 API。 */
export function LiveSurveyLibrary({ projectId = null }: { projectId?: string | null }) {
  const router = useRouter();
  const [items, setItems] = React.useState<SurveyRuntime[]>([]);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [tag, setTag] = React.useState<string | null>(null);
  const [showAllTags, setShowAllTags] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const tags = [...new Set(items.flatMap((item) => item.tags ?? []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const visibleItems = items
    .filter((item) => (!tag || item.tags?.includes(tag)) && [item.title, ...(item.tags ?? [])]
      .some((text) => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const refresh = React.useCallback(async () => {
    setBusy(true);
    setError("");
    try { setItems(await surveyRequest<SurveyRuntime[]>("/surveys")); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const remove = async (item: SurveyRuntime) => {
    if (!window.confirm("删除问卷及其答卷和报告？此操作不能撤销。")) return;
    setBusy(true);
    try {
      await surveyRequest(`/surveys/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        query: { expectedVersion: String(item.version) },
      });
      await refresh();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };

  const open = (item: SurveyRuntime) => {
    const pendingImport = !item.publication && hasPendingAiImport(item.id);
    router.push(withProjectId(
      pendingImport ? `/studio/survey/${item.id}?step=import&mode=ai` : surveyPath(item.id, "design"),
      projectId,
    ));
  };

  return (
    <main className="mx-auto max-w-screen-2xl space-y-7 p-5 sm:p-7 lg:p-10">
      <ProjectBreadcrumb projectId={projectId} sub="survey" className="" />
      <header className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-30 font-semibold tracking-tight">问卷</h1>
          <p className="mt-1 text-14 text-muted-foreground">创建、发布并收集你的问卷，轻松获取真实反馈。</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row xl:w-auto">
          <div className="relative min-w-0 sm:w-72">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="w-full pl-9"
              aria-label="搜索问卷"
              placeholder="搜索问卷名称、标签或关键词…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button data-testid="survey-create-primary" onClick={() => setCreating(true)}><Plus aria-hidden="true" className="h-4 w-4" />新建问卷<ChevronDown aria-hidden="true" className="h-4 w-4" /></Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[208px_minmax(0,1fr)]">
        <nav aria-label="问卷二级导航" className="survey-library-nav flex gap-2 overflow-x-auto rounded-xl border border-border bg-card p-3 lg:flex-col lg:self-start">
          <Link aria-current="page" className="flex min-w-max items-center gap-3 rounded-lg bg-muted px-4 py-3 text-14 font-medium transition-colors hover:bg-muted" href="/studio/survey"><FileText aria-hidden="true" className="h-5 w-5" />我的问卷</Link>
          <Link className="flex min-w-max items-center gap-3 rounded-lg px-4 py-3 text-14 transition-colors hover:bg-muted" href="/studio/survey?tab=modules"><LayoutGrid aria-hidden="true" className="h-5 w-5" />问卷模板</Link>
          <Link className="flex min-w-max items-center gap-3 rounded-lg px-4 py-3 text-14 transition-colors hover:bg-muted" href="/studio/survey?tab=reports"><BarChart3 aria-hidden="true" className="h-5 w-5" />报告模板</Link>
        </nav>

        <section className="min-w-0 space-y-5" aria-label="我的问卷列表">
          <div className="flex flex-wrap items-center gap-2" aria-label="标签筛选">
            <Button size="sm" className="rounded-full" variant={tag === null ? "primary" : "secondary"} onClick={() => setTag(null)}>全部</Button>
            {(showAllTags ? tags : tags.slice(0, 7)).map((value) => <Button key={value} size="sm" className="rounded-full" variant={tag === value ? "primary" : "secondary"} onClick={() => setTag(value)}>{value}</Button>)}
            {tags.length > 7 && (
              <Button size="sm" className="rounded-full" variant="outline" aria-expanded={showAllTags} onClick={() => setShowAllTags((value) => !value)}>
                {showAllTags ? "收起标签" : "更多标签"}<ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform duration-base ${showAllTags ? "rotate-180" : ""}`} />
              </Button>
            )}
            <span className="ml-auto text-12 text-muted-foreground">共 {items.length} 个问卷</span>
          </div>

          {error && <div role="alert" data-testid="err-survey-library" className="rounded-lg border border-destructive bg-card p-4 text-13 text-destructive">{error}</div>}
          {busy && <LibraryLoading />}
          {!busy && !error && (
            <div className="grid gap-4 xl:grid-cols-2">
              {visibleItems.map((item) => (
                <SurveyCard
                  key={item.id}
                  item={item}
                  busy={busy}
                  projectId={projectId}
                  onOpen={open}
                  onRemove={(value) => void remove(value)}
                  onResponses={(value) => router.push(withProjectId(surveyPath(value.id, "responses"), projectId))}
                />
              ))}
              {items.length > 0 && (
                <aside className="relative min-h-64 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm">
                  <div className="relative z-10 max-w-md">
                    <p className="inline-flex rounded-full bg-muted px-3 py-1 text-11 text-muted-foreground">报告模板（可选）</p>
                    <h2 className="mt-3 text-18 font-semibold">为该问卷设计报告模板</h2>
                    <p className="mt-2 text-13 leading-relaxed text-muted-foreground">预设分析维度和图表样式，问卷回收后可一键生成专业报告。</p>
                    <Link href="/studio/survey?tab=reports" className="mt-5 inline-flex items-center gap-2 rounded-control border border-border px-4 py-2 text-13 font-medium transition-colors hover:bg-muted">去创建报告模板<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
                  </div>
                </aside>
              )}
            </div>
          )}

          {!busy && !error && items.length > 0 && visibleItems.length === 0 && (
            <div role="status" className="rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">没有符合筛选条件的问卷</div>
          )}
          {!busy && !error && items.length === 0 && (
            <div data-testid="empty" className="space-y-4 rounded-xl border border-dashed border-border py-16 text-center">
              <h2 className="text-18 font-semibold">还没有问卷</h2>
              <p className="text-14 text-muted-foreground">从空白问卷或现有模板开始，三步完成设计、回收与答卷查看。</p>
              <Button onClick={() => setCreating(true)}>新建问卷</Button>
            </div>
          )}
        </section>
      </div>

      <CreateSurveyDialog open={creating} onOpenChange={setCreating} onCreated={async (id, mode, draft) => {
        if (mode === "ai" && draft) {
          router.push(withProjectId(`/studio/survey/new/import?draft=${encodeURIComponent(encodeSurveyCreationDraft(draft))}`, projectId));
          return;
        }
        if (!id) return;
        if (projectId) {
          try { await linkProjectResource({ projectId, kind: "survey", resourceId: id }); }
          catch { /* 项目页可补挂 */ }
        }
        router.push(withProjectId(surveyPath(id, "design"), projectId));
      }} />
    </main>
  );
}
