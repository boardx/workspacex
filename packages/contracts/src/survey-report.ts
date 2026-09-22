import { z } from "zod";
import { analyzeSurveySection } from "./survey-report-analysis";
import type { SurveyResponse, SurveyWorkflowQuestion } from "./survey";
import {
  surveyChoices,
  surveyQuestionStatistics,
  surveySelectedValues,
  validateSurveyAnswer,
  visibleSurveyQuestions,
  formatSurveyAnswer,
  type SurveyAnswerValue,
} from "./survey-question-types";

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
  statistic: z
    .enum([
      "mean",
      "count",
      "distribution",
      "nps",
      "mean_rank",
      "first_choice",
      "sum",
      "responses",
      "percentage",
    ])
    .default("mean"),
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
        interpretation: z.boolean().optional(),
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
  answerTexts: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .optional(),
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
      analysis: z.array(z.object({ title: z.string(), evidence: z.string(), action: z.string(), blockIds: z.array(z.string()) })).optional(),
    }),
  ),
  issues: z.array(z.string()),
  warnings: z.array(z.string()).optional(),
});
export type SurveyReportRow = z.infer<typeof SurveyReportRowSchema>;
export type CompiledSurveyBlock = z.infer<typeof CompiledSurveyBlockSchema>;
export type CompiledSurveyReport = z.infer<typeof CompiledSurveyReportSchema>;

