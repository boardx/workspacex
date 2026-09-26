"use client";
import * as React from "react";
import Link from "next/link";
import {
  SurveyLibraryTemplateSchema,
  SurveyTemplateInputSchema,
  type SurveyLibraryTemplate,
} from "@repo/contracts/survey-template-library";
import type { SurveyDraftInput } from "@repo/contracts/survey-runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { surveyRequest } from "@/lib/survey/runtime-client";
import {
  getBuiltinSurveyTemplates,
  type BuiltinSurveyTemplate,
} from "@/lib/survey/builtin-templates";
import {
  remapReportTemplate,
  requiredTemplateQuestions,
} from "@/lib/survey/template-reuse";

type Props = {
  kind: "question" | "report";
  draft: SurveyDraftInput;
  onApply: (draft: SurveyDraftInput) => void;
  locked?: boolean;
  disabled?: boolean;
};
const selectStyle =
  "w-full rounded-md border border-border bg-background p-2 text-12";
export function SurveyTemplateActions({
  kind,
  draft,
  onApply,
  locked = false,
  disabled = false,
}: Props) {
  const label = kind === "question" ? "问卷模板" : "报告模板";
  const [mode, setMode] = React.useState<"save" | "use" | null>(null);
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState("");
  const [loadError, setLoadError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const saveLock = React.useRef(false);
  const [loading, setLoading] = React.useState(false);
  const [rows, setRows] = React.useState<SurveyLibraryTemplate[]>([]);
  const [selected, setSelected] = React.useState("");
  const [bindings, setBindings] = React.useState<Record<string, string>>({});
  const [attempt, setAttempt] = React.useState(0);
  const builtins = React.useMemo(() => getBuiltinSurveyTemplates(kind), [kind]);
  const choices: (SurveyLibraryTemplate | BuiltinSurveyTemplate)[] = [
    ...builtins,
    ...rows,
  ];
  const source = choices.find((row) => row.id === selected);
  const refs =
    source && kind === "report"
      ? requiredTemplateQuestions(source.template)
      : [];
  React.useEffect(() => {
    if (mode !== "use") return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setRows([]);
    void surveyRequest<unknown>(`/surveys/templates?kind=${kind}`)
      .then((data) => {
        const parsed = SurveyLibraryTemplateSchema.array().safeParse(data);
        if (!parsed.success || parsed.data.some((row) => row.kind !== kind))
          throw new Error("模板数据格式不正确，请重试加载。");
        if (active) setRows(parsed.data);
      })
      .catch((e) => {
        if (active) setLoadError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, kind, attempt]);
  const open = (next: "save" | "use") => {
    setName(kind === "question" ? draft.title : draft.template.title);
    setError("");
    setNotice("");
    setLoadError("");
    setSelected("");
    setBindings({});
    setMode(next);
  };
  const save = async () => {
    if (saveLock.current || disabled) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    try {
      const input = SurveyTemplateInputSchema.safeParse({
        kind,
        title: name,
        description: "",
        questions: draft.questions,
        template: draft.template,
      });
      if (!input.success)
        throw new Error(
          input.error.issues.find(
            (issue) => issue.code === "custom" && issue.path.length === 0,
          )?.message ?? "请填写模板名称，并先完善题目和内容块配置。",
        );
      const saved = SurveyLibraryTemplateSchema.safeParse(
        await surveyRequest("/surveys/templates", {
          method: "POST",
          body: input.data,
        }),
      );
      if (!saved.success || saved.data.kind !== kind)
        throw new Error("模板保存结果无法确认，请前往模板库核对后重试。");
      setNotice(`已保存到${label}库`);
      setMode(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  };
  const apply = () => {
    if (!source || busy || locked || disabled) return;
    setError("");
    try {
      const next =
        kind === "question"
          ? {
              ...draft,
              questions: structuredClone(source.questions).map((question) => ({
                ...question,
                provenance: { source: "template" as const, sourceId: source.id },
              })),
              template: structuredClone(source.template),
            }
          : {
              ...draft,
              template: remapReportTemplate(source, draft.questions, bindings),
            };
      if (kind === "question" && !next.questions.length)
        throw new Error("此模板还没有题目，请先在模板库完善。");
      if (
        !window.confirm(
          kind === "question"
            ? "将替换当前题目及配套报告模板，未保存修改会被替换。继续吗？"
            : "将替换当前报告模板，保留问卷题目和已有答卷。继续吗？",
        )
      )
        return;
      onApply(next);
      setMode(null);
      setNotice("模板已应用，请保存问卷修改。");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section
      className="border-b border-border bg-card px-5 py-3"
      aria-label={`${label}操作`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={disabled || locked}
          onClick={() => open("use")}
        >
          使用{label}
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => open("save")}
        >
          保存为{label}
        </Button>
        <Link
          className="px-2 text-12 text-muted-foreground underline"
          href={`/studio/survey?tab=${kind === "question" ? "modules" : "reports"}`}
        >
          管理模板库
        </Link>
        {locked && (
          <span className="text-12 text-muted-foreground">
            已发布题目不可替换，仍可保存为模板。
          </span>
        )}
      </div>
      {notice && (
        <p role="status" className="mt-2 text-12 text-success">
          {notice}
        </p>
      )}
      <Dialog
        open={mode !== null}
        onOpenChange={(value) => {
          if (!value && !busy) setMode(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {mode === "save" ? "保存为" : "使用"}
              {label}
            </DialogTitle>
            <DialogDescription>
              {mode === "save"
                ? "只保存题目和报告配置，不包含答卷或发布信息。"
                : "应用后保存为当前问卷的独立副本，不改变原模板。"}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-12 text-destructive">
              {error}
            </p>
          )}
          {mode === "use" && loadError && (
            <p role="alert" className="text-12 text-destructive">
              {loadError}
            </p>
          )}
          {mode === "save" ? (
            <>
              <label className="space-y-2 text-12">
                模板名称
                <Input
                  aria-label="保存模板名称"
                  value={name}
                  maxLength={200}
                  disabled={busy || disabled}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <Button
                disabled={busy || disabled || !name.trim()}
                onClick={() => void save()}
              >
                {busy ? "正在保存…" : "保存到模板库"}
              </Button>
            </>
          ) : (
            <>
              {loading && <p role="status">正在加载我的模板…</p>}
              {loadError && (
                <Button
                  variant="outline"
                  disabled={loading}
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  重试加载
                </Button>
              )}
              {!loading && !loadError && !rows.length && (
                <p className="text-12 text-muted-foreground">
                  还没有个人{label}，可选择内置模板，或先保存自己的配置。
                </p>
              )}
              {choices.length > 0 && (
                <label className="space-y-2 text-12">
                  选择{label}
                  <select
                    aria-label={`选择${label}`}
                    className={selectStyle}
                    value={selected}
                    disabled={busy || disabled}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setBindings({});
                      setError("");
                    }}
                  >
                    <option value="">请选择模板</option>
                    <optgroup label="内置模板">
                      {builtins.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.title}
                        </option>
                      ))}
                    </optgroup>
                    {rows.length > 0 && (
                      <optgroup label="我的模板">
                        {rows.map((row) => (
                          <option key={row.id} value={row.id}>
                            {row.title}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </label>
              )}
              {source && (
                <p className="text-12 text-muted-foreground">
                  {source.questions.length} 道题目 ·{" "}
                  {source.template.sections.length} 个报告章节
                  {source.id.startsWith("builtin-")
                    ? " · 内置配置，应用后独立编辑"
                    : ""}
                </p>
              )}
              {refs.length > 0 && (
                <fieldset className="space-y-3" disabled={busy || disabled}>
                  <legend className="mb-3 text-14 font-medium">
                    将模板题目对应到当前问卷
                  </legend>
                  {refs.map((id) => {
                    const question = source!.questions.find((q) => q.id === id);
                    return (
                      <label key={id} className="block space-y-1 text-12">
                        {question?.title ?? "模板题目引用已失效"}
                        <select
                          aria-label={`对应题目：${question?.title ?? id}`}
                          className={selectStyle}
                          value={bindings[id] ?? ""}
                          onChange={(event) =>
                            setBindings({
                              ...bindings,
                              [id]: event.target.value,
                            })
                          }
                        >
                          <option value="">请选择当前问卷题目</option>
                          {draft.questions
                            .filter((q) => q.type === question?.type)
                            .map((q) => (
                              <option key={q.id} value={q.id}>
                                {q.order}. {q.title}
                              </option>
                            ))}
                        </select>
                      </label>
                    );
                  })}
                </fieldset>
              )}
              <Button
                disabled={
                  !source ||
                  busy ||
                  disabled ||
                  locked ||
                  refs.some((id) => !bindings[id])
                }
                onClick={apply}
              >
                应用模板
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
