"use client";
import { displaySurveyReportIssue } from "@/lib/survey/display-report-issue";
import { surveyReportBlockKeys, surveyReportStatisticKeys } from "@/lib/i18n/namespaces/survey-results";
import { displaySurveyRuntimeError } from "@/lib/survey/display-runtime-error";
import { surveyRuntimeMessages } from "@/lib/survey/runtime-error-copy";
import { useI18n } from "@/lib/i18n/provider";
import * as React from "react";
import { survey } from "@repo/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  BLOCK_LABELS,
  newBlock,
  copySection,
  moveItem,
  availableReportStatistics,
} from "@/lib/survey/report-template";
import { SurveyReportDocument } from "./report-document";

type Props = {
  template: survey.SurveyReportTemplate;
  onChange: (value: survey.SurveyReportTemplate) => void;
  questions: survey.SurveyWorkflowQuestion[];
  responses: survey.SurveyResponse[];
  readonly?: boolean;
};
const selectStyle =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-12";
export function FlexibleReportEditor({
  template,
  onChange,
  questions,
  responses,
  readonly = false,
}: Props) {
  const { t, locale } = useI18n();
  const [selected, setSelected] = React.useState(template.sections[0]?.id);
  const [preview, setPreview] = React.useState(false);
  const [error, setError] = React.useState<Error | string>("");
  const currentTranslator = React.useRef(t);
  React.useEffect(() => { currentTranslator.current = t; }, [t]);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const section =
    template.sections.find((item) => item.id === selected) ??
    template.sections[0];
  const index = template.sections.findIndex((item) => item.id === section?.id);
  const compiled = React.useMemo(() => {
    const valid = survey.SurveyReportTemplateSchema.safeParse(template);
    return valid.success
      ? survey.compileSurveyReport(valid.data, questions, responses)
      : {
          id: template.id,
          title: template.title,
          sections: [],
          issues: [surveyRuntimeMessages.reportConfig],
        };
  }, [template, questions, responses]);
  const updateSection = (patch: Partial<NonNullable<typeof section>>) =>
    onChange({
      ...template,
      sections: template.sections.map((item) =>
        item.id === section?.id ? { ...item, ...patch } : item,
      ),
    });
  const updateBlock = (id: string, patch: Partial<survey.SurveyReportBlock>) =>
    section &&
    updateSection({
      blocks: section.blocks.map((block) =>
        block.id === id ? { ...block, ...patch } : block,
      ),
    });
  const download = () => {
    const blob = new Blob([JSON.stringify(template, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "report-template.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error(surveyRuntimeMessages.templateTooLarge);
      const parsed = survey.SurveyReportTemplateSchema.safeParse(
        JSON.parse(await file.text()),
      );
      if (!parsed.success)
        throw new Error(surveyRuntimeMessages.templateInvalid);
      if (!window.confirm(currentTranslator.current("survey.results.importConfirm"))) return;
      onChange(parsed.data);
      setSelected(parsed.data.sections[0]?.id);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e : surveyRuntimeMessages.templateImport);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <div className="min-w-0 bg-muted/30" data-testid="survey-flexible-template">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card p-4">
        <label className="min-w-48 flex-1 text-11 text-muted-foreground">{t("survey.results.reportTitle")}<Input
            aria-label={t("survey.results.reportTitle")}
            value={template.title}
            readOnly={readonly}
            onChange={(e) => onChange({ ...template, title: e.target.value })}
          />
        </label>
        <Button variant="outline" onClick={() => setPreview(!preview)}>
          {preview ? t("survey.results.backEditing") : t("survey.results.previewReport")}
        </Button>
        <Button variant="outline" onClick={download}>{t("survey.results.exportTemplate")}</Button>
        {!readonly && (
          <>
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >{t("survey.results.importTemplate")}</Button>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="application/json,.json"
              aria-label={t("survey.results.importFile")}
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
          </>
        )}
      </div>
      {template.sections.length > 0 && compiled.issues.length > 0 && (
        <p className="px-4 pt-3 text-11 text-warning">{t("survey.results.configurationHint")}</p>
      )}
      {error && (
        <p role="alert" className="p-4 text-12 text-destructive">
          {displaySurveyRuntimeError(error, t, locale)}
        </p>
      )}
      {preview ? (
        <div className="mx-auto max-w-5xl p-4">
          <SurveyReportDocument report={compiled} />
        </div>
      ) : (
        <div className="grid min-w-0 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <aside className="border-b border-border bg-card p-4 lg:border-b-0 lg:border-r">
            <p className="mb-3 text-13 font-semibold">
              {t("survey.results.chaptersCount", { count: template.sections.length })}
            </p>
            <ol className="space-y-1">
              {template.sections.map((item, i) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={item.id === section?.id ? "true" : undefined}
                    onClick={() => setSelected(item.id)}
                    className={`w-full rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring px-3 py-2 text-left text-12 ${item.id === section?.id ? "bg-accent text-primary" : "hover:bg-muted"}`}
                  >
                    {i + 1}. {item.title || t("survey.results.untitledChapter")}
                    <span className="mt-1 block text-10 text-muted-foreground">
                      {t("survey.results.blocksCount", { count: item.blocks.length })}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {!readonly && (
              <Button
                className="mt-4 w-full"
                variant="outline"
                onClick={() => {
                  const id = crypto.randomUUID();
                  onChange({
                    ...template,
                    sections: [
                      ...template.sections,
                      { id, title: t("survey.results.newChapter"), blocks: [] },
                    ],
                  });
                  setSelected(id);
                }}
              >{t("survey.results.addChapter")}</Button>
            )}
          </aside>
          <div className="min-w-0 p-4 lg:p-6">
            {!section ? (
              <p className="py-16 text-center text-muted-foreground">{t("survey.results.emptyEditor")}</p>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-end gap-2">
                  <label className="min-w-48 flex-1 text-11 text-muted-foreground">{t("survey.results.chapterTitle")}<Input
                      aria-label={t("survey.results.chapterTitle")}
                      value={section.title}
                      readOnly={readonly}
                      onChange={(e) => updateSection({ title: e.target.value })}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-13">
                    <input type="checkbox" checked={section.interpretation !== false} disabled={readonly}
                      onChange={(event) => updateSection({ interpretation: event.target.checked })} />{t("survey.results.interpretation")}</label>
                  {!readonly && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const copy = { ...copySection(section), title: t("survey.results.copyTitle", { title: section.title }) };
                          onChange({
                            ...template,
                            sections: [
                              ...template.sections.slice(0, index + 1),
                              copy,
                              ...template.sections.slice(index + 1),
                            ],
                          });
                          setSelected(copy.id);
                        }}
                      >{t("survey.results.copyChapter")}</Button>
                      <Button
                        variant="outline"
                        aria-label={t("survey.results.chapterUp")}
                        disabled={index === 0}
                        onClick={() =>
                          onChange({
                            ...template,
                            sections: moveItem(template.sections, index, -1),
                          })
                        }
                      >{t("survey.results.up")}</Button>
                      <Button
                        variant="outline"
                        aria-label={t("survey.results.chapterDown")}
                        disabled={index === template.sections.length - 1}
                        onClick={() =>
                          onChange({
                            ...template,
                            sections: moveItem(template.sections, index, 1),
                          })
                        }
                      >{t("survey.results.down")}</Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (window.confirm(t("survey.results.deleteChapterConfirm")))
                            onChange({
                              ...template,
                              sections: template.sections.filter(
                                (item) => item.id !== section.id,
                              ),
                            });
                        }}
                      >{t("survey.results.deleteChapter")}</Button>
                    </>
                  )}
                </div>
                <div className="space-y-4">
                  {section.blocks.map((block, i) => (
                    <div
                      key={block.id}
                      className="rounded-lg border border-border bg-card p-4"
                      data-testid={`template-block-${block.id}`}
                    >
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <span className="flex-1 text-12 font-semibold">
                          {i + 1} · {t(surveyReportBlockKeys[block.type])}
                        </span>
                        {!readonly && (
                          <>
                            <Button
                              size="xs"
                              variant="ghost"
                              aria-label={t("survey.results.blockUp", { index: i + 1 })}
                              disabled={i === 0}
                              onClick={() =>
                                updateSection({
                                  blocks: moveItem(section.blocks, i, -1),
                                })
                              }
                            >{t("survey.results.up")}</Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              aria-label={t("survey.results.blockDown", { index: i + 1 })}
                              disabled={i === section.blocks.length - 1}
                              onClick={() =>
                                updateSection({
                                  blocks: moveItem(section.blocks, i, 1),
                                })
                              }
                            >{t("survey.results.down")}</Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() =>
                                updateSection({
                                  blocks: [
                                    ...section.blocks.slice(0, i + 1),
                                    {
                                      ...block,
                                      id: crypto.randomUUID(),
                                      questionIds: [...block.questionIds],
                                    },
                                    ...section.blocks.slice(i + 1),
                                  ],
                                })
                              }
                            >{t("survey.results.copy")}</Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                if (window.confirm(t("survey.results.deleteBlockConfirm")))
                                  updateSection({
                                    blocks: section.blocks.filter(
                                      (item) => item.id !== block.id,
                                    ),
                                  });
                              }}
                            >{t("survey.results.delete")}</Button>
                          </>
                        )}
                      </div>
                      <BlockFields
                        block={block}
                        questions={questions}
                        readonly={readonly}
                        update={(patch) => updateBlock(block.id, patch)}
                      />
                      {compiled.sections
                        .find((item) => item.id === section.id)
                        ?.blocks.find((item) => item.id === block.id)
                        ?.issues.map((issue, j) => (
                          <p key={j} className="mt-2 text-11 text-warning">
                            {displaySurveyReportIssue(issue, t)}
                          </p>
                        ))}
                    </div>
                  ))}
                </div>
                {!readonly && (
                  <div className="mt-5 rounded-lg border border-dashed border-border p-4">
                    <p className="mb-3 text-12 font-medium">{t("survey.results.addBlockHeading")}</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(BLOCK_LABELS).map((type) => (
                        <Button
                          key={type}
                          size="sm"
                          variant="outline"
                          aria-label={t("survey.results.addBlock", { type: t(surveyReportBlockKeys[type as survey.SurveyReportBlock["type"]]) })}
                          onClick={() =>
                            updateSection({
                              blocks: [
                                ...section.blocks,
                                { ...newBlock(type as survey.SurveyReportBlock["type"]), title: t(surveyReportBlockKeys[type as survey.SurveyReportBlock["type"]]) },
                              ],
                            })
                          }
                        >
                          {t(surveyReportBlockKeys[type as survey.SurveyReportBlock["type"]])}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
function BlockFields({
  block,
  questions,
  readonly,
  update,
}: {
  block: survey.SurveyReportBlock;
  questions: survey.SurveyWorkflowQuestion[];
  readonly: boolean;
  update: (patch: Partial<survey.SurveyReportBlock>) => void;
}) {
  const { t } = useI18n();
  const data = !["text", "image", "page-break"].includes(block.type);
  const statisticsFor = (ids: string[]) =>
    availableReportStatistics(
      questions.filter((question) => ids.includes(question.id)),
    ).filter((statistic) =>
      ["radar", "gap"].includes(block.type)
        ? statistic === "mean"
        : ["bar", "line"].includes(block.type)
          ? statistic !== "responses"
          : true,
    );
  const statistics = statisticsFor(block.questionIds);
  const bindQuestions = (questionIds: string[]) => {
    const next = statisticsFor(questionIds);
    update({
      questionIds,
      ...(next.length && !next.includes(block.statistic)
        ? { statistic: next[0] }
        : {}),
    });
  };
  return (
    <div className="space-y-3">
      {block.type !== "page-break" && (
        <label className="block text-11 text-muted-foreground">{t("survey.results.contentTitle")}<Input
            aria-label={t("survey.results.contentTitle")}
            value={block.title}
            readOnly={readonly}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
      )}
      {block.type === "text" && (
        <label className="block text-11 text-muted-foreground">{t("survey.results.body")}<Textarea
            aria-label={t("survey.results.body")}
            rows={5}
            value={block.text ?? ""}
            readOnly={readonly}
            onChange={(e) => update({ text: e.target.value })}
          />
        </label>
      )}
      {block.type === "image" && (
        <label className="block text-11 text-muted-foreground">{t("survey.results.imageHttps")}<Input
            aria-label={t("survey.results.imageUrl")}
            value={block.imageUrl ?? ""}
            readOnly={readonly}
            placeholder="https://…"
            onChange={(e) => update({ imageUrl: e.target.value })}
          />
        </label>
      )}
      {block.type === "page-break" && (
        <p className="text-12 text-muted-foreground">{t("survey.results.pageBreakHelp")}</p>
      )}
      {data && (
        <>
          <fieldset
            disabled={readonly}
            className="rounded-md border border-border p-3"
          >
            <legend className="px-1 text-11">{t("survey.results.bindQuestions")}</legend>
            <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
              {questions
                .filter((q) => !survey.isSurveyPageElement(q))
                .map((q) => (
                  <label key={q.id} className="flex items-start gap-2 text-11">
                    <input
                      type="checkbox"
                      checked={block.questionIds.includes(q.id)}
                      onChange={(e) =>
                        bindQuestions(
                          e.target.checked
                            ? [...block.questionIds, q.id]
                            : block.questionIds.filter((id) => id !== q.id),
                        )
                      }
                    />
                    <span>
                      {q.order}. {q.title}
                    </span>
                  </label>
                ))}
              {questions.length === 0 && (
                <p className="text-11 text-muted-foreground">{t("survey.results.addQuestionsFirst")}</p>
              )}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-11 text-muted-foreground">{t("survey.results.statistic")}<select
                aria-label={t("survey.results.statistic")}
                className={selectStyle}
                disabled={readonly}
                value={block.statistic}
                onChange={(e) =>
                  update({
                    statistic: e.target
                      .value as survey.SurveyReportBlock["statistic"],
                  })
                }
              >
                {!statistics.includes(block.statistic) && (
                  <option value={block.statistic} disabled>
                    {block.questionIds.length
                      ? t("survey.results.unsupportedStatistic", { statistic: t(surveyReportStatisticKeys[block.statistic]) })
                      : t("survey.results.bindFirst")}
                  </option>
                )}
                {statistics.map((statistic) => (
                  <option key={statistic} value={statistic}>
                    {t(surveyReportStatisticKeys[statistic])}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-11 text-muted-foreground">{t("survey.results.groupQuestion")}<select
                aria-label={t("survey.results.groupQuestion")}
                className={selectStyle}
                disabled={readonly}
                value={block.groupByQuestionId ?? ""}
                onChange={(e) =>
                  update({ groupByQuestionId: e.target.value || undefined })
                }
              >
                <option value="">{t("survey.results.noGrouping")}</option>
                {questions
                  .filter((q) =>
                    ["single", "dropdown", "image_single"].includes(q.type),
                  )
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-11 text-muted-foreground">{t("survey.results.sampleRange")}<select
                aria-label={t("survey.results.sampleRange")}
                className={selectStyle}
                disabled={readonly}
                value={block.samplePolicy}
                onChange={(e) =>
                  update({ samplePolicy: e.target.value as "valid" | "all" })
                }
              >
                <option value="valid">{t("survey.results.reviewed")}</option>
                <option value="all">{t("survey.results.allResponses")}</option>
              </select>
            </label>
            <label className="text-11 text-muted-foreground">{t("survey.results.minimumGroup")}<Input
                type="number"
                min={5}
                max={1000}
                aria-label={t("survey.results.minimumGroup")}
                readOnly={readonly}
                value={block.minGroupSize}
                onChange={(e) =>
                  update({
                    minGroupSize: Math.max(5, Number(e.target.value) || 5),
                  })
                }
              />
            </label>
            {block.type === "gap" && (
              <label className="text-11 text-muted-foreground">{t("survey.results.targetValue")}<Input
                  type="number"
                  aria-label={t("survey.results.targetValue")}
                  readOnly={readonly}
                  value={block.target ?? ""}
                  onChange={(e) =>
                    update({
                      target:
                        e.target.value === ""
                          ? undefined
                          : Number(e.target.value),
                    })
                  }
                />
              </label>
            )}
          </div>
        </>
      )}
      {block.type !== "page-break" && (
        <label className="block text-11 text-muted-foreground">{t("survey.results.caption")}<Input
            aria-label={t("survey.results.caption")}
            value={block.caption ?? ""}
            readOnly={readonly}
            onChange={(e) => update({ caption: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
