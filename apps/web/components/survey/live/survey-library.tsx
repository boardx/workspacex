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
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-11 text-muted-foreground">Studio / 问卷</p>
          <h1 className="mt-2 text-24 font-semibold">我的问卷</h1>
        </div>
        <Button onClick={() => router.push("/studio/survey/new")}>
          创建问卷
        </Button>
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items
          .filter((item) => item.title.includes(query))
          .map((item) => (
            <article
              key={item.id}
              className="rounded-lg border border-border bg-card p-5"
            >
              <Link
                className="text-16 font-semibold"
                href={`/studio/survey/${item.id}`}
              >
                {item.title}
              </Link>
              <p className="mt-3 text-12 text-muted-foreground">
                {item.questions.length} 道题 · {item.responses.length} 份答卷 ·{" "}
                {item.publication?.status === "collecting"
                  ? "回收中"
                  : item.publication
                    ? "已关闭"
                    : "未发布"}
              </p>
              <div className="mt-5 flex justify-between">
                <Link
                  className="text-12 text-primary"
                  href={`/studio/survey/${item.id}`}
                >
                  打开问卷 →
                </Link>
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
      {!busy && !error && items.length === 0 && (
        <p className="py-16 text-center text-muted-foreground">
          还没有问卷，创建后即可设计题目和报告模板。
        </p>
      )}
    </main>
  );
}
