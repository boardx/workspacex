"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileText, Plus, Search, Trash2 } from "lucide-react";
import {
  SurveyLibraryTemplateSchema,
  SurveyTemplateInputSchema,
  type SurveyLibraryTemplate,
} from "@repo/contracts/survey-template-library";
import { SurveyRuntimeSchema } from "@repo/contracts/survey-runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { surveyRequest } from "@/lib/survey/runtime-client";

type Kind = SurveyLibraryTemplate["kind"];
export function SurveyTemplateLibrary({ kind }: { kind: Kind }) {
  const router = useRouter();
  const [items, setItems] = React.useState<SurveyLibraryTemplate[]>([]);
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const generation = React.useRef(0);
  const invalidate = React.useCallback(() => {
    generation.current++;
  }, []);
  const locked = React.useRef(false);
  const label = kind === "question" ? "问卷模板" : "报告模板";
  const base =
    kind === "question"
      ? "/studio/survey/question-templates"
      : "/studio/survey/templates";
  const readRow = (data: unknown) => {
    const parsed = SurveyLibraryTemplateSchema.safeParse(data);
    if (!parsed.success || parsed.data.kind !== kind)
      throw new Error("模板数据格式不正确，请刷新后重试。");
    return parsed.data;
  };
  const refresh = React.useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const parsed = SurveyLibraryTemplateSchema.array().safeParse(
        await surveyRequest("/surveys/templates", { query: { kind } }),
      );
      if (!parsed.success || parsed.data.some((item) => item.kind !== kind))
        throw new Error("模板数据格式不正确，请刷新后重试。");
      if (current === generation.current) setItems(parsed.data);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "模板加载失败，请重试。");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [kind]);
  React.useEffect(() => {
    setItems([]);
    setQuery("");
    setNotice("");
    void refresh();
    return invalidate;
  }, [refresh, invalidate]);
  const execute = async (action: (current: number) => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      await action(current);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "操作未完成，请重试。");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const duplicate = (item: SurveyLibraryTemplate) =>
    execute(async (current) => {
      const body = SurveyTemplateInputSchema.parse({
        kind: item.kind,
        title: `${item.title.slice(0, 197)} 副本`,
        description: item.description,
        questions: item.questions,
        template: item.template,
      });
      const saved = readRow(
        await surveyRequest("/surveys/templates", { method: "POST", body }),
      );
      if (current !== generation.current) return;
      setItems((previous) => [saved, ...previous]);
      setQuery("");
      setNotice("副本已创建，原模板保持不变。");
    });
  const remove = (item: SurveyLibraryTemplate) => {
    if (
      !window.confirm(
        `删除模板「${item.title}」？已创建的问卷不受影响，此操作不能撤销。`,
      )
    )
      return;
    void execute(async (current) => {
      await surveyRequest(`/surveys/templates/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
        query: { expectedVersion: String(item.version) },
      });
      if (current !== generation.current) return;
      setItems((previous) => previous.filter((value) => value.id !== item.id));
      setNotice("模板已删除。");
    });
  };
  const createSurvey = (item: SurveyLibraryTemplate) =>
    execute(async (current) => {
      const parsed = SurveyRuntimeSchema.safeParse(
        await surveyRequest("/surveys", {
          method: "POST",
          body: {
            title: item.title,
            questions: item.questions,
            template: item.template,
          },
        }),
      );
      if (!parsed.success)
        throw new Error("问卷创建结果无法确认，请返回问卷列表核对后再试。");
      if (current === generation.current)
        router.push(`/studio/survey/${encodeURIComponent(parsed.data.id)}`);
    });
  const visible = items.filter((item) =>
    `${item.title} ${item.description}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 text-background-foreground sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-11 text-muted-foreground">Studio / {label}</p>
          <h1 className="mt-2 text-24 font-semibold">{label}</h1>
          <p className="mt-2 max-w-2xl text-13 text-muted-foreground">
            {kind === "question"
              ? "保存可重复使用的题目与配套报告，用模板开始一份新问卷。"
              : "保存章节、内容块与数据配置，在问卷中选择模板并关联题目。"}
          </p>
        </div>
        <Button disabled={busy} onClick={() => router.push(`${base}/new`)}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          新建{label}
        </Button>
      </header>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="搜索模板"
            placeholder="搜索名称或说明"
            className="pl-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          刷新
        </Button>
      </div>
      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-card p-4">
          <p role="alert" className="text-13 text-destructive">
            {error}
          </p>
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            重试
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" className="text-13 text-muted-foreground">
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="py-8 text-13 text-muted-foreground">
          正在加载模板…
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((item) => (
          <article
            key={item.id}
            className="flex min-w-0 flex-col rounded-lg border border-border bg-card p-5"
          >
            <div className="mb-3 flex items-start gap-3">
              <FileText
                className="mt-1 h-5 w-5 shrink-0 text-primary"
                aria-hidden
              />
              <h2 className="break-words text-16 font-semibold">
                {item.title}
              </h2>
            </div>
            <p className="min-h-10 whitespace-pre-wrap break-words text-13 text-muted-foreground">
              {item.description || "暂无说明"}
            </p>
            <p className="mt-4 text-12 text-muted-foreground">
              {item.questions.length} 道{kind === "report" ? "参考" : ""}题目 ·{" "}
              {item.template.sections.length} 个报告章节
            </p>
            <p className="mt-1 text-11 text-muted-foreground">
              更新于 {new Date(item.updatedAt).toLocaleString("zh-CN")}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Link
                className="rounded-md border border-border px-3 py-2 text-12 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                href={`${base}/${encodeURIComponent(item.id)}`}
              >
                编辑模板
              </Link>
              <Button
                variant="ghost"
                size="xs"
                aria-label="复制模板"
                disabled={busy || loading}
                onClick={() => void duplicate(item)}
              >
                <Copy className="mr-1 h-3.5 w-3.5" aria-hidden />
                复制
              </Button>
              <Button
                variant="ghost"
                size="xs"
                aria-label="删除模板"
                disabled={busy || loading}
                onClick={() => remove(item)}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                删除
              </Button>
            </div>
            {kind === "question" && (
              <>
                <Button
                  className="mt-3 w-full"
                  disabled={busy || loading || item.questions.length === 0}
                  onClick={() => void createSurvey(item)}
                >
                  用此模板创建问卷
                </Button>
                {!item.questions.length && (
                  <p className="mt-2 text-11 text-muted-foreground">
                    添加至少一道题目后即可创建问卷。
                  </p>
                )}
              </>
            )}
          </article>
        ))}
      </div>
      {!loading && !error && visible.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-6 py-14 text-center">
          <FileText
            className="mx-auto mb-4 h-8 w-8 text-muted-foreground"
            aria-hidden
          />
          <p className="text-16 font-medium">
            {items.length ? "没有匹配的模板" : `还没有${label}`}
          </p>
          <p className="mt-2 text-13 text-muted-foreground">
            {items.length
              ? "试试其他关键词。"
              : "新建一份模板，保存自己的常用配置。"}
          </p>
        </div>
      )}
    </main>
  );
}
