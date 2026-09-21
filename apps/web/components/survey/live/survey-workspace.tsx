"use client";
import * as React from "react";
import { useSurveyUnsavedNavigation } from "@/lib/survey/use-unsaved-navigation";
import { useRouter } from "next/navigation";
import { survey } from "@repo/contracts";
import {
  SurveyRuntimeSchema,
  SurveyDraftInputSchema,
  type SurveyRuntime,
  type SurveyDraftInput,
} from "@repo/contracts/survey-runtime";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { FlexibleReportEditor } from "../report/template-editor";
import { SurveyReportDocument } from "../report/report-document";
import {
  exportSurveyReportWord,
  printSurveyReport,
} from "../report/report-export";
import { SurveyQuestionEditor } from "./question-editor";
import { SurveyTemplateActions } from "../library/template-actions";
import { LiveResponseList } from "./response-list";
const STEPS = [
  ["design", "设计问卷"],
  ["template", "报告模板"],
  ["publish", "发布回收"],
  ["responses", "查看答卷"],
  ["report", "分析报告"],
] as const;
function emptyDraft(): SurveyDraftInput {
  return {
    title: "未命名问卷",
    questions: [],
    template: { id: crypto.randomUUID(), title: "问卷分析报告", sections: [] },
  };
}
export function LiveSurveyWorkspace({
  surveyId,
  initialStep = "design",
}: {
  surveyId: string;
  initialStep?: string;
}) {
  const router = useRouter();
  const [runtime, setRuntime] = React.useState<SurveyRuntime | null>(null);
  const [draft, setDraft] = React.useState<SurveyDraftInput | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [step, setStep] = React.useState(initialStep);
  const [expires, setExpires] = React.useState("");
  const reportRef = React.useRef<HTMLDivElement>(null);
  const lock = React.useRef(false);
  const accept = React.useCallback((value: SurveyRuntime) => {
    setRuntime(value);
    setDraft({
      title: value.title,
      questions: value.questions,
      template: value.template,
    });
  }, []);
  React.useEffect(() => {
    setStep(initialStep);
  }, [initialStep]);
  React.useEffect(() => {
    let active = true;
    setError("");
    setRuntime(null);
    setDraft(null);
    if (surveyId === "new") {
      setDraft(emptyDraft());
      return;
    }
    void surveyRequest<unknown>(`/surveys/${encodeURIComponent(surveyId)}`)
      .then((data) => {
        if (active) accept(SurveyRuntimeSchema.parse(data));
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [surveyId, accept]);
  const dirty =
    !!draft &&
    (!runtime ||
      JSON.stringify(draft) !==
        JSON.stringify({
          title: runtime.title,
          questions: runtime.questions,
          template: runtime.template,
        }));
  useSurveyUnsavedNavigation(dirty);
  const execute = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    if (!draft) throw new Error("尚未加载问卷");
    const parsed = SurveyDraftInputSchema.safeParse(draft);
    if (!parsed.success)
      throw new Error("请填写问卷、章节及内容标题，并检查选项和图片地址。");
    const next = SurveyRuntimeSchema.parse(
      await surveyRequest(runtime ? `/surveys/${runtime.id}` : "/surveys", {
        method: runtime ? "PUT" : "POST",
        body: {
          ...parsed.data,
          ...(runtime ? { expectedVersion: runtime.version } : {}),
        },
      }),
    );
    accept(next);
    setNotice("修改已保存");
    if (!runtime) router.replace(`/studio/survey/${next.id}?step=${step}`);
    return next;
  };
  const command = async (name: string, extra: Record<string, unknown> = {}) => {
    const current = dirty ? await save() : runtime;
    if (!current) throw new Error("请先保存问卷");
    const next = SurveyRuntimeSchema.parse(
      await surveyRequest(`/surveys/${current.id}/${name}`, {
        method: "POST",
        body: { expectedVersion: current.version, ...extra },
      }),
    );
    accept(next);
    setNotice("操作已完成");
  };
  const refresh = () =>
    execute(async () => {
      if (!runtime) return;
      if (dirty && !window.confirm("刷新将放弃未保存的修改，继续吗？")) return;
      accept(
        SurveyRuntimeSchema.parse(
          await surveyRequest(`/surveys/${runtime.id}`),
        ),
      );
    });
  const link =
    runtime?.publication && typeof window !== "undefined"
      ? `${window.location.origin}/surveys/${encodeURIComponent(runtime.publication.token)}`
      : "";
  const compiled = React.useMemo(() => {
    if (!draft) return null;
    const valid = survey.SurveyReportTemplateSchema.safeParse(draft.template);
    return valid.success
      ? survey.compileSurveyReport(
          valid.data,
          draft.questions,
          runtime?.responses ?? [],
        )
      : null;
  }, [draft, runtime?.responses]);
  return (
    <main className="min-w-0 bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card p-4">
        <Button
          variant="ghost"
          onClick={() => {
            if (!dirty || window.confirm("离开将放弃未保存修改，继续吗？"))
              router.push("/studio/survey");
          }}
        >
          ← 返回列表
        </Button>
        <div className="min-w-48 flex-1">
          <Input
            aria-label="问卷名称"
            disabled={busy || !draft}
            value={draft?.title ?? ""}
            onChange={(e) =>
              draft && setDraft({ ...draft, title: e.target.value })
            }
          />
          <p className="mt-1 text-10 text-muted-foreground">
            {dirty
              ? "有未保存修改"
              : runtime
                ? `已保存 · ${new Date(runtime.updatedAt).toLocaleString("zh-CN")}`
                : "正在加载"}
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy || !runtime}
          onClick={() => void refresh()}
        >
          刷新
        </Button>
        <Button
          disabled={busy || !draft || !dirty}
          onClick={() =>
            void execute(async () => {
              await save();
            })
          }
        >
          {busy ? "处理中…" : "保存修改"}
        </Button>
      </header>
      <nav
        aria-label="问卷工作流"
        className="flex overflow-auto border-b border-border bg-card"
      >
        {STEPS.map(([id, label], i) => (
          <button
            type="button"
            key={id}
            onClick={() => {
              setStep(id);
              window.history.replaceState(null, "", `?step=${id}`);
            }}
            className={`min-w-28 flex-1 border-b-2 px-4 py-4 text-12 ${step === id ? "border-primary bg-accent font-semibold" : "border-transparent"}`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>
      {error && (
        <p
          role="alert"
          className="m-4 rounded-md border border-destructive/30 p-3 text-12 text-destructive"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="px-5 pt-3 text-12 text-success">
          {notice}
        </p>
      )}
      {!draft && !error && <p className="p-8">正在加载问卷…</p>}
      {draft && (
        <fieldset disabled={busy} className="min-w-0">
          {step === "design" && (<>
            <SurveyTemplateActions kind="question" draft={draft} onApply={setDraft} locked={!!runtime?.publication} disabled={busy} />
            <SurveyQuestionEditor
              questions={draft.questions}
              locked={!!runtime?.publication}
              onChange={(questions) => setDraft({ ...draft, questions })}
            />
          </>)}
          {step === "template" && (<>
            <SurveyTemplateActions kind="report" draft={draft} onApply={setDraft} disabled={busy} />
            <FlexibleReportEditor
              template={draft.template}
              onChange={(template) => setDraft({ ...draft, template })}
              questions={draft.questions}
              responses={runtime?.responses ?? []}
            />
          </>)}
          {step === "publish" && (
            <section className="mx-auto max-w-3xl space-y-5 p-6">
              <h1 className="text-20 font-semibold">发布与回收</h1>
              <p className="text-12 text-muted-foreground">
                发布后题目固定。受访者通过链接匿名答题，报告模板可继续编辑。
              </p>
              {!runtime?.publication ? (
                <>
                  <label className="block text-12">
                    截止时间（默认 30 天）
                    <Input
                      aria-label="截止时间"
                      type="datetime-local"
                      value={expires}
                      onChange={(e) => setExpires(e.target.value)}
                    />
                  </label>
                  <Button
                    disabled={!draft.questions.length}
                    onClick={() =>
                      void execute(() =>
                        command(
                          "publish",
                          expires
                            ? { expiresAt: new Date(expires).toISOString() }
                            : {},
                        ),
                      )
                    }
                  >
                    发布问卷
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-14">
                    {runtime.publication.status === "closed"
                      ? "已停止回收"
                      : new Date(runtime.publication.expiresAt).getTime() <
                          Date.now()
                        ? "已到截止时间"
                        : "正在回收"}{" "}
                    · {runtime.responses.length} 份答卷
                  </p>
                  <p className="text-12 text-muted-foreground">
                    截止{" "}
                    {new Date(runtime.publication.expiresAt).toLocaleString(
                      "zh-CN",
                    )}
                  </p>
                  <Input aria-label="答题链接" readOnly value={link} />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        void execute(async () => {
                          await navigator.clipboard.writeText(link);
                          setNotice("链接已复制");
                        })
                      }
                    >
                      复制答题链接
                    </Button>
                    <a
                      className="rounded-md border border-border px-4 py-2 text-12"
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开答题页
                    </a>
                    {runtime.publication.status === "collecting" && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (
                            window.confirm(
                              "停止回收后将不再接受新答卷，继续吗？",
                            )
                          )
                            void execute(() => command("close"));
                        }}
                      >
                        停止回收
                      </Button>
                    )}
                  </div>
                </>
              )}
            </section>
          )}
          {step === "responses" && (
            <LiveResponseList
              surveyId={runtime?.id}
              responses={runtime?.responses ?? []}
              questions={runtime?.publication?.questions ?? draft.questions}
              busy={busy}
              onReview={(id, quality) =>
                void execute(async () => {
                  const current = dirty ? await save() : runtime;
                  if (!current) return;
                  accept(
                    SurveyRuntimeSchema.parse(
                      await surveyRequest(
                        `/surveys/${current.id}/responses/${id}`,
                        {
                          method: "PATCH",
                          body: { expectedVersion: current.version, quality },
                        },
                      ),
                    ),
                  );
                })
              }
            />
          )}
          {step === "report" && (
            <section className="mx-auto max-w-5xl space-y-5 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="w-full text-20 font-semibold sm:w-auto sm:flex-1">
                  分析报告
                </h1>
                <Button onClick={() => void execute(() => command("report"))}>
                  {runtime?.report ? "重新生成报告" : "生成报告"}
                </Button>
                {runtime?.report && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void execute(async () => {
                          await exportSurveyReportWord(runtime.report!);
                        })
                      }
                    >
                      导出 Word
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void execute(async () => {
                          if (reportRef.current)
                            await printSurveyReport(reportRef.current);
                        })
                      }
                    >
                      导出 PDF
                    </Button>
                  </>
                )}
              </div>
              {!runtime?.report && (
                <p className="rounded-md bg-muted p-4 text-12">
                  先设计报告模板并回收答卷，再按模板生成报告。
                </p>
              )}
              {compiled?.issues.length ? (
                <div className="rounded-md border border-warning/30 p-4 text-12">
                  <p className="font-medium">生成前需要检查</p>
                  <ul className="mt-2 list-inside list-disc">
                    {[...new Set(compiled.issues)].map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {runtime?.report &&
                (dirty ||
                  runtime.reportBasisVersion !== runtime.version - 1 ||
                  runtime.reportBasisAnswerRevision !== runtime.answerRevision) && (
                  <p className="text-12 text-muted-foreground">
                    模板或答卷已有更新，当前展示上次生成的报告。重新生成后更新内容。
                  </p>
                )}
              {runtime?.report && (
                <div ref={reportRef}>
                  <SurveyReportDocument report={runtime.report} />
                </div>
              )}
            </section>
          )}
        </fieldset>
      )}
    </main>
  );
}
