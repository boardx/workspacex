import { z } from "zod";
import type { SurveyResponse, SurveyWorkflowQuestion } from "./survey";

const imageUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }, "图片必须使用不含凭据的 HTTPS URL");
export const SurveyReportBlockSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  type: z.enum([
    "text",
    "metric",
    "table",
    "bar",
    "radar",
    "line",
    "gap",
    "image",
    "page-break",
  ]),
  questionIds: z.array(z.string().min(1)).default([]),
  statistic: z.enum(["mean", "count", "distribution"]).default("mean"),
  groupByQuestionId: z.string().min(1).optional(),
  target: z.number().finite().optional(),
  text: z.string().optional(),
  imageUrl: imageUrl.optional(),
  caption: z.string().optional(),
  samplePolicy: z.enum(["valid", "all"]).default("valid"),
  minGroupSize: z.number().int().min(5).default(5),
});
export const SurveyReportTemplateSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    sections: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        blocks: z.array(SurveyReportBlockSchema),
      }),
    ),
  })
  .superRefine((template, ctx) => {
    const ids = new Set([template.id]);
    for (const [si, section] of template.sections.entries()) {
      for (const [id, path] of [
        [section.id, ["sections", si, "id"]],
        ...section.blocks.map((block, bi) => [
          block.id,
          ["sections", si, "blocks", bi, "id"],
        ]),
      ] as [string, (string | number)[]][]) {
        if (ids.has(id))
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "报告 ID 必须唯一",
            path,
          });
        ids.add(id);
      }
      section.blocks.forEach((block, bi) => {
        if (new Set(block.questionIds).size !== block.questionIds.length)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "题目引用不能重复",
            path: ["sections", si, "blocks", bi, "questionIds"],
          });
      });
    }
  });
export type SurveyReportTemplate = z.infer<typeof SurveyReportTemplateSchema>;
export type SurveyReportBlock = z.infer<typeof SurveyReportBlockSchema>;
export const SurveyReportRowSchema = z.object({
  label: z.string(),
  value: z.number().finite(),
  count: z.number().int().nonnegative(),
  target: z.number().finite().optional(),
  gap: z.number().finite().optional(),
  group: z.string().optional(),
});
export const CompiledSurveyBlockSchema = SurveyReportBlockSchema.extend({
  rows: z.array(SurveyReportRowSchema),
  issues: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});
export const CompiledSurveyReportSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sections: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      blocks: z.array(CompiledSurveyBlockSchema),
    }),
  ),
  issues: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});
export type SurveyReportRow = z.infer<typeof SurveyReportRowSchema>;
export type CompiledSurveyBlock = z.infer<typeof CompiledSurveyBlockSchema>;
export type CompiledSurveyReport = z.infer<typeof CompiledSurveyReportSchema>;

