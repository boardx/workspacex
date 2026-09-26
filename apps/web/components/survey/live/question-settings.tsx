"use client";
import * as React from "react";
import {
  SURVEY_UPLOAD_ALLOWED_EXTENSIONS,
  surveyChoices,
  type SurveyWorkflowQuestion,
} from "@repo/contracts/survey-question-types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
type Config = NonNullable<SurveyWorkflowQuestion["config"]>;
export function SurveyQuestionSettings({
  question: q,
  questions,
  onChange,
}: {
  question: SurveyWorkflowQuestion;
  questions: SurveyWorkflowQuestion[];
  onChange: (q: SurveyWorkflowQuestion) => void;
}) {
  const config = q.config ?? {};
  const [bulk, setBulk] = React.useState("");
  const patch = (next: Partial<Config>) =>
    onChange({ ...q, config: { ...config, ...next } });
  const choices = surveyChoices(q);
  const hasChoices = [
    "single",
    "multi",
    "dropdown",
    "image_single",
    "image_multi",
    "scale",
    "matrix_single",
    "matrix_multi",
    "matrix_scale",
    "matrix_dropdown",
    "ranking",
    "allocation",
  ].includes(q.type);
  function options(labels: string[], ids: string[]) {
    onChange({
      ...q,
      options: labels,
      config: {
        ...config,
        optionIds: ids,
        exclusiveOptionIds: config.exclusiveOptionIds?.filter((id) =>
          ids.includes(id),
        ),
        images: config.images
          ? Object.fromEntries(
              Object.entries(config.images).filter(([id]) => ids.includes(id)),
            )
          : undefined,
      },
    });
  }
  const numeric = (
    key:
      | "min"
      | "max"
      | "step"
      | "minLength"
      | "maxLength"
      | "minSelections"
      | "maxSelections"
      | "total"
      | "maxFiles"
      | "maxFileBytes",
    label: string,
  ) => (
    <label key={key} className="text-12">
      {label}
      <Input
        type="number"
        aria-label={label}
        value={config[key] ?? ""}
        onChange={(event) =>
          patch({
            [key]:
              event.target.value === ""
                ? undefined
                : Number(event.target.value),
          })
        }
      />
    </label>
  );
  const fields = (key: "rows" | "fields", title: string) => (
    <div className="space-y-2">
      <h3 className="text-13 font-medium">{title}</h3>
      {(config[key] ?? []).map((field, index) => (
        <div key={field.id} className="flex flex-wrap gap-2">
          <Input
            className="min-w-0 flex-1"
            aria-label={`${title} ${index + 1}`}
            value={field.label}
            onChange={(event) =>
              patch({
                [key]: config[key]!.map((item) =>
                  item.id === field.id
                    ? { ...item, label: event.target.value }
                    : item,
                ),
              })
            }
          />
          <label className="flex items-center gap-1 text-12">
            <input
              type="checkbox"
              checked={field.required ?? q.required}
              onChange={(event) =>
                patch({
                  [key]: config[key]!.map((item) =>
                    item.id === field.id
                      ? { ...item, required: event.target.checked }
                      : item,
                  ),
                })
              }
            />
            每行必答
          </label>
          <Button
            type="button"
            variant="outline"
            aria-label={`删除${title} ${index + 1}`}
            onClick={() =>
              patch({
                [key]: config[key]!.filter((item) => item.id !== field.id),
              })
            }
          >
            删除
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() =>
          patch({
            [key]: [
              ...(config[key] ?? []),
              {
                id: crypto.randomUUID(),
                label: `新${title}`,
                required: q.required,
              },
            ],
          })
        }
      >
        添加{title}
      </Button>
    </div>
  );
  return (
    <div className="space-y-5">
      <label className="block text-12">
        题目说明
        <Textarea
          aria-label="题目说明"
          value={config.description ?? ""}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </label>
      {hasChoices && (
        <div className="space-y-2">
          <h3 className="text-13 font-medium">
            {q.type.startsWith("matrix_") ? "矩阵列选项" : "选项"}
          </h3>
          {choices.map((choice, index) => (
            <div
              key={choice.id}
              className="space-y-2 rounded-md border border-border p-2"
            >
              <div className="flex gap-2">
                <Input
                  aria-label={`选项 ${index + 1}`}
                  value={choice.label}
                  onChange={(event) =>
                    options(
                      q.options.map((label, i) =>
                        i === index ? event.target.value : label,
                      ),
                      choices.map((item) => item.id),
                    )
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`删除选项 ${index + 1}`}
                  onClick={() =>
                    options(
                      q.options.filter((_, i) => i !== index),
                      choices
                        .filter((_, i) => i !== index)
                        .map((item) => item.id),
                    )
                  }
                >
                  删除
                </Button>
              </div>
              {q.type.startsWith("image_") && (
                <ImageSettings id={choice.id} config={config} patch={patch} />
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              options(
                [...q.options, "新选项"],
                [...choices.map((item) => item.id), crypto.randomUUID()],
              )
            }
          >
            添加选项
          </Button>
          <details className="text-12">
            <summary className="cursor-pointer py-2">批量粘贴选项</summary>
            <Textarea
              aria-label="批量选项，每行一个"
              value={bulk}
              onChange={(event) => setBulk(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const labels = bulk
                  .split(/\r?\n/)
                  .map((value) => value.trim())
                  .filter(Boolean);
                if (labels.length)
                  options(
                    labels,
                    labels.map(
                      (_, index) => choices[index]?.id ?? crypto.randomUUID(),
                    ),
                  );
              }}
            >
              应用选项
            </Button>
          </details>
        </div>
      )}
      {q.type.startsWith("matrix_") && fields("rows", "矩阵行")}
      {["multiple_text", "address"].includes(q.type) &&
        fields("fields", "字段")}
      {q.type === "cascade" && (
        <label className="block text-12">
          级联路径（每行一条，用 / 分隔层级）
          <Textarea
            aria-label="级联路径"
            value={(config.cascadePaths ?? [])
              .map((path) => path.join(" / "))
              .join("\n")}
            onChange={(event) =>
              patch({
                cascadePaths: event.target.value
                  .split("\n")
                  .filter(Boolean)
                  .map((path) => path.split("/").map((value) => value.trim())),
              })
            }
          />
        </label>
      )}
      {q.type === "description" && (
        <ImageSettings id="description" config={config} patch={patch} />
      )}
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-13 font-medium">
          高级规则
        </summary>
        <div className="mt-4 space-y-4">
          {hasChoices && (
            <label className="flex items-center gap-2 text-12">
              <input
                type="checkbox"
                checked={config.shuffleOptions ?? false}
                onChange={(event) =>
                  patch({ shuffleOptions: event.target.checked })
                }
              />
              选项随机顺序（单次填写保持稳定）
            </label>
          )}
          {[
            "single",
            "multi",
            "dropdown",
            "image_single",
            "image_multi",
          ].includes(q.type) && (
            <label className="flex items-center gap-2 text-12">
              <input
                type="checkbox"
                checked={config.other ?? false}
                onChange={(event) => patch({ other: event.target.checked })}
              />
              包含“其他”及填写说明
            </label>
          )}
          {["multi", "image_multi", "matrix_multi"].includes(q.type) && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {numeric("minSelections", "最少选择数")}
                {numeric("maxSelections", "最多选择数")}
              </div>
              <fieldset>
                <legend className="text-12">互斥选项</legend>
                {choices.map((choice) => (
                  <label
                    key={choice.id}
                    className="mr-3 inline-flex items-center gap-1 text-12"
                  >
                    <input
                      type="checkbox"
                      checked={
                        config.exclusiveOptionIds?.includes(choice.id) ?? false
                      }
                      onChange={(event) =>
                        patch({
                          exclusiveOptionIds: event.target.checked
                            ? [...(config.exclusiveOptionIds ?? []), choice.id]
                            : config.exclusiveOptionIds?.filter(
                                (id) => id !== choice.id,
                              ),
                        })
                      }
                    />
                    {choice.label}
                  </label>
                ))}
              </fieldset>
            </>
          )}
          {["short", "open", "multiple_text", "matrix_input"].includes(
            q.type,
          ) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {numeric("minLength", "最少字数")}
              {numeric("maxLength", "最多字数")}
            </div>
          )}
          {["number", "rating", "slider", "allocation"].includes(q.type) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {numeric("min", "最小值")}
              {numeric("max", "最大值")}
              {numeric("step", "步长 / 精度")}
              <label className="text-12">
                单位
                <Input
                  aria-label="单位"
                  value={config.unit ?? ""}
                  onChange={(event) => patch({ unit: event.target.value })}
                />
              </label>
            </div>
          )}
          {q.type === "allocation" && numeric("total", "分配合计")}
          {["scale", "rating", "nps", "slider", "matrix_scale"].includes(
            q.type,
          ) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-12">
                低分端点
                <Input
                  aria-label="低分端点"
                  value={config.lowLabel ?? ""}
                  onChange={(event) => patch({ lowLabel: event.target.value })}
                />
              </label>
              <label className="text-12">
                高分端点
                <Input
                  aria-label="高分端点"
                  value={config.highLabel ?? ""}
                  onChange={(event) => patch({ highLabel: event.target.value })}
                />
              </label>
            </div>
          )}
          {q.type === "file" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {numeric("maxFiles", "最多文件数")}
              {numeric("maxFileBytes", "单文件字节上限")}
              <fieldset>
                <legend className="text-12">允许文件格式</legend>
                {SURVEY_UPLOAD_ALLOWED_EXTENSIONS.map((extension) => (
                  <label
                    key={extension}
                    className="mr-2 inline-flex items-center gap-1 text-12"
                  >
                    <input
                      type="checkbox"
                      checked={
                        config.allowedExtensions?.includes(extension) ?? false
                      }
                      onChange={(event) =>
                        patch({
                          allowedExtensions: event.target.checked
                            ? [...(config.allowedExtensions ?? []), extension]
                            : config.allowedExtensions?.filter(
                                (value) => value !== extension,
                              ),
                        })
                      }
                    />
                    {extension}
                  </label>
                ))}
              </fieldset>
            </div>
          )}
          <RuleSettings question={q} questions={questions} patch={patch} />
        </div>
      </details>
    </div>
  );
}
function ImageSettings({
  id,
  config,
  patch,
}: {
  id: string;
  config: Config;
  patch: (config: Partial<Config>) => void;
}) {
  const image = config.images?.[id] ?? { url: "", alt: "" };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-12">
        图片地址
        <Input
          aria-label={`图片地址 ${id}`}
          value={image.url}
          onChange={(event) =>
            patch({
              images: {
                ...config.images,
                [id]: { ...image, url: event.target.value },
              },
            })
          }
        />
      </label>
      <label className="text-12">
        图片替代文字
        <Input
          aria-label={`图片替代文字 ${id}`}
          value={image.alt}
          onChange={(event) =>
            patch({
              images: {
                ...config.images,
                [id]: { ...image, alt: event.target.value },
              },
            })
          }
        />
      </label>
    </div>
  );
}
function RuleSettings({
  question: q,
  questions,
  patch,
}: {
  question: SurveyWorkflowQuestion;
  questions: SurveyWorkflowQuestion[];
  patch: (config: Partial<Config>) => void;
}) {
  const config = q.config ?? {},
    index = questions.findIndex((item) => item.id === q.id),
    previous = questions
      .slice(0, index)
      .filter((item) => !["description", "page_break"].includes(item.type)),
    following = questions.slice(index + 1);
  const selectClass =
    "min-w-0 rounded-md border border-border bg-background p-2 text-12";
  return (
    <div className="space-y-4">
      <h3 className="text-13 font-medium">条件显示（所有条件满足时显示）</h3>
      {(config.visibleWhen ?? []).map((rule, index) => (
        <div key={index} className="flex flex-wrap gap-2">
          <select
            aria-label={`条件前题 ${index + 1}`}
            className={selectClass}
            value={rule.questionId}
            onChange={(event) =>
              patch({
                visibleWhen: config.visibleWhen!.map((item, i) =>
                  i === index
                    ? { ...item, questionId: event.target.value, value: "" }
                    : item,
                ),
              })
            }
          >
            {previous.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <select
            aria-label={`条件关系 ${index + 1}`}
            className={selectClass}
            value={rule.operator}
            onChange={(event) =>
              patch({
                visibleWhen: config.visibleWhen!.map((item, i) =>
                  i === index
                    ? {
                        ...item,
                        operator: event.target.value as typeof item.operator,
                      }
                    : item,
                ),
              })
            }
          >
            <option value="equals">等于</option>
            <option value="notEquals">不等于</option>
            <option value="includes">包含</option>
          </select>
          <Input
            aria-label={`条件答案 ${index + 1}`}
            placeholder="选项 ID 或文字"
            value={rule.value}
            onChange={(event) =>
              patch({
                visibleWhen: config.visibleWhen!.map((item, i) =>
                  i === index ? { ...item, value: event.target.value } : item,
                ),
              })
            }
          />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              patch({
                visibleWhen: config.visibleWhen!.filter((_, i) => i !== index),
              })
            }
          >
            删除条件
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={!previous.length}
        onClick={() =>
          patch({
            visibleWhen: [
              ...(config.visibleWhen ?? []),
              {
                questionId: previous[0]!.id,
                operator: "equals",
                value: surveyChoices(previous[0]!)[0]?.id ?? "",
              },
            ],
          })
        }
      >
        添加显示条件
      </Button>
      {!!q.options.length && (
        <>
          <h3 className="text-13 font-medium">答案向后跳转</h3>
          {(config.jumpTo ?? []).map((rule, index) => (
            <div key={index} className="flex flex-wrap gap-2">
              <select
                aria-label={`跳转选项 ${index + 1}`}
                className={selectClass}
                value={rule.optionId}
                onChange={(event) =>
                  patch({
                    jumpTo: config.jumpTo!.map((item, i) =>
                      i === index
                        ? { ...item, optionId: event.target.value }
                        : item,
                    ),
                  })
                }
              >
                {surveyChoices(q).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`跳转目标 ${index + 1}`}
                className={selectClass}
                value={rule.targetId}
                onChange={(event) =>
                  patch({
                    jumpTo: config.jumpTo!.map((item, i) =>
                      i === index
                        ? { ...item, targetId: event.target.value }
                        : item,
                    ),
                  })
                }
              >
                {following.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  patch({
                    jumpTo: config.jumpTo!.filter((_, i) => i !== index),
                  })
                }
              >
                删除跳转
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={!following.length}
            onClick={() =>
              patch({
                jumpTo: [
                  ...(config.jumpTo ?? []),
                  {
                    optionId: surveyChoices(q)[0]!.id,
                    targetId: following[0]!.id,
                  },
                ],
              })
            }
          >
            添加跳转
          </Button>
        </>
      )}
    </div>
  );
}
