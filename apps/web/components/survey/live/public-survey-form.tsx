"use client";
import * as React from "react";
import type { survey } from "@repo/contracts";
import {
  validateSurveyAnswer,
  visibleSurveyQuestions,
  type SurveyAnswerValue,
} from "@repo/contracts/survey-question-types";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { apiUrl } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { SurveyQuestionRenderer } from "./question-renderer";
import type { SurveyUpload, SurveyRemoveUpload } from "./question-material";
type Published = {
  id: string;
  title: string;
  questions: survey.SurveyWorkflowQuestion[];
  version: number;
  expiresAt: string;
};
export function PublicSurveyForm({ token }: { token: string }) {
  const [data, setData] = React.useState<Published | null>(null);
  const [answers, setAnswers] = React.useState<
    Record<string, SurveyAnswerValue>
  >({});
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [uploading, setUploading] = React.useState(0);
  const [done, setDone] = React.useState(false);
  const [page, setPage] = React.useState(0);
  const [submissionId] = React.useState(() => crypto.randomUUID());
  const uploadSession = React.useRef<Promise<string>>();
  const uploadToken = React.useRef<string>();
  const started = React.useRef(Date.now());
  const locked = React.useRef(false);
  React.useEffect(() => {
    let active = true;
    void surveyRequest<Published>(
      `/public/surveys/${encodeURIComponent(token)}`,
      { sessionToken: null },
    )
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [token]);
  const visible = visibleSurveyQuestions(data?.questions ?? [], answers);
  const pages: survey.SurveyWorkflowQuestion[][] = [[]];
  for (const question of visible) {
    if (question.type === "page_break") {
      if (pages[pages.length - 1]!.length) pages.push([]);
    } else pages[pages.length - 1]!.push(question);
  }
  const currentPage = Math.min(page, pages.length - 1);
  async function getUploadToken() {
    if (!uploadSession.current)
      uploadSession.current = surveyRequest<{ uploadSessionToken: string }>(
        `/public/surveys/${encodeURIComponent(token)}/upload-sessions`,
        { method: "POST", sessionToken: null, body: { submissionId } },
      )
        .then((result) => {
          uploadToken.current = result.uploadSessionToken;
          return result.uploadSessionToken;
        })
        .catch((err) => {
          uploadSession.current = undefined;
          throw err;
        });
    return uploadSession.current;
  }
  const upload: SurveyUpload = async (file, questionId) => {
    setUploading((n) => n + 1);
    try {
      const session = await getUploadToken();
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(
        apiUrl(
          `/public/surveys/${encodeURIComponent(token)}/upload-sessions/${encodeURIComponent(session)}/questions/${encodeURIComponent(questionId)}/attachments`,
        ),
        { method: "POST", body },
      );
      if (!response.ok) throw new Error("上传失败");
      const result = (await response.json()) as {
        attachmentId: string;
        name: string;
      };
      return { id: result.attachmentId, name: result.name };
    } finally {
      setUploading((n) => n - 1);
    }
  };
  const removeUpload: SurveyRemoveUpload = async (id, questionId) => {
    const session = await getUploadToken();
    await surveyRequest(
      `/public/surveys/${encodeURIComponent(token)}/upload-sessions/${encodeURIComponent(session)}/questions/${encodeURIComponent(questionId)}/attachments/${encodeURIComponent(id)}`,
      { method: "DELETE", sessionToken: null },
    );
  };
  function validate(questions: survey.SurveyWorkflowQuestion[]) {
    const next: Record<string, string[]> = Object.fromEntries(
      questions
        .filter((q) => q.type !== "description" && q.type !== "page_break")
        .map((q) => [q.id, validateSurveyAnswer(q, answers[q.id])])
        .filter(([, messages]) => (messages as string[]).length),
    );
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      setError("请检查标记的必答题或格式错误，已填写的内容会保留。");
      const targetPage = pages.findIndex((items) =>
        items.some((q) => q.id === first),
      );
      if (targetPage >= 0) setPage(targetPage);
      requestAnimationFrame(() => {
        const question = questions.find((item) => item.id === first);
        const row = question?.config?.rows?.find((item) =>
          next[first]?.some((message) => message.includes(item.label)),
        );
        const element = document.getElementById(
          row ? `answer-${first}-${row.id}` : `answer-${first}`,
        );
        element?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        element?.focus();
      });
      return false;
    }
    setError("");
    return true;
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || uploading || !data || !validate(visible)) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const ids = new Set(
        visible
          .filter((q) => q.type !== "description" && q.type !== "page_break")
          .map((q) => q.id),
      );
      await surveyRequest(
        `/public/surveys/${encodeURIComponent(token)}/responses`,
        {
          method: "POST",
          sessionToken: null,
          body: {
            submissionId,
            ...(uploadToken.current
              ? { uploadSessionToken: uploadToken.current }
              : {}),
            answers: Object.entries(answers)
              .filter(([id]) => ids.has(id))
              .map(([questionId, value]) => ({ questionId, value })),
            durationSeconds: Math.floor((Date.now() - started.current) / 1000),
          },
        },
      );
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="min-h-screen bg-muted px-4 py-10">
      <div className="mx-auto max-w-2xl rounded-xl border border-border bg-card p-6 sm:p-10">
        <h1 className="text-24 font-semibold">{data?.title ?? "问卷"}</h1>
        {error && (
          <p role="alert" className="mt-4 text-12 text-destructive">
            {error}
          </p>
        )}
        {done ? (
          <p role="status" className="py-12 text-center text-16">
            提交成功，感谢您的参与。
          </p>
        ) : data ? (
          <form noValidate onSubmit={(event) => void submit(event)}>
            <p className="mb-8 mt-3 text-12 text-muted-foreground">
              匿名填写 ·{" "}
              {
                visible.filter(
                  (q) => q.type !== "description" && q.type !== "page_break",
                ).length
              }{" "}
              道题 · 标记 * 的题目为必答
            </p>
            {pages.length > 1 && (
              <p className="mb-4 text-12" aria-live="polite">
                第 {currentPage + 1} / {pages.length} 页
              </p>
            )}
            <fieldset disabled={busy} className="space-y-8">
              {(pages[currentPage] ?? []).map((question) => (
                <SurveyQuestionRenderer
                  key={question.id}
                  question={question}
                  shuffleSeed={submissionId}
                  value={answers[question.id]}
                  errors={errors[question.id]}
                  upload={upload}
                  removeUpload={removeUpload}
                  onChange={(value) => {
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: value,
                    }));
                    setErrors((current) => ({ ...current, [question.id]: [] }));
                  }}
                />
              ))}
              <div className="flex flex-wrap gap-3">
                {currentPage > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPage(currentPage - 1)}
                  >
                    上一页
                  </Button>
                )}
                {currentPage < pages.length - 1 ? (
                  <Button
                    type="button"
                    disabled={!!uploading}
                    onClick={(event) => {
                      event.preventDefault();
                      if (validate(pages[currentPage]!))
                        setPage(currentPage + 1);
                    }}
                  >
                    下一页
                  </Button>
                ) : (
                  <Button type="submit" disabled={busy || !!uploading}>
                    {busy ? "正在提交…" : "提交答卷"}
                  </Button>
                )}
              </div>
            </fieldset>
          </form>
        ) : !error ? (
          <p className="py-8">正在加载…</p>
        ) : null}
      </div>
    </main>
  );
}