function selections(
  question: SurveyWorkflowQuestion,
  response: SurveyResponse,
): string[] {
  const answers = response.answers.filter(
    (answer) => answer.questionId === question.id,
  );
  if (answers.length !== 1) return [];
  const value = answers[0]!.value;
  if (question.type === "open")
    return typeof value === "string" && value.trim() ? [value] : [];
  if (question.type !== "multi" && typeof value !== "string") return [];
  return [...new Set(Array.isArray(value) ? value : [value])].filter((v) =>
    question.options.includes(v),
  );
}
function compileBlock(
  block: SurveyReportBlock,
  questions: SurveyWorkflowQuestion[],
  responses: SurveyResponse[],
): CompiledSurveyBlock {
  const result: CompiledSurveyBlock = {
    ...block,
    rows: [],
    issues: [],
    warnings: [],
  };
  const issue = (message: string) => {
    if (!result.issues.includes(message)) result.issues.push(message);
  };
  if (["text", "image", "page-break"].includes(block.type)) {
    if (block.type === "text" && !block.text?.trim()) issue("文本内容为空");
    if (block.type === "image" && !block.imageUrl) issue("尚未配置图片 URL");
    return result;
  }
  const selected = block.questionIds.map((id) =>
    questions.find((q) => q.id === id),
  );
  if (!selected.length) issue("尚未选择题目");
  if (selected.some((q) => !q)) issue("引用的题目不存在，请重新绑定");
  if (block.type === "gap" && block.target === undefined) {
    issue("缺少目标基准，无法计算差距");
    return result;
  }
  if (block.type === "gap" && block.statistic !== "mean") {
    issue("差距图仅支持量表均值");
    return result;
  }
  if (block.type === "radar") {
    const axes = selected.filter((q): q is SurveyWorkflowQuestion => !!q);
    const domain = (q: SurveyWorkflowQuestion) =>
      [...q.options].sort().join("\u0000");
    if (
      axes.length < 3 ||
      block.statistic !== "mean" ||
      axes.some(
        (q) =>
          q.type !== "scale" ||
          domain(q) !== domain(axes[0]!) ||
          q.options.some((v) => !v.trim() || !Number.isFinite(Number(v))),
      )
    ) {
      issue("雷达图需要至少三个同量纲的量表题目，并使用均值");
      return result;
    }
  }
  const groupQuestion = block.groupByQuestionId
    ? questions.find((q) => q.id === block.groupByQuestionId)
    : undefined;
  if (
    block.groupByQuestionId &&
    (!groupQuestion || groupQuestion.type !== "single")
  ) {
    issue("分组题目必须是存在的单选题");
    return result;
  }
  const samples = responses.filter(
    (r) => block.samplePolicy === "all" || r.quality === "normal",
  );
  if (!samples.length) issue("没有可用样本");
  for (const question of selected) {
    if (!question) continue;
    const displayTitle =
      questions.filter((q) => q.title === question.title).length > 1
        ? `${question.title}（${question.id}）`
        : question.title;
    if (block.statistic === "mean" && question.type !== "scale") {
      issue(`${question.title}：均值仅适用于量表题目`);
      continue;
    }
    if (block.statistic === "distribution" && question.type === "open") {
      issue(`${question.title}：开放题不支持选项分布`);
      continue;
    }
    const buckets = new Map<
      string,
      { group?: string; date?: string; values: string[][] }
    >();
    for (const sample of samples) {
      const values = selections(question, sample).filter(
        (v) =>
          block.statistic !== "mean" ||
          (v.trim() !== "" && Number.isFinite(Number(v))),
      );
      if (!values.length) continue;
      const group = groupQuestion
        ? selections(groupQuestion, sample)[0]
        : undefined;
      if (groupQuestion && !group) continue;
      const date =
        block.type === "line"
          ? Number.isFinite(Date.parse(sample.submittedAt))
            ? new Date(sample.submittedAt).toISOString().slice(0, 10)
            : undefined
          : undefined;
      if (block.type === "line" && !date) {
        issue("存在无效提交时间，已排除");
        continue;
      }
      const key = JSON.stringify([group, date]);
      const bucket = buckets.get(key) ?? { group, date, values: [] };
      bucket.values.push(values);
      buckets.set(key, bucket);
    }
    if (!buckets.size) issue(`${question.title}：没有合法作答样本`);
    for (const bucket of [...buckets.values()].sort(
      (a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        (a.group ?? "").localeCompare(b.group ?? ""),
    )) {
      if (groupQuestion && bucket.values.length < block.minGroupSize) {
        const warning = `分组有效样本不足 ${block.minGroupSize}，已隐藏`;
        if (!result.warnings!.includes(warning)) result.warnings!.push(warning);
        continue;
      }
      const label = bucket.date ?? displayTitle;
      const group = bucket.date
        ? [displayTitle, bucket.group].filter(Boolean).join(" · ")
        : bucket.group;
      const append = (row: SurveyReportRow) =>
        result.rows.push({ ...row, ...(group ? { group } : {}) });
      if (block.statistic === "distribution") {
        for (const option of [...new Set(question.options)]) {
          const count = bucket.values.filter((values) =>
            values.includes(option),
          ).length;
          if (bucket.date)
            result.rows.push({
              label,
              value: count,
              count,
              group: `${group} · ${option}`,
            });
          else append({ label: `${label} · ${option}`, value: count, count });
        }
      } else {
        const count = bucket.values.length;
        const value =
          block.statistic === "count"
            ? count
            : bucket.values.reduce(
                (sum, values) => sum + Number(values[0]) / count,
                0,
              );
        if (!Number.isFinite(value)) {
          issue("统计值超出有限数值范围");
          continue;
        }
        const gap =
          block.target === undefined ? undefined : block.target - value;
        if (gap !== undefined && !Number.isFinite(gap)) {
          issue("差距超出有限数值范围");
          continue;
        }
        append({
          label,
          value,
          count,
          ...(block.type === "gap" ? { target: block.target, gap } : {}),
        });
      }
    }
  }
  if (block.type === "radar") {
    const groups = new Set(result.rows.map((row) => row.group));
    for (const group of groups) {
      if (
        result.rows.filter((row) => row.group === group).length !==
        selected.length
      ) {
        result.rows = result.rows.filter((row) => row.group !== group);
        issue("雷达图存在无样本轴，已隐藏不完整比较");
      }
    }
  }
  if (!result.rows.length) issue("没有可用于图表的合法作答样本");
  return result;
}
/** Pure compiler: no clock, network, random values, or generated narrative. */
export function compileSurveyReport(
  template: SurveyReportTemplate,
  questions: SurveyWorkflowQuestion[],
  responses: SurveyResponse[],
): CompiledSurveyReport {
  const parsed = SurveyReportTemplateSchema.parse(template);
  const sections = parsed.sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) =>
      compileBlock(block, questions, responses),
    ),
  }));
  const issues = sections.flatMap((section) =>
    section.blocks.flatMap((block) =>
      block.issues.map(
        (issue) => `${section.title} / ${block.title}：${issue}`,
      ),
    ),
  );
  if (!sections.length) issues.push("报告没有章节");
  for (const section of sections) {
    if (
      !section.blocks.some(
        (block) =>
          block.rows.length ||
          (block.type === "text" && block.text?.trim()) ||
          (block.type === "image" && block.imageUrl),
      )
    ) {
      issues.push(`${section.title}：章节没有可生成的内容`);
    }
  }
  return {
    id: parsed.id,
    title: parsed.title,
    sections,
    issues,
    warnings: sections.flatMap((section) =>
      section.blocks.flatMap((block) =>
        (block.warnings ?? []).map(
          (warning) => `${section.title} / ${block.title}：${warning}`,
        ),
      ),
    ),
  };
}
