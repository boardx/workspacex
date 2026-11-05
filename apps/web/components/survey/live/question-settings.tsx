"use client";
import * as React from "react";
import { useI18n } from "@/lib/i18n/provider";
import {
  SURVEY_UPLOAD_ALLOWED_EXTENSIONS,
  surveyChoices,
  type SurveyWorkflowQuestion,
} from "@repo/contracts/survey-question-types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { InlineQuestionText } from "./inline-question-text";
type Config = NonNullable<SurveyWorkflowQuestion["config"]>;
export function SurveyQuestionSettings({
  question: q,
  questions,
  onChange,
  mode = "all",
  inline = false,
  showDescription = true,
}: {
  question: SurveyWorkflowQuestion;
  questions: SurveyWorkflowQuestion[];
  onChange: (q: SurveyWorkflowQuestion) => void;
  mode?: "all" | "content" | "advanced";
  inline?: boolean;
  showDescription?: boolean;
}) {
  const { t } = useI18n();
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
  const showContent = mode !== "advanced";
  const showAdvanced = mode !== "content";
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
            aria-label={t("survey.design.fieldNumber", { title, index: index + 1 })}
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
            {t("survey.design.rowRequired")}
          </label>
          <Button
            type="button"
            variant="outline"
            aria-label={t("survey.design.deleteField", { title, index: index + 1 })}
            onClick={() =>
              patch({
                [key]: config[key]!.filter((item) => item.id !== field.id),
              })
            }
          >
            {t("survey.design.delete")}
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
                label: t(key === "rows" ? "survey.design.newRow" : "survey.design.newField"),
                required: q.required,
              },
            ],
          })
        }
      >
        {t(key === "rows" ? "survey.design.addRow" : "survey.design.addField")}
      </Button>
    </div>
  );
  return (
    <div className="space-y-5">
      {showContent && <>
      {showDescription && <label className="block text-12">
        {!inline && t("survey.design.description")}
        {inline ? <InlineQuestionText label={t("survey.design.description")} placeholder={t("survey.design.addDescription")} multiline value={config.description ?? ""} onChange={(description) => patch({ description })} /> : <Textarea
          aria-label={t("survey.design.description")}
          placeholder={inline ? t("survey.design.addDescription") : undefined}
          className={inline ? "min-h-8 resize-none border-transparent bg-transparent shadow-none transition-colors hover:border-border focus-visible:border-ring" : undefined}
          value={config.description ?? ""}
          onChange={(event) => patch({ description: event.target.value })}
        />}
      </label>}
      {hasChoices && (
        <div className="space-y-2">
          <h3 className={inline ? "sr-only" : "text-13 font-medium"}>
            {q.type.startsWith("matrix_") ? t("survey.design.matrixOptions") : t("survey.design.options")}
          </h3>
          {choices.map((choice, index) => (
            <div
              key={choice.id}
              className={inline ? "group/option space-y-2 py-1" : "space-y-2 rounded-md border border-border p-2"}
            >
              <div className="flex gap-2">
                {inline && <span aria-hidden="true" className="mt-3 size-4 shrink-0 rounded-full border border-border" />}
                {inline ? <InlineQuestionText label={t("survey.design.optionNumber", { index: index + 1 })} editLabel={t("survey.design.editOption", { index: index + 1, label: choice.label })} value={choice.label}
                  onChange={(value) => options(q.options.map((label, i) => i === index ? value : label), choices.map((item) => item.id))} /> : <Input
                  aria-label={t("survey.design.optionNumber", { index: index + 1 })}
                  className={inline ? "border-transparent bg-transparent shadow-none transition-colors hover:border-border focus-visible:border-ring" : undefined}
                  value={choice.label}
                  onChange={(event) =>
                    options(
                      q.options.map((label, i) =>
                        i === index ? event.target.value : label,
                      ),
                      choices.map((item) => item.id),
                    )
                  }
                />}
                <Button
                  type="button"
                  variant={inline ? "ghost" : "outline"}
                  className={inline ? "invisible group-hover/option:visible group-focus-within/option:visible" : undefined}
                  aria-label={t("survey.design.deleteOption", { index: index + 1 })}
                  onClick={() =>
                    options(
                      q.options.filter((_, i) => i !== index),
                      choices
                        .filter((_, i) => i !== index)
                        .map((item) => item.id),
                    )
                  }
                >
                  {t("survey.design.delete")}
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
                [...q.options, t("survey.design.newOption")],
                [...choices.map((item) => item.id), crypto.randomUUID()],
              )
            }
          >
            {t("survey.design.addOption")}
          </Button>
          <details className="text-12">
            <summary className="cursor-pointer py-2">{t("survey.design.bulkOptions")}</summary>
            <Textarea
              aria-label={t("survey.design.bulkOptionsInput")}
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
              {t("survey.design.applyOptions")}
            </Button>
          </details>
        </div>
      )}
      {q.type.startsWith("matrix_") && fields("rows", t("survey.design.matrixRow"))}
      {["multiple_text", "address"].includes(q.type) &&
        fields("fields", t("survey.design.field"))}
      {q.type === "cascade" && (
        <label className="block text-12">
          {t("survey.design.cascadePathsHint")}
          <Textarea
            aria-label={t("survey.design.cascadePaths")}
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
      </>}
      {showAdvanced && <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-13 font-medium">
          {t("survey.design.advanced")}
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
              {t("survey.design.shuffleOptions")}
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
              {t("survey.design.includeOther")}
            </label>
          )}
          {["multi", "image_multi", "matrix_multi"].includes(q.type) && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {numeric("minSelections", t("survey.design.minSelections"))}
                {numeric("maxSelections", t("survey.design.maxSelections"))}
              </div>
              <fieldset>
                <legend className="text-12">{t("survey.design.exclusiveOptions")}</legend>
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
              {numeric("minLength", t("survey.design.minLength"))}
              {numeric("maxLength", t("survey.design.maxLength"))}
            </div>
          )}
          {["number", "rating", "slider", "allocation"].includes(q.type) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {numeric("min", t("survey.design.minimum"))}
              {numeric("max", t("survey.design.maximum"))}
              {numeric("step", t("survey.design.step"))}
              <label className="text-12">
                {t("survey.design.unit")}
                <Input
                  aria-label={t("survey.design.unit")}
                  value={config.unit ?? ""}
                  onChange={(event) => patch({ unit: event.target.value })}
                />
              </label>
            </div>
          )}
          {q.type === "allocation" && numeric("total", t("survey.design.allocationTotal"))}
          {["scale", "rating", "nps", "slider", "matrix_scale"].includes(
            q.type,
          ) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-12">
                {t("survey.design.lowLabel")}
                <Input
                  aria-label={t("survey.design.lowLabel")}
                  value={config.lowLabel ?? ""}
                  onChange={(event) => patch({ lowLabel: event.target.value })}
                />
              </label>
              <label className="text-12">
                {t("survey.design.highLabel")}
                <Input
                  aria-label={t("survey.design.highLabel")}
                  value={config.highLabel ?? ""}
                  onChange={(event) => patch({ highLabel: event.target.value })}
                />
              </label>
            </div>
          )}
          {q.type === "file" && (
            <div className="grid gap-3 sm:grid-cols-2">
              {numeric("maxFiles", t("survey.design.maxFiles"))}
              {numeric("maxFileBytes", t("survey.design.maxFileBytes"))}
              <fieldset>
                <legend className="text-12">{t("survey.design.fileFormats")}</legend>
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
      </details>}
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
  const { t } = useI18n();
  const image = config.images?.[id] ?? { url: "", alt: "" };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="text-12">
        {t("survey.design.imageUrl")}
        <Input
          aria-label={t("survey.design.imageUrlId", { id })}
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
        {t("survey.design.imageAlt")}
        <Input
          aria-label={t("survey.design.imageAltId", { id })}
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
  const { t } = useI18n();
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
      <h3 className="text-13 font-medium">{t("survey.design.conditions")}</h3>
      {(config.visibleWhen ?? []).map((rule, index) => (
        <div key={index} className="flex flex-wrap gap-2">
          <select
            aria-label={t("survey.design.conditionQuestion", { index: index + 1 })}
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
            aria-label={t("survey.design.conditionOperator", { index: index + 1 })}
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
            <option value="equals">{t("survey.design.equals")}</option>
            <option value="notEquals">{t("survey.design.notEquals")}</option>
            <option value="includes">{t("survey.design.includes")}</option>
          </select>
          <Input
            aria-label={t("survey.design.conditionAnswer", { index: index + 1 })}
            placeholder={t("survey.design.conditionAnswerHint")}
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
            {t("survey.design.deleteCondition")}
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
        {t("survey.design.addCondition")}
      </Button>
      {!!q.options.length && (
        <>
          <h3 className="text-13 font-medium">{t("survey.design.jumps")}</h3>
          {(config.jumpTo ?? []).map((rule, index) => (
            <div key={index} className="flex flex-wrap gap-2">
              <select
                aria-label={t("survey.design.jumpOption", { index: index + 1 })}
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
                aria-label={t("survey.design.jumpTarget", { index: index + 1 })}
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
                {t("survey.design.deleteJump")}
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
            {t("survey.design.addJump")}
          </Button>
        </>
      )}
    </div>
  );
}