type Projection = {
  key: string;
  label: string;
  values: string[];
  numeric?: number;
  options: { id: string; label: string }[];
};
function hasAnswer(
  value: SurveyAnswerValue | undefined,
): value is SurveyAnswerValue {
  return (
    value !== undefined &&
    (typeof value === "string"
      ? !!value.trim()
      : Array.isArray(value)
        ? !!value.length
        : Object.values(value).some((v) =>
            Array.isArray(v) ? v.length > 0 : !!v.trim(),
          ))
  );
}
function acceptedAnswer(
  question: SurveyWorkflowQuestion,
  value: SurveyAnswerValue | undefined,
): SurveyAnswerValue | undefined {
  if (!hasAnswer(value)) return undefined;
  // Historical selections were label-based and tolerated repeated/invalid list items.
  // Retain that read behavior; current submission validation rejects those inputs.
  if (
    !question.config &&
    ["single", "multi", "scale", "open"].includes(question.type)
  ) {
    if (question.type === "open")
      return typeof value === "string" ? value : undefined;
    if (question.type === "multi")
      return Array.isArray(value)
        ? [...new Set(value.filter((v) => question.options.includes(v)))]
        : undefined;
    return typeof value === "string" && question.options.includes(value)
      ? value
      : undefined;
  }
  return validateSurveyAnswer(question, value).length ? undefined : value;
}
function project(
  question: SurveyWorkflowQuestion,
  value: SurveyAnswerValue,
  title: string,
): Projection[] {
  const options = surveyChoices(question),
    canonical = (raw: string) =>
      options.find((option) => option.id === raw || option.label === raw)?.id ??
      raw;
  const numeric = (raw: string) =>
    Number(
      options.find((option) => option.id === raw || option.label === raw)
        ?.label ?? raw,
    );
  const base = { key: question.id, label: title, options };
  if (
    question.type.startsWith("matrix_") &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    return (question.config?.rows ?? []).flatMap((row) => {
      const raw = value[row.id];
      if (!hasAnswer(raw)) return [];
      const values = (Array.isArray(raw) ? raw : [raw as string]).map(
        canonical,
      );
      return [
        {
          ...base,
          key: `${question.id}/${row.id}`,
          label: `${title} · ${row.label}`,
          values,
          ...(question.type === "matrix_scale"
            ? { numeric: numeric(values[0]!) }
            : {}),
        },
      ];
    });
  if (question.type === "ranking" && Array.isArray(value)) {
    const ordered = value.map(canonical);
    return options.map((option) => ({
      ...base,
      key: `${question.id}/${option.id}`,
      label: `${title} · ${option.label}`,
      values: [option.id],
      options: [],
      numeric: ordered.indexOf(option.id) + 1,
    }));
  }
  if (
    question.type === "allocation" &&
    typeof value === "object" &&
    !Array.isArray(value)
  )
    return options.flatMap((option) => {
      const raw = value[option.id];
      return typeof raw === "string" && raw.trim()
        ? [
            {
              ...base,
              key: `${question.id}/${option.id}`,
              label: `${title} · ${option.label}`,
              values: [raw],
              options: [],
              numeric: Number(raw),
            },
          ]
        : [];
    });
  const values = surveySelectedValues(question, value);
  if (!values.length && typeof value === "object" && !Array.isArray(value))
    return [{ ...base, values: [formatSurveyAnswer(question, value)] }];
  return [
    {
      ...base,
      values,
      ...(["scale", "number", "rating", "nps", "slider"].includes(question.type)
        ? { numeric: numeric(values[0]!) }
        : {}),
    },
  ];
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
      q.type === "scale"
        ? [...q.options].sort().join("\u0000")
        : JSON.stringify([q.config?.min, q.config?.max, q.config?.step]);
    if (
      axes.length < 3 ||
      block.statistic !== "mean" ||
      axes.some(
        (q) =>
          !["scale", "rating", "slider", "nps"].includes(q.type) ||
          domain(q) !== domain(axes[0]!) ||
          (q.type === "scale" &&
            q.options.some((v) => !v.trim() || !Number.isFinite(Number(v)))),
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
    (!groupQuestion ||
      !["single", "dropdown", "image_single"].includes(groupQuestion.type))
  ) {
    issue("分组题目必须是存在的单选题");
    return result;
  }
  const samples = responses
    .filter((r) => block.samplePolicy === "all" || r.quality === "normal")
    .map((sample) => {
      const counts = new Map<string, number>();
      sample.answers.forEach((answer) =>
        counts.set(answer.questionId, (counts.get(answer.questionId) ?? 0) + 1),
      );
      const answers = Object.fromEntries(
        sample.answers
          .filter((answer) => counts.get(answer.questionId) === 1)
          .map((answer) => [answer.questionId, answer.value]),
      );
      return {
        sample,
        answers,
        visible: new Set(
          visibleSurveyQuestions(questions, answers).map((q) => q.id),
        ),
      };
    });
  if (!samples.length) issue("没有可用样本");
  for (const question of selected) {
    if (!question) continue;
    const title =
      questions.filter((q) => q.title === question.title).length > 1
        ? `${question.title}（${question.id}）`
        : question.title;
    if (!surveyQuestionStatistics(question).includes(block.statistic)) {
      issue(
        `${title}：此题型不支持${block.statistic === "mean" ? "均值" : block.statistic === "distribution" ? "选项分布" : "该统计方式"}`,
      );
      continue;
    }
    type Bucket = {
      group?: string;
      date?: string;
      label: string;
      options: { id: string; label: string }[];
      values: Projection[];
      texts: string[];
    };
    const buckets = new Map<string, Bucket>();
    for (const { sample, answers, visible } of samples) {
      if (!visible.has(question.id)) continue;
      const answer = acceptedAnswer(question, answers[question.id]);
      if (!hasAnswer(answer)) continue;
      let group: string | undefined;
      if (groupQuestion) {
        if (!visible.has(groupQuestion.id)) continue;
        const raw = acceptedAnswer(groupQuestion, answers[groupQuestion.id]);
        if (!hasAnswer(raw)) continue;
        group = formatSurveyAnswer(groupQuestion, raw);
      }
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
      const projections =
        block.statistic === "responses"
          ? [{ key: question.id, label: title, values: [], options: [] }]
          : project(question, answer, title);
      for (const projection of projections) {
        if (block.statistic !== "responses" && !projection.values.length)
          continue;
        if (
          ["mean", "sum", "nps", "mean_rank", "first_choice"].includes(
            block.statistic,
          ) &&
          !Number.isFinite(projection.numeric)
        )
          continue;
        const key = JSON.stringify([projection.key, group, date]);
        const bucket = buckets.get(key) ?? {
          group,
          date,
          label: projection.label,
          options: projection.options,
          values: [],
          texts: [],
        };
        bucket.values.push(projection);
        if (block.statistic === "responses")
          bucket.texts.push(
            ["file", "signature"].includes(question.type)
              ? `附件 ${Array.isArray(answer) ? answer.length : 0} 个`
              : formatSurveyAnswer(question, answer),
          );
        buckets.set(key, bucket);
      }
    }
    if (!buckets.size) issue(`${title}：没有合法作答样本`);
    for (const bucket of [...buckets.values()].sort(
      (a, b) =>
        (a.date ?? "").localeCompare(b.date ?? "") ||
        (a.group ?? "").localeCompare(b.group ?? ""),
    )) {
      const count = bucket.values.length;
      if (groupQuestion && count < block.minGroupSize) {
        const warning = `分组有效样本不足 ${block.minGroupSize}，已隐藏`;
        if (!result.warnings!.includes(warning)) result.warnings!.push(warning);
        continue;
      }
      const label = bucket.date ?? bucket.label;
      const group = bucket.date
        ? [bucket.label, bucket.group].filter(Boolean).join(" · ")
        : bucket.group;
      const append = (row: SurveyReportRow) =>
        result.rows.push({ ...row, ...(group ? { group } : {}) });
      if (block.statistic === "responses") {
        result.answerTexts ??= [];
        bucket.texts.forEach((value) =>
          result.answerTexts!.push({
            label: [label, group].filter(Boolean).join(" · "),
            value,
          }),
        );
        continue;
      }
      if (
        block.statistic === "distribution" ||
        block.statistic === "percentage"
      ) {
        const options = bucket.options.length
          ? [...bucket.options]
          : [...new Set(bucket.values.flatMap((row) => row.values))]
              .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
              .map((value) => ({ id: value, label: value }));
        if (bucket.values.some((row) => row.values.includes("__other__")))
          options.push({ id: "__other__", label: "其他" });
        for (const option of options) {
          const count = bucket.values.filter((row) =>
            row.values.includes(option.id),
          ).length;
          const value =
            block.statistic === "percentage"
              ? (100 * count) / bucket.values.length
              : count;
          if (bucket.date)
            result.rows.push({
              label,
              value,
              count,
              group: `${group} · ${option.label}`,
            });
          else append({ label: `${label} · ${option.label}`, value, count });
        }
        continue;
      }
      const numbers = bucket.values.map((row) => row.numeric!);
      let value = count;
      if (block.statistic === "nps")
        value =
          (100 *
            (numbers.filter((n) => n >= 9).length -
              numbers.filter((n) => n <= 6).length)) /
          count;
      else if (block.statistic === "first_choice")
        value = (100 * numbers.filter((n) => n === 1).length) / count;
      else if (block.statistic === "sum")
        value = numbers.reduce((sum, n) => sum + n, 0);
      else if (block.statistic === "mean" || block.statistic === "mean_rank")
        value = numbers.reduce((sum, n) => sum + n / count, 0);
      if (!Number.isFinite(value)) {
        issue("统计值超出有限数值范围");
        continue;
      }
      const gap = block.target === undefined ? undefined : block.target - value;
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
  if (block.type === "radar")
    for (const group of new Set(result.rows.map((row) => row.group)))
      if (
        result.rows.filter((row) => row.group === group).length !==
        selected.length
      ) {
        result.rows = result.rows.filter((row) => row.group !== group);
        issue("雷达图存在无样本轴，已隐藏不完整比较");
      }
  if (!result.rows.length && !result.answerTexts?.length)
    issue("没有可用于图表的合法作答样本");
  return result;
}
/** Pure compiler: no clock, network or random values; interpretations use validated aggregates. */
export function compileSurveyReport(
  template: SurveyReportTemplate,
  questions: SurveyWorkflowQuestion[],
  responses: SurveyResponse[],
): CompiledSurveyReport {
  const parsed = SurveyReportTemplateSchema.parse(template);
  const sections = parsed.sections.map((section) => {
    const blocks = section.blocks.map((block) => compileBlock(block, questions, responses));
    return { ...section, blocks, analysis: section.interpretation === false ? [] : analyzeSurveySection(blocks, questions) };
  });
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
          block.answerTexts?.length ||
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
