"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SurveyRuntime } from "@repo/contracts/survey-runtime";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export function LiveSurveyLibrary() {
  const router = useRouter();
  const [items, setItems] = React.useState<SurveyRuntime[]>([]);
  const [busy, setBusy] = React.useState(true);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const visibleItems = items.filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    const step = item.status === "collecting" || item.status === "closed" ? "responses" : "design";
    router.push(`/studio/survey/${item.id}?step=${step}`);
  };
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-11 text-muted-foreground">Studio / 问卷</p>
          <h1 className="mt-2 text-24 font-semibold">我的问卷</h1>
          <p className="mt-2 text-13 text-muted-foreground">创建、发布并收集你的问卷，轻松获取真实反馈。</p>
        </div>
        <div className="flex flex-wrap gap-2"><Link className="inline-flex min-h-8 items-center rounded-control border border-border bg-card px-3 text-13 font-medium text-card-foreground" href="/studio/survey?tab=modules">问卷模板</Link><Link className="inline-flex min-h-8 items-center rounded-control border border-border bg-card px-3 text-13 font-medium text-card-foreground" href="/studio/survey?tab=reports">报告模板</Link><Button onClick={() => router.push("/studio/survey/new?step=design")}>新建问卷</Button></div>
      </header>
      <div className="flex gap-2">
        <Input
          aria-label="搜索问卷"
          placeholder="搜索问卷名称"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新
        </Button>
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
              className="rounded-lg border border-border bg-card p-6"
            >
              <Link
                className="text-16 font-semibold"
                href={`/studio/survey/${item.id}`}
              >
                {item.title}
              </Link>
              <p className="mt-3 text-12 text-muted-foreground">
                {item.questions.length} 道题 · {item.responses.length} 份答卷 ·{" "}
                <span data-testid={`survey-status-${item.id}`}>{item.publication?.status === "collecting"
                  ? "回收中"
                  : item.publication
                    ? "已关闭"
                    : item.status === "ready" ? "待发布" : "草稿"}</span>
              </p>
              <div className="mt-5 grid grid-cols-3 divide-x divide-border text-center">
                <div><p className="text-20 font-semibold">{item.questions.length}</p><p className="text-12 text-muted-foreground">题目数</p></div>
                <div><p className="text-20 font-semibold">{item.responses.length}</p><p className="text-12 text-muted-foreground">答卷数</p></div>
                <div><p className="text-20 font-semibold">{item.responses.filter((response) => response.analysis !== "excluded" && response.quality !== "review").length}</p><p className="text-12 text-muted-foreground">纳入分析</p></div>
              </div>
              <p className="mt-5 text-12 text-muted-foreground">最近更新：{new Date(item.updatedAt).toLocaleString("zh-CN")}</p>
              <div className="mt-5 flex justify-between">
                <Button variant="outline" size="xs" onClick={() => open(item)}>{item.status === "collecting" || item.status === "closed" ? "查看答卷" : "继续设计"}</Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => void remove(item)}
                >
                  删除
                </Button>
              </div>
            </article>
          ))}
      </div>
      {!busy && !error && items.length > 0 && visibleItems.length === 0 && <p role="status" className="py-12 text-center text-muted-foreground">没有符合筛选条件的问卷</p>}
      {!busy && !error && items.length === 0 && (
        <div className="space-y-4 py-16 text-center"><h2 className="text-18 font-semibold">还没有问卷</h2><p className="text-muted-foreground">从空白问卷或现有模板开始，三步完成设计、回收与答卷查看。</p><Button onClick={() => router.push("/studio/survey/new?step=design")}>新建问卷</Button></div>
      )}
    </main>
  );
}
