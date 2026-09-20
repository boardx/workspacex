"use client";
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
  const [selected, setSelected] = React.useState(template.sections[0]?.id);
  const [preview, setPreview] = React.useState(false);
  const [error, setError] = React.useState("");
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
          issues: ["请完善章节标题、图片地址和内容块配置"],
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
      if (file.size > 1024 * 1024) throw new Error("模板文件不能超过 1 MB");
      const parsed = survey.SurveyReportTemplateSchema.safeParse(
        JSON.parse(await file.text()),
      );
      if (!parsed.success)
        throw new Error("模板格式不正确，请检查章节、内容块和数据配置");
      if (!window.confirm("导入将替换当前模板，是否继续？")) return;
      onChange(parsed.data);
      setSelected(parsed.data.sections[0]?.id);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "模板导入失败");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  return (
    <div className="min-w-0 bg-muted/30" data-testid="survey-flexible-template">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card p-4">
        <label className="min-w-48 flex-1 text-11 text-muted-foreground">
          报告标题
          <Input
            aria-label="报告标题"
            value={template.title}
            readOnly={readonly}
            onChange={(e) => onChange({ ...template, title: e.target.value })}
          />
        </label>
        <Button variant="outline" onClick={() => setPreview(!preview)}>
          {preview ? "返回编辑" : "预览完整报告"}
        </Button>
        <Button variant="outline" onClick={download}>
          导出模板
        </Button>
        {!readonly && (
          <>
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
            >
              导入模板
            </Button>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="application/json,.json"
              aria-label="导入模板文件"
              onChange={(e) => void importFile(e.target.files?.[0])}
            />
          </>
        )}
      </div>
      {compiled.issues.length > 0 && (
        <p className="px-4 pt-3 text-11 text-warning">
          部分内容块需要配置或补充数据，请检查对应内容块。
        </p>
      )}
      {error && (
        <p role="alert" className="p-4 text-12 text-destructive">
          {error}
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
              报告章节 · {template.sections.length}
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
                    {i + 1}. {item.title || "未命名章节"}
                    <span className="mt-1 block text-10 text-muted-foreground">
                      {item.blocks.length} 个内容块
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
                      { id, title: "新章节", blocks: [] },
                    ],
                  });
                  setSelected(id);
                }}
              >
                新增章节
              </Button>
            )}
          </aside>
          <div className="min-w-0 p-4 lg:p-6">
            {!section ? (
              <p className="py-16 text-center text-muted-foreground">
                添加章节，开始设计报告。
              </p>
            ) : (
              <>
                <div className="mb-5 flex flex-wrap items-end gap-2">
                  <label className="min-w-48 flex-1 text-11 text-muted-foreground">
                    章节标题
                    <Input
                      aria-label="章节标题"
                      value={section.title}
                      readOnly={readonly}
                      onChange={(e) => updateSection({ title: e.target.value })}
                    />
                  </label>
                  {!readonly && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => {
                          const copy = copySection(section);
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
                      >
                        复制章节
                      </Button>
                      <Button
                        variant="outline"
                        aria-label="章节上移"
                        disabled={index === 0}
                        onClick={() =>
                          onChange({
                            ...template,
                            sections: moveItem(template.sections, index, -1),
                          })
                        }
                      >
                        上移
                      </Button>
                      <Button
                        variant="outline"
                        aria-label="章节下移"
                        disabled={index === template.sections.length - 1}
                        onClick={() =>
                          onChange({
                            ...template,
                            sections: moveItem(template.sections, index, 1),
                          })
                        }
                      >
                        下移
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (window.confirm("删除此章节及其中的内容块？"))
                            onChange({
                              ...template,
                              sections: template.sections.filter(
                                (item) => item.id !== section.id,
                              ),
                            });
                        }}
                      >
                        删除章节
                      </Button>
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
                          {i + 1} · {BLOCK_LABELS[block.type]}
                        </span>
                        {!readonly && (
                          <>
                            <Button
                              size="xs"
                              variant="ghost"
                              aria-label={`内容块 ${i + 1} 上移`}
                              disabled={i === 0}
                              onClick={() =>
                                updateSection({
                                  blocks: moveItem(section.blocks, i, -1),
                                })
                              }
                            >
                              上移
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              aria-label={`内容块 ${i + 1} 下移`}
                              disabled={i === section.blocks.length - 1}
                              onClick={() =>
                                updateSection({
                                  blocks: moveItem(section.blocks, i, 1),
                                })
                              }
                            >
                              下移
                            </Button>
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
                            >
                              复制
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                if (window.confirm("删除这个内容块？"))
                                  updateSection({
                                    blocks: section.blocks.filter(
                                      (item) => item.id !== block.id,
                                    ),
                                  });
                              }}
                            >
                              删除
                            </Button>
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
                            {issue}
                          </p>
                        ))}
                    </div>
                  ))}
                </div>
                {!readonly && (
                  <div className="mt-5 rounded-lg border border-dashed border-border p-4">
                    <p className="mb-3 text-12 font-medium">添加内容块</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(BLOCK_LABELS).map(([type, label]) => (
                        <Button
                          key={type}
                          size="sm"
                          variant="outline"
                          aria-label={`添加${label}`}
                          onClick={() =>
                            updateSection({
                              blocks: [
                                ...section.blocks,
                                newBlock(
                                  type as survey.SurveyReportBlock["type"],
                                ),
                              ],
                            })
                          }
                        >
                          {label}
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
  const data = !["text", "image", "page-break"].includes(block.type);
  return (
    <div className="space-y-3">
      {block.type !== "page-break" && (
        <label className="block text-11 text-muted-foreground">
          内容标题
          <Input
            aria-label="内容标题"
            value={block.title}
            readOnly={readonly}
            onChange={(e) => update({ title: e.target.value })}
          />
        </label>
      )}
      {block.type === "text" && (
        <label className="block text-11 text-muted-foreground">
          正文
          <Textarea
            aria-label="正文"
            rows={5}
            value={block.text ?? ""}
            readOnly={readonly}
            onChange={(e) => update({ text: e.target.value })}
          />
        </label>
      )}
      {block.type === "image" && (
        <label className="block text-11 text-muted-foreground">
          图片地址（HTTPS）
          <Input
            aria-label="图片地址"
            value={block.imageUrl ?? ""}
            readOnly={readonly}
            placeholder="https://…"
            onChange={(e) => update({ imageUrl: e.target.value })}
          />
        </label>
      )}
      {block.type === "page-break" && (
        <p className="text-12 text-muted-foreground">导出时从下一页开始。</p>
      )}
      {data && (
        <>
          <fieldset
            disabled={readonly}
            className="rounded-md border border-border p-3"
          >
            <legend className="px-1 text-11">绑定题目（可多选）</legend>
            <div className="grid max-h-48 gap-2 overflow-auto sm:grid-cols-2">
              {questions.map((q) => (
                <label key={q.id} className="flex items-start gap-2 text-11">
                  <input
                    type="checkbox"
                    checked={block.questionIds.includes(q.id)}
                    onChange={(e) =>
                      update({
                        questionIds: e.target.checked
                          ? [...block.questionIds, q.id]
                          : block.questionIds.filter((id) => id !== q.id),
                      })
                    }
                  />
                  <span>
                    {q.order}. {q.title}
                  </span>
                </label>
              ))}
              {questions.length === 0 && (
                <p className="text-11 text-muted-foreground">
                  请先添加问卷题目。
                </p>
              )}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-11 text-muted-foreground">
              统计口径
              <select
                aria-label="统计口径"
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
                <option value="mean">量表均值</option>
                <option value="count">答题人数</option>
                <option value="distribution">选项分布</option>
              </select>
            </label>
            <label className="text-11 text-muted-foreground">
              分组题目
              <select
                aria-label="分组题目"
                className={selectStyle}
                disabled={readonly}
                value={block.groupByQuestionId ?? ""}
                onChange={(e) =>
                  update({ groupByQuestionId: e.target.value || undefined })
                }
              >
                <option value="">不分组</option>
                {questions
                  .filter((q) => q.type === "single")
                  .map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-11 text-muted-foreground">
              样本范围
              <select
                aria-label="样本范围"
                className={selectStyle}
                disabled={readonly}
                value={block.samplePolicy}
                onChange={(e) =>
                  update({ samplePolicy: e.target.value as "valid" | "all" })
                }
              >
                <option value="valid">已通过复核</option>
                <option value="all">全部答卷</option>
              </select>
            </label>
            <label className="text-11 text-muted-foreground">
              最小分组样本
              <Input
                type="number"
                min={5}
                max={1000}
                aria-label="最小分组样本"
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
              <label className="text-11 text-muted-foreground">
                目标值
                <Input
                  type="number"
                  aria-label="目标值"
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
        <label className="block text-11 text-muted-foreground">
          说明 / 图注
          <Input
            aria-label="说明 / 图注"
            value={block.caption ?? ""}
            readOnly={readonly}
            onChange={(e) => update({ caption: e.target.value })}
          />
        </label>
      )}
    </div>
  );
}
