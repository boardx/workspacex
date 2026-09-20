"use client";
import * as React from "react";
import type { survey } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { moveItem } from "@/lib/survey/report-template";
export function SurveyQuestionEditor({
  questions,
  onChange,
  locked = false,
}: {
  questions: survey.SurveyWorkflowQuestion[];
  onChange: (q: survey.SurveyWorkflowQuestion[]) => void;
  locked?: boolean;
}) {
  const [id, setId] = React.useState(questions[0]?.id);
  const question = questions.find((q) => q.id === id) ?? questions[0];
  const index = questions.findIndex((q) => q.id === question?.id);
  const change = (all: survey.SurveyWorkflowQuestion[]) =>
    onChange(all.map((q, i) => ({ ...q, order: i + 1 })));
  const update = (patch: Partial<survey.SurveyWorkflowQuestion>) =>
    change(
      questions.map((q) => (q.id === question?.id ? { ...q, ...patch } : q)),
    );
  return (
    <div className="grid gap-6 p-5 lg:grid-cols-[16rem_1fr]">
      <aside>
        <h2 className="mb-3 text-14 font-semibold">
          题目目录 · {questions.length}
        </h2>
        <ol className="space-y-1">
          {questions.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setId(q.id)}
                className={`w-full rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring p-3 text-left text-12 ${q.id === question?.id ? "bg-accent" : "hover:bg-muted"}`}
              >
                {q.order}. {q.title || "未命名题目"}
              </button>
            </li>
          ))}
        </ol>
        {!locked && (
          <Button
            className="mt-4"
            onClick={() => {
              const next = {
                id: crypto.randomUUID(),
                order: questions.length + 1,
                chapterId: "general",
                title: "新题目",
                type: "single" as const,
                required: true,
                options: ["选项一", "选项二"],
              };
              change([...questions, next]);
              setId(next.id);
            }}
          >
            新增题目
          </Button>
        )}
      </aside>
      <section className="max-w-3xl">
        {locked && (
          <p className="mb-4 rounded-md bg-muted p-3 text-12">
            已发布的题目已锁定，以保证答卷与题目一致。仍可调整报告模板。
          </p>
        )}
        {question ? (
          <fieldset
            disabled={locked}
            className="space-y-5 rounded-lg border border-border bg-card p-5"
          >
            <label className="block text-12">
              问题内容
              <Textarea
                aria-label="问题内容"
                value={question.title}
                onChange={(e) => update({ title: e.target.value })}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-12">
                题型
                <select
                  aria-label="题型"
                  className="mt-1 w-full rounded-md border border-border bg-background p-2"
                  value={question.type}
                  onChange={(e) => {
                    const type = e.target
                      .value as survey.SurveyWorkflowQuestion["type"];
                    update({
                      type,
                      options:
                        type === "open"
                          ? []
                          : type === "scale"
                            ? ["1", "2", "3", "4", "5"]
                            : ["选项一", "选项二"],
                    });
                  }}
                >
                  <option value="single">单选</option>
                  <option value="multi">多选</option>
                  <option value="scale">量表</option>
                  <option value="open">开放题</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-12">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(e) => update({ required: e.target.checked })}
                />
                必答
              </label>
            </div>
            {question.type !== "open" && (
              <div className="space-y-2">
                <p className="text-12">
                  {question.type === "scale" ? "量表数值" : "选项"}
                </p>
                {question.options.map((option, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      aria-label={`选项 ${i + 1}`}
                      value={option}
                      onChange={(e) =>
                        update({
                          options: question.options.map((v, j) =>
                            i === j ? e.target.value : v,
                          ),
                        })
                      }
                    />
                    <Button
                      variant="outline"
                      onClick={() =>
                        update({
                          options: question.options.filter((_, j) => j !== i),
                        })
                      }
                    >
                      删除
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() =>
                    update({
                      options: [
                        ...question.options,
                        question.type === "scale"
                          ? String(question.options.length + 1)
                          : "新选项",
                      ],
                    })
                  }
                >
                  添加选项
                </Button>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={locked || index === 0}
                onClick={() => change(moveItem(questions, index, -1))}
              >
                上移
              </Button>
              <Button
                variant="outline"
                disabled={locked || index === questions.length - 1}
                onClick={() => change(moveItem(questions, index, 1))}
              >
                下移
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  if (
                    window.confirm(
                      "删除题目后需要检查报告中的数据绑定，继续吗？",
                    )
                  )
                    change(questions.filter((q) => q.id !== question.id));
                }}
              >
                删除题目
              </Button>
            </div>
          </fieldset>
        ) : (
          <p className="py-16 text-center text-muted-foreground">
            添加第一道题目，开始设计问卷。
          </p>
        )}
      </section>
    </div>
  );
}
