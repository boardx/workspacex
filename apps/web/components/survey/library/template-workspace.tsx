"use client";

import * as React from "react";
import { useSurveyUnsavedNavigation } from "@/lib/survey/use-unsaved-navigation";
import { useRouter } from "next/navigation";
import {
  SurveyLibraryTemplateSchema,
  SurveyTemplateInputSchema,
  type SurveyLibraryTemplate,
  type SurveyTemplateInput,
} from "@repo/contracts/survey-template-library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { getBuiltinSurveyTemplate } from "@/lib/survey/builtin-templates";
import { SurveyQuestionEditor } from "../live/question-editor";
import { FlexibleReportEditor } from "../report/template-editor";

type Kind = SurveyTemplateInput["kind"];
const newDraft = (kind: Kind): SurveyTemplateInput => ({
  kind,
  title: kind === "question" ? "未命名问卷模板" : "未命名报告模板",
  description: "",
  questions: [],
  template: { id: crypto.randomUUID(), title: "问卷分析报告", sections: [] },
});
const readTemplate = (value: unknown, kind: Kind): SurveyLibraryTemplate => {
  const result = SurveyLibraryTemplateSchema.safeParse(value);
  if (!result.success) throw new Error("模板数据格式不正确，请刷新后重试。");
  if (result.data.kind !== kind)
    throw new Error("模板类型不匹配，请返回模板列表选择。");
  return result.data;
};

// Response metadata is not part of the bounded write request.
const templateDraft = ({
  kind,
  title,
  description,
  questions,
  template,
}: SurveyTemplateInput): SurveyTemplateInput => ({
  kind,
  title,
  description,
  questions,
  template,
});

