"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ProjectBreadcrumb, withProjectId } from "@/components/project/project-breadcrumb";
import { linkProjectResource } from "@/lib/live-project-resources";
import { CreateSurveyDialog } from "./create-survey-dialog";
import { hasPendingAiImport, markPendingAiImport } from "@/lib/survey/pending-ai-import";
import { surveyPath } from "@/lib/survey/paths";
/**
 * `projectId`（项目中枢 B2-S2）：从项目「研究洞察 › 问卷」带 `?projectId=` 进来时，顶部挂「返回项目」
 * 面包屑；新建弹窗建成后先把问卷挂回该项目，再带 `projectId` 进工作台。
 */
export function LiveSurveyLibrary({ projectId = null }: { projectId?: string | null }) {
  const router = useRouter();
  const [items, setItems] = React.useState<SurveyRuntime[]>([]);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [tag, setTag] = React.useState<string | null>(null);
  const [creating,setCreating]=React.useState(false);
  const tags = [...new Set(items.flatMap(item=>item.tags??[]))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const visibleItems = items.filter((item) => (!tag || item.tags?.includes(tag)) && [item.title,...(item.tags??[])].some(text=>text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const refresh = React.useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setItems(await surveyRequest<SurveyRuntime[]>("/surveys"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  const remove = async (item: SurveyRuntime) => {
    if (!window.confirm("删除问卷及其答卷和报告？此操作不能撤销。")) return;
    setBusy(true);
    try {
      await surveyRequest(`/surveys/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        query: { expectedVersion: String(item.version) },
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = (item: SurveyRuntime) => {
    const pendingImport = !item.publication && hasPendingAiImport(item.id);
    router.push(withProjectId(pendingImport ? `/studio/survey/${item.id}?step=import&mode=ai` : surveyPath(item.id, "design"), projectId));
  };
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <ProjectBreadcrumb projectId={projectId} sub="survey" className="" />
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-30 font-semibold tracking-tight">问卷</h1>
          <p className="mt-1 text-14 text-muted-foreground">创建、发布并收集你的问卷，轻松获取真实反馈。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2"><Input className="w-64 max-w-full" aria-label="搜索问卷" placeholder="搜索问卷名称、标签或关键词" value={query} onChange={event=>setQuery(event.target.value)}/><Button data-testid="survey-create-primary" onClick={() => setCreating(true)}>新建问卷</Button></div>
      </header>
      <div className="flex flex-col gap-5 lg:flex-row">
        <nav aria-label="问卷二级导航" className="flex shrink-0 gap-2 lg:w-44 lg:flex-col">
          <Link aria-current="page" className="rounded-md bg-muted px-4 py-3 text-14 font-medium" href="/studio/survey">我的问卷</Link>
          <Link className="rounded-md px-4 py-3 text-14 transition-colors hover:bg-muted" href="/studio/survey?tab=modules">问卷模板</Link>
          <Link className="rounded-md px-4 py-3 text-14 transition-colors hover:bg-muted" href="/studio/survey?tab=reports">报告模板</Link>
        </nav>
        <div className="min-w-0 flex-1 space-y-5">
      <div className="flex flex-wrap items-center gap-2" aria-label="标签筛选">
        <Button size="sm" variant={tag===null?"primary":"outline"} onClick={()=>setTag(null)}>全部</Button>
        {tags.map(value=><Button key={value} size="sm" variant={tag===value?"primary":"outline"} onClick={()=>setTag(value)}>{value}</Button>)}
        <span className="ml-auto text-12 text-muted-foreground">共 {items.length} 个问卷</span>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {busy && <p role="status">正在加载…</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {visibleItems
          .map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3"><Link className="text-18 font-semibold leading-snug transition-colors hover:underline" href={withProjectId(`/studio/survey/${item.id}`, projectId)} onClick={event=>{event.preventDefault();open(item);}}>{item.title}</Link><span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-12" data-testid={`survey-status-${item.id}`}>{item.publication?.status === "collecting"
                  ? "回收中"
                  : item.publication
                    ? "已关闭"
                    : item.status === "ready" ? "待发布" : "草稿"}</span></div>
              <p className="mt-3 line-clamp-2 min-h-10 text-13 text-muted-foreground">{item.questions[0]?.title ? `包含“${item.questions[0].title}”等问题，邀请目标受访者分享真实反馈。` : "添加问题、发布问卷并收集真实反馈。"}</p>
              {!!item.tags?.length&&<div className="mt-3 flex flex-wrap gap-2">{item.tags.map(value=><span key={value} className="rounded-full bg-muted px-2 py-1 text-12 text-muted-foreground">{value}</span>)}</div>}
              <div className="mt-5 grid grid-cols-3 divide-x divide-border text-center">
                <div><p className="text-20 font-semibold">{item.questions.length}</p><p className="text-12 text-muted-foreground">题目数</p></div>
                <div><p className="text-20 font-semibold">{item.responses.length}</p><p className="text-12 text-muted-foreground">答卷数</p></div>
                <div><p className="text-20 font-semibold">{item.responses.filter((response) => response.analysis !== "excluded").length}</p><p className="text-12 text-muted-foreground">纳入分析</p></div>
              </div>
              <p className="mt-5 text-12 text-muted-foreground">最近更新：{new Date(item.updatedAt).toLocaleString("zh-CN")}</p>
              <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                <Button variant="outline" size="xs" onClick={() => router.push(withProjectId(surveyPath(item.id, "responses"), projectId))}>查看答卷</Button>
                <Button size="xs" onClick={() => open(item)}>{item.status === "collecting" || item.status === "closed" ? "继续编辑" : "继续设计"}</Button>
                <details className="relative group"><summary aria-label={`更多操作：${item.title}`} className="cursor-pointer list-none rounded-control border border-border px-3 py-1 text-16 transition-colors hover:bg-muted">⋯</summary><div className="absolute right-0 z-10 mt-1 rounded-control border border-border bg-card p-1 shadow-lg"><Button variant="ghost" size="xs" disabled={busy} onClick={() => void remove(item)}>删除问卷</Button></div></details>
              </div>
            </article>
          ))}
        {!busy && !error && items.length > 0 && <aside className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <p className="text-12 text-muted-foreground">报告模板（可选）</p>
          <h2 className="mt-1 text-18 font-semibold">按需设计分析报告</h2>
          <p className="mt-3 text-13 text-muted-foreground">先完成问卷设计与回收；需要自定义分析时，再选择报告模板。</p>
          <Link href="/studio/survey?tab=reports" className="mt-5 inline-flex rounded-control border border-border px-3 py-2 text-13 font-medium transition-colors hover:bg-muted">查看报告模板 →</Link>
        </aside>}
      </div>
      {!busy && !error && items.length > 0 && visibleItems.length === 0 && <p role="status" className="py-12 text-center text-muted-foreground">没有符合筛选条件的问卷</p>}
      {!busy && !error && items.length === 0 && (
        <div className="space-y-4 py-16 text-center"><h2 className="text-18 font-semibold">还没有问卷</h2><p className="text-muted-foreground">从空白问卷或现有模板开始，三步完成设计、回收与答卷查看。</p><Button onClick={() => setCreating(true)}>新建问卷</Button></div>
      )}
      </div></div>
      <CreateSurveyDialog open={creating} onOpenChange={setCreating} onCreated={async (id,mode) => {
        if (mode === "ai") markPendingAiImport(id);
        // 挂失败不回滚问卷（问卷已存在），项目页可用「关联已有问卷」补挂。
        if (projectId) { try { await linkProjectResource({ projectId, kind: "survey", resourceId: id }); } catch { /* 项目页可补挂 */ } }
        router.push(withProjectId(mode === "ai" ? `/studio/survey/${id}?step=import&mode=ai` : surveyPath(id, "design"), projectId));
      }} />
    </main>
  );
}
