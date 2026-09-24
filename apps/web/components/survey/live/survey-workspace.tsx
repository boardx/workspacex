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
import type { SurveyPublishBlocker } from "@repo/contracts/survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  surveyRequest,
  SurveyPublishBlockedError,
  SurveySystemError,
} from "@/lib/survey/runtime-client";
import { FlexibleReportEditor } from "../report/template-editor";
import { SurveyReportDocument } from "../report/report-document";
import {
  exportSurveyReportWord,
  printSurveyReport,
} from "../report/report-export";
import { SurveyQuestionEditor } from "./question-editor";
import { SurveyTemplateActions } from "../library/template-actions";
import { LiveResponseList } from "./response-list";
import { assessPublishReadiness } from "@/lib/survey/publish-readiness";
const STEPS = [
  ["design", "设计问卷"],
  ["template", "报告模板"],
  ["publish", "发布回收"],
  ["responses", "查看答卷"],
  ["report", "分析报告"],
] as const;
const BLOCKER_MESSAGES: Record<SurveyPublishBlocker["code"], string> = {
  QUESTIONS_EMPTY: "问卷至少需要一道题",
  QUESTION_OPTIONS_EMPTY: "选项题必须包含有效选项",
  MAPPING_INCOMPLETE: "报告章节尚未覆盖对应题目",
  LEADING_QUESTION: "题目措辞可能带有诱导性",
};
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
  const [generatingReport, setGeneratingReport] = React.useState(false);
  const [error, setError] = React.useState("");
  const [retryable, setRetryable] = React.useState(false);
  const [blockers, setBlockers] = React.useState<SurveyPublishBlocker[]>([]);
  const [notice, setNotice] = React.useState("");
  const [step, setStep] = React.useState(initialStep);
  const [repairQuestionId, setRepairQuestionId] = React.useState<string | null>(null);
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
    void surveyRequest(`/surveys/${encodeURIComponent(surveyId)}`, {}, SurveyRuntimeSchema)
      .then((data) => {
        if (active) accept(data);
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
    setRetryable(false);
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (e instanceof SurveyPublishBlockedError) setBlockers(e.blockers);
      else {
        setError(e instanceof Error ? e.message : "操作失败，请重试");
        setRetryable(e instanceof SurveySystemError);
      }
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
    const next = await surveyRequest(runtime ? `/surveys/${runtime.id}` : "/surveys", {
        method: runtime ? "PUT" : "POST",
        body: {
          ...parsed.data,
          ...(runtime ? { expectedVersion: runtime.version } : {}),
        },
      }, SurveyRuntimeSchema);
    accept(next);
    setNotice("修改已保存");
    if (!runtime) router.replace(`/studio/survey/${next.id}?step=${step}`);
    return next;
  };
  const command = async (name: string, extra: Record<string, unknown> = {}) => {
    const current = dirty ? await save() : runtime;
    if (!current) throw new Error("请先保存问卷");
    const next = await surveyRequest(`/surveys/${current.id}/${name}`, {
        method: "POST",
        body: { expectedVersion: current.version, ...extra },
      }, SurveyRuntimeSchema);
    accept(next);
    setBlockers([]);
    setNotice("操作已完成");
  };
  const refresh = () =>
    execute(async () => {
      if (!runtime) return;
      if (dirty && !window.confirm("刷新将放弃未保存的修改，继续吗？")) return;
      accept(await surveyRequest(`/surveys/${runtime.id}`, {}, SurveyRuntimeSchema));
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
  const readiness = React.useMemo(
    () => assessPublishReadiness({ questions: draft?.questions ?? [], blockers }),
    [draft?.questions, blockers],
  );
  const selectStep = (next: string, targetQuestionId?: string) => {
    setStep(next);
    setRepairQuestionId(targetQuestionId ?? null);
    window.history.replaceState(null, "", `?step=${next}`);
  };
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
            onClick={() => selectStep(id)}
            className={`min-w-28 flex-1 border-b-2 px-4 py-4 text-12 ${step === id ? "border-primary bg-accent font-semibold" : "border-transparent"}`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </nav>
      {error && (
        <div
          role="alert"
          className="m-4 rounded-md border border-destructive/30 p-3 text-12 text-destructive"
        >
          <p>{error}</p>
          {retryable && step === "publish" && runtime?.status === "draft" && (
            <Button
              className="mt-3"
              variant="outline"
              onClick={() => void execute(() => command("prepare"))}
            >
              重试发布检查
            </Button>
          )}
        </div>
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
            {repairQuestionId && (
              <p
                data-testid="survey-mapping-repair-target"
                className="border-b border-warning/40 bg-warning/5 px-5 py-3 text-12"
              >
                待映射题目：{draft.questions.find((question) => question.id === repairQuestionId)?.title ?? repairQuestionId}。请在报告内容块中选择这道题。
              </p>
            )}
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
                先检查设计质量，再明确开始回收。开始回收后题目与匿名方式固定，报告模板仍可继续编辑。
              </p>
              {runtime?.status === "draft" ? (
                <>
                  <Button
                    onClick={() => void execute(() => command("prepare"))}
                  >
                    检查发布条件
                  </Button>
                  {blockers.length > 0 && (
                    <section aria-label="发布阻断项" className="rounded-md border border-warning/40 bg-warning/5 p-4">
                      <h2 className="text-14 font-semibold">发现 {blockers.length} 项发布阻断</h2>
                      <div data-testid="survey-publish-readiness" className="mt-3 grid gap-2 rounded-md border border-border bg-card p-3 text-12 sm:grid-cols-3">
                        <p><span className="text-muted-foreground">质量评分 </span>{readiness.qualityScore ?? "未知"}{readiness.qualityScore !== null && " / 100"}</p>
                        <p><span className="text-muted-foreground">预计填写时间 </span>{readiness.estimatedSeconds === null ? "未知" : `${Math.ceil(readiness.estimatedSeconds / 60)} 分钟`}</p>
                        <p><span className="text-muted-foreground">预计完成率 </span>{readiness.predictedCompletionRate === null ? "未知" : `${readiness.predictedCompletionRate}%`}</p>
                      </div>
                      <ul className="mt-3 space-y-2 text-12">
                        {readiness.recommendations.map((blocker) => (
                          <li key={`${blocker.code}:${blocker.side}:${blocker.subjectId}`}>
                            <strong>{BLOCKER_MESSAGES[blocker.code]}</strong>
                            <span className="ml-2 text-muted-foreground">{blocker.side} · {blocker.subjectId}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="ml-2"
                              aria-label={`定位并修复：${blocker.label}`}
                              onClick={() => {
                                const templateRepair = blocker.code === "MAPPING_INCOMPLETE" || blocker.side === "section";
                                selectStep(
                                  templateRepair ? "template" : "design",
                                  blocker.code === "MAPPING_INCOMPLETE" && blocker.side === "question"
                                    ? blocker.subjectId
                                    : undefined,
                                );
                              }}
                            >
                              定位并修复
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                </>
              ) : runtime?.status === "ready" ? (
                <section className="space-y-4 rounded-md border border-success/40 bg-success/5 p-4">
                  <div>
                    <h2 className="text-16 font-semibold">发布准备已完成</h2>
                    <p className="mt-1 text-12 text-muted-foreground">服务端已确认当前版本满足发布条件。你仍可返回编辑，或设置截止时间后开始回收。</p>
                  </div>
                  <label className="block text-12">
                    截止时间（默认 30 天）
                    <Input
                      aria-label="截止时间"
                      type="datetime-local"
                      value={expires}
                      onChange={(e) => setExpires(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void execute(() => command("withdraw"))}>
                      返回编辑
                    </Button>
                    <Button
                      onClick={() => void execute(() => command("start-collection", expires ? { expiresAt: new Date(expires).toISOString() } : {}))}
                    >
                      开始回收
                    </Button>
                  </div>
                </section>
              ) : runtime?.publication ? (
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
              ) : (
                <p className="text-12 text-muted-foreground">正在同步发布状态，请刷新后重试。</p>
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
                <Button variant="primary" aria-busy={generatingReport} onClick={() => void execute(async () => {
                  setGeneratingReport(true);
                  try {
                    await command("report");
                    setNotice("报告已按最新答卷和报告模板重新生成");
                  } finally { setGeneratingReport(false); }
                })}>
                  {generatingReport ? "正在生成报告…" : runtime?.report ? "重新生成报告" : "生成报告"}
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
              {runtime?.reportGeneratedAt && (
                <p className="text-12 text-muted-foreground" data-testid="survey-report-generated-at">
                  生成时间：{new Date(runtime.reportGeneratedAt).toLocaleString("zh-CN")}
                </p>
              )}
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