export function SurveyTemplateWorkspace({
  templateId,
  kind,
}: {
  templateId: string;
  kind: Kind;
}) {
  const router = useRouter();
  const [saved, setSaved] = React.useState<SurveyLibraryTemplate | null>(null);
  const [draft, setDraft] = React.useState<SurveyTemplateInput | null>(null);
  const [builtinBaseline, setBuiltinBaseline] =
    React.useState<SurveyTemplateInput | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [tab, setTab] = React.useState<"questions" | "report">(
    kind === "question" ? "questions" : "report",
  );
  const generation = React.useRef(0);
  const invalidate = React.useCallback(() => {
    generation.current++;
  }, []);
  const lock = React.useRef(false);
  const label = kind === "question" ? "问卷模板" : "报告模板";
  const base =
    kind === "question"
      ? "/studio/survey/question-templates"
      : "/studio/survey/templates";
  const list = `/studio/survey?tab=${kind === "question" ? "modules" : "reports"}`;
  const isBuiltin = templateId.startsWith("builtin-") && !saved;
  const baseline = saved ? templateDraft(saved) : builtinBaseline;
  const dirty =
    !!draft &&
    (!baseline || JSON.stringify(draft) !== JSON.stringify(baseline));
  const accept = React.useCallback((value: SurveyLibraryTemplate) => {
    setSaved(value);
    setBuiltinBaseline(null);
    setDraft(templateDraft(value));
  }, []);
  const load = React.useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setNotice("");
    if (templateId === "new") {
      setSaved(null);
      setDraft(newDraft(kind));
      setLoading(false);
      return;
    }
    try {
      if (templateId.startsWith("builtin-")) {
        const builtin = getBuiltinSurveyTemplate(templateId, kind);
        if (!builtin)
          throw new Error("内置模板不存在或类型不匹配，请返回模板列表选择。");
        const configuration = templateDraft(builtin);
        setSaved(null);
        setDraft(configuration);
        setBuiltinBaseline(structuredClone(configuration));
        return;
      }
      const value = readTemplate(
        await surveyRequest(
          `/surveys/templates/${encodeURIComponent(templateId)}`,
        ),
        kind,
      );
      if (current === generation.current) accept(value);
    } catch (e) {
      if (current === generation.current)
        setError(e instanceof Error ? e.message : "模板加载失败，请重试。");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [templateId, kind, accept]);
  React.useEffect(() => {
    setSaved(null);
    setDraft(null);
    setBuiltinBaseline(null);
    setTab(kind === "question" ? "questions" : "report");
    void load();
    return invalidate;
  }, [kind, load, invalidate]);
  useSurveyUnsavedNavigation(dirty);
  const save = async (asCopy = false) => {
    if (lock.current || !draft) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const current = generation.current;
    try {
      const parsed = SurveyTemplateInputSchema.safeParse({
        ...draft,
        ...(asCopy ? { title: `${draft.title.slice(0, 197)} 副本` } : {}),
      });
      if (!parsed.success)
        throw new Error(
          parsed.error.issues.find(
            (issue) => issue.code === "custom" && issue.path.length === 0,
          )?.message ?? "请检查模板名称、说明、题目选项和报告配置后重试。",
        );
      const create = asCopy || !saved;
      const result = readTemplate(
        await surveyRequest(
          create
            ? "/surveys/templates"
            : `/surveys/templates/${encodeURIComponent(saved.id)}`,
          {
            method: create ? "POST" : "PUT",
            body: {
              ...parsed.data,
              ...(!create ? { expectedVersion: saved.version } : {}),
            },
          },
        ),
        kind,
      );
      if (current !== generation.current) return;
      accept(result);
      setNotice(asCopy ? "副本已保存，原模板保持不变。" : "模板已保存");
      if (create) router.replace(`${base}/${encodeURIComponent(result.id)}`);
    } catch (e) {
      if (current === generation.current)
        setError(
          e instanceof Error ? e.message : "保存失败，修改仍保留，请重试。",
        );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const back = () => {
    if (!dirty || window.confirm("离开将放弃未保存的模板修改，继续吗？"))
      router.push(list);
  };
  const refresh = () => {
    if (
      !dirty ||
      window.confirm(
        "刷新会替换当前未保存的修改，继续吗？可先另存副本以保留修改。",
      )
    )
      void load();
  };
  return (
    <main className="min-w-0 bg-background text-background-foreground">
      <header className="space-y-4 border-b border-border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" disabled={busy} onClick={back}>
            返回模板列表
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="text-20 font-semibold">
              {isBuiltin ? "内置" : templateId === "new" ? "新建" : "编辑"}
              {label}
            </h1>
            <p className="mt-1 text-11 text-muted-foreground">
              {dirty
                ? "有未保存修改"
                : saved
                  ? `已保存 · ${new Date(saved.updatedAt).toLocaleString("zh-CN")}`
                  : builtinBaseline
                    ? "内置模板 · 未修改"
                    : "正在加载"}
            </p>
          </div>
          {saved && (
            <>
              <Button
                variant="outline"
                disabled={busy || loading}
                onClick={refresh}
              >
                刷新
              </Button>
              <Button
                variant="outline"
                disabled={busy || loading || !draft}
                onClick={() => void save(true)}
              >
                另存副本
              </Button>
            </>
          )}
          <Button
            disabled={busy || loading || !draft || (!dirty && !isBuiltin)}
            onClick={() => void save()}
          >
            {busy ? "正在保存…" : isBuiltin ? "保存为我的模板" : "保存模板"}
          </Button>
        </div>
        {isBuiltin && draft && (
          <p className="text-12 text-muted-foreground">
            内置模板不会被更改。可直接使用，或调整后保存为自己的独立模板。
          </p>
        )}
        {draft && (
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-12">
              <span>模板名称</span>
              <Input
                aria-label="模板名称"
                maxLength={200}
                disabled={busy || loading}
                value={draft.title}
                onChange={(event) =>
                  setDraft({ ...draft, title: event.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-12">
              <span>模板说明</span>
              <Textarea
                aria-label="模板说明"
                className="min-h-10"
                rows={1}
                maxLength={2000}
                disabled={busy || loading}
                value={draft.description}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value })
                }
              />
            </label>
          </div>
        )}
      </header>
      {error && (
        <div className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-4">
          <p role="alert" className="text-13 text-destructive">
            {error}
          </p>
          {!draft && (
            <Button
              variant="outline"
              disabled={busy || loading}
              onClick={() => void load()}
            >
              重试
            </Button>
          )}
          {draft && (
            <p className="text-12 text-muted-foreground">
              当前编辑仍保留。
              {saved ? "可重试保存，或另存副本。" : "请检查后重试保存。"}
            </p>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="px-6 py-3 text-13 text-muted-foreground">
          {notice}
        </p>
      )}
      {loading && (
        <p role="status" className="p-8 text-13 text-muted-foreground">
          正在加载模板…
        </p>
      )}
      {draft && (
        <>
          <div className="border-b border-border px-4 pt-4 sm:px-6">
            <div role="tablist" aria-label="模板配置" className="flex gap-2">
              {(
                [
                  ["questions", "题目配置"],
                  ["report", "报告配置"],
                ] as const
              ).map(([id, name]) => (
                <button
                  type="button"
                  role="tab"
                  key={id}
                  id={`template-tab-${id}`}
                  aria-controls={`template-panel-${id}`}
                  aria-selected={tab === id}
                  disabled={busy || loading}
                  onClick={() => setTab(id)}
                  className={`rounded-t-md border-b-2 px-4 py-3 text-13 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === id ? "border-primary bg-accent font-semibold" : "border-transparent text-muted-foreground hover:bg-muted"}`}
                >
                  {name}
                </button>
              ))}
            </div>
            <p className="py-3 text-12 text-muted-foreground">
              {tab === "questions"
                ? kind === "report"
                  ? "参考题目用于配置报告的数据绑定；应用到问卷时再选择对应题目。"
                  : "题目与配套报告会一同保存；使用模板创建问卷时不会复制答卷或发布状态。"
                : "自由组织章节与内容块。预览仅用于检查布局，数据将在实际问卷回收后计算。"}
            </p>
          </div>
          <fieldset
            disabled={busy || loading}
            role="tabpanel"
            id={`template-panel-${tab}`}
            aria-labelledby={`template-tab-${tab}`}
            className="min-w-0"
          >
            {tab === "questions" ? (
              <SurveyQuestionEditor
                questions={draft.questions}
                onChange={(questions) => setDraft({ ...draft, questions })}
                overviewFirst={kind === "question"}
              />
            ) : (
              <FlexibleReportEditor
                template={draft.template}
                onChange={(template) => setDraft({ ...draft, template })}
                questions={draft.questions}
                responses={[]}
              />
            )}
          </fieldset>
        </>
      )}
    </main>
  );
}
