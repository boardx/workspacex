"use client";
import * as React from "react";
import type { survey } from "@repo/contracts";
import { surveyRequest } from "@/lib/survey/runtime-client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
    Record<string, string | string[]>
  >({});
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [submissionId] = React.useState(() => crypto.randomUUID());
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
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked.current || !data) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        data.questions.some(
          (q) =>
            q.required &&
            (!answers[q.id] ||
              (Array.isArray(answers[q.id]) &&
                (answers[q.id] as string[]).length === 0)),
        )
      )
        throw new Error("请完成所有必答题后提交。");
      await surveyRequest(
        `/public/surveys/${encodeURIComponent(token)}/responses`,
        {
          method: "POST",
          sessionToken: null,
          body: {
            submissionId,
            answers: Object.entries(answers).map(([questionId, value]) => ({
              questionId,
              value,
            })),
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
  };
  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
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
          <form onSubmit={(e) => void submit(e)}>
            <p className="mb-8 mt-3 text-12 text-muted-foreground">
              匿名填写 · {data.questions.length} 道题 · 标记 * 的题目为必答
            </p>
            <fieldset disabled={busy} className="space-y-8">
              {data.questions.map((q, i) => (
                <fieldset key={q.id}>
                  <legend className="mb-3 text-14 font-medium">
                    {i + 1}. {q.title}
                    {q.required ? " *" : ""}
                  </legend>
                  {q.type === "open" ? (
                    <Textarea
                      aria-label={q.title}
                      required={q.required}
                      maxLength={20000}
                      value={(answers[q.id] as string) ?? ""}
                      onChange={(e) =>
                        setAnswers({ ...answers, [q.id]: e.target.value })
                      }
                    />
                  ) : (
                    <div className="space-y-2">
                      {q.options.map((option) => (
                        <label
                          key={option}
                          className="flex items-center gap-3 rounded-md border border-border px-3 py-3 text-12"
                        >
                          <input
                            type={q.type === "multi" ? "checkbox" : "radio"}
                            name={q.id}
                            value={option}
                            required={q.type !== "multi" && q.required}
                            checked={
                              q.type === "multi"
                                ? Array.isArray(answers[q.id]) &&
                                  (answers[q.id] as string[]).includes(option)
                                : answers[q.id] === option
                            }
                            onChange={(e) =>
                              setAnswers({
                                ...answers,
                                [q.id]:
                                  q.type === "multi"
                                    ? e.target.checked
                                      ? [
                                          ...((answers[q.id] as string[]) ??
                                            []),
                                          option,
                                        ]
                                      : (
                                          (answers[q.id] as string[]) ?? []
                                        ).filter((v) => v !== option)
                                    : option,
                              })
                            }
                          />
                          {option}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
              ))}
              <Button type="submit" disabled={busy}>
                {busy ? "正在提交…" : "提交答卷"}
              </Button>
            </fieldset>
          </form>
        ) : !error ? (
          <p className="py-8">正在加载…</p>
        ) : null}
      </div>
    </main>
  );
}
