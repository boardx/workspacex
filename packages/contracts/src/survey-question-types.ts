import { z } from "zod";

export const SurveyQuestionTypeSchema = z.enum([
  "single",
  "multi",
  "scale",
  "open",
  "dropdown",
  "image_single",
  "image_multi",
  "short",
  "multiple_text",
  "number",
  "date",
  "time",
  "datetime",
  "email",
  "phone",
  "address",
  "cascade",
  "rating",
  "nps",
  "slider",
  "matrix_single",
  "matrix_multi",
  "matrix_scale",
  "matrix_input",
  "matrix_dropdown",
  "ranking",
  "allocation",
  "file",
  "signature",
  "description",
  "page_break",
]);
export type SurveyQuestionType = z.infer<typeof SurveyQuestionTypeSchema>;
export const SURVEY_UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
export const SURVEY_UPLOAD_MAX_FILES = 10;
export const SURVEY_UPLOAD_ALLOWED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "pdf",
  "txt",
  "csv",
  "md",
] as const;
const shortString = z.string().max(2000);
const stringList = z.array(shortString).max(200);
export const SurveyAnswerValueSchema = z.union([
  z.string().max(20000),
  stringList,
  z
    .record(z.union([z.string().max(20000), stringList]))
    .refine((value) => Object.keys(value).length <= 200, "答案字段过多"),
]);
export type SurveyAnswerValue = z.infer<typeof SurveyAnswerValueSchema>;
const field = z.object({
  id: z.string().min(1).max(200),
  label: z.string().min(1).max(2000),
  required: z.boolean().optional(),
});
export const SurveyQuestionConfigSchema = z.object({
  description: z.string().max(20000).optional(),
  optionIds: z.array(z.string().min(1).max(200)).max(100).optional(),
  images: z
    .record(z.object({ url: z.string().max(2048), alt: z.string().max(2000) }))
    .optional(),
  rows: z.array(field).max(100).optional(),
  fields: z.array(field).max(100).optional(),
  cascadePaths: z
    .array(z.array(z.string().min(1).max(2000)).min(1).max(10))
    .max(100)
    .optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  minLength: z.number().int().min(0).max(20000).optional(),
  maxLength: z.number().int().min(0).max(20000).optional(),
  minSelections: z.number().int().nonnegative().max(100).optional(),
  maxSelections: z.number().int().positive().max(100).optional(),
  total: z.number().finite().nonnegative().optional(),
  unit: z.string().max(100).optional(),
  lowLabel: shortString.optional(),
  highLabel: shortString.optional(),
  other: z.boolean().optional(),
  exclusiveOptionIds: z.array(z.string()).max(100).optional(),
  shuffleOptions: z.boolean().optional(),
  visibleWhen: z
    .array(
      z.object({
        questionId: z.string().min(1),
        operator: z.enum(["equals", "notEquals", "includes"]),
        value: z.string().max(2000),
      }),
    )
    .max(100)
    .optional(),
  jumpTo: z
    .array(
      z.object({ optionId: z.string().min(1), targetId: z.string().min(1) }),
    )
    .max(100)
    .optional(),
  maxFiles: z.number().int().min(1).max(SURVEY_UPLOAD_MAX_FILES).optional(),
  maxFileBytes: z
    .number()
    .int()
    .positive()
    .max(SURVEY_UPLOAD_MAX_BYTES)
    .optional(),
  allowedExtensions: z
    .array(z.enum(SURVEY_UPLOAD_ALLOWED_EXTENSIONS))
    .min(1)
    .max(SURVEY_UPLOAD_ALLOWED_EXTENSIONS.length)
    .optional(),
});
export const SurveyWorkflowQuestionSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().positive(),
  chapterId: z.string(),
  type: SurveyQuestionTypeSchema,
  title: z.string().min(1),
  required: z.boolean(),
  options: z.array(z.string().min(1)).default([]),
  config: SurveyQuestionConfigSchema.optional(),
  provenance: z
    .object({
      source: z.enum(["question-library", "template", "manual"]),
      sourceId: z.string().min(1).max(200).optional(),
      certifiedAt: z.string().datetime().optional(),
    })
    .optional(),
});
export type SurveyWorkflowQuestion = z.infer<
  typeof SurveyWorkflowQuestionSchema
>;
const registry: [SurveyQuestionType, string, string, string][] = [
  ["single", "单选", "选择", "选择一个选项"],
  ["multi", "多选", "选择", "选择多个选项"],
  ["dropdown", "下拉选择", "选择", "从下拉列表选择"],
  ["image_single", "图片单选", "选择", "选择一张图片"],
  ["image_multi", "图片多选", "选择", "选择多张图片"],
  ["short", "单行文本", "输入", "简短文字回答"],
  ["open", "多行文本", "输入", "详细文字回答"],
  ["multiple_text", "多项填空", "输入", "分别填写多个字段"],
  ["number", "数字", "输入", "有范围的数值"],
  ["date", "日期", "输入", "选择有效日期"],
  ["time", "时间", "输入", "选择一天中的时间"],
  ["datetime", "日期时间", "输入", "填写日期和时间"],
  ["email", "邮箱", "输入", "填写邮箱地址"],
  ["phone", "手机", "输入", "填写联系电话"],
  ["address", "地址", "输入", "分字段填写地址"],
  ["cascade", "级联选择", "输入", "逐级选择完整路径"],
  ["scale", "量表", "评分", "选择一个量表分值"],
  ["rating", "星级评分", "评分", "星级满意程度"],
  ["nps", "NPS", "评分", "0至10分推荐意愿"],
  ["slider", "滑块", "评分", "在数值范围中选择"],
  ["matrix_single", "矩阵单选", "矩阵", "每行选择一个选项"],
  ["matrix_multi", "矩阵多选", "矩阵", "每行选择多个选项"],
  ["matrix_scale", "矩阵量表", "矩阵", "逐行评分"],
  ["matrix_input", "矩阵填空", "矩阵", "逐行填写文字"],
  ["matrix_dropdown", "矩阵下拉", "矩阵", "逐行下拉选择"],
  ["ranking", "排序", "比较", "按优先顺序排列"],
  ["allocation", "比重分配", "比较", "按固定总额分配"],
  ["file", "文件上传", "材料", "提交附件引用"],
  ["signature", "签名", "材料", "提交签名图片引用"],
  ["description", "说明文字/图片", "页面元素", "不收集答案的说明"],
  ["page_break", "分节与分页", "页面元素", "将长问卷分成页面"],
];
export const SURVEY_QUESTION_TYPES = registry.map(
  ([type, label, category, description]) => ({
    type,
    label,
    category,
    description,
  }),
);
export const SURVEY_OTHER_OPTION_ID = "__other__";
export const isSurveyPageElement = (q: SurveyWorkflowQuestion) =>
  q.type === "description" || q.type === "page_break";
const multiTypes = new Set<SurveyQuestionType>([
  "multi",
  "image_multi",
  "matrix_multi",
]);
const choiceTypes = new Set<SurveyQuestionType>([
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
]);
const numericTypes = new Set<SurveyQuestionType>([
  "number",
  "rating",
  "nps",
  "slider",
  "scale",
]);
const textTypes = new Set<SurveyQuestionType>([
  "short",
  "open",
  "email",
  "phone",
  "date",
  "time",
  "datetime",
]);
export function surveyChoices(
  q: SurveyWorkflowQuestion,
): { id: string; label: string }[] {
  return q.options.map((label, i) => ({
    id: q.config?.optionIds?.[i] ?? label,
    label,
  }));
}
export function createSurveyQuestion(
  type: SurveyQuestionType,
  id: string,
  order: number,
): SurveyWorkflowQuestion {
  const q: SurveyWorkflowQuestion = {
    id,
    order,
    chapterId: "general",
    type,
    title: SURVEY_QUESTION_TYPES.find((item) => item.type === type)!.label,
    required: !["description", "page_break"].includes(type),
    options: [],
  };
  const c: NonNullable<SurveyWorkflowQuestion["config"]> = {};
  if (choiceTypes.has(type)) {
    q.options = ["选项一", "选项二"];
    if (type === "scale" || type === "matrix_scale")
      q.options = ["1", "2", "3", "4", "5"];
    c.optionIds = q.options.map((_, i) => `${id}-option-${i + 1}`);
  }
  if (type.startsWith("matrix_"))
    c.rows = [
      { id: `${id}-row-1`, label: "项目一" },
      { id: `${id}-row-2`, label: "项目二" },
    ];
  if (type === "multiple_text")
    c.fields = [
      { id: `${id}-field-1`, label: "字段一", required: true },
      { id: `${id}-field-2`, label: "字段二", required: true },
    ];
  if (type === "address")
    c.fields = [
      { id: `${id}-province`, label: "省/地区", required: true },
      { id: `${id}-city`, label: "城市", required: true },
      { id: `${id}-detail`, label: "详细地址", required: true },
    ];
  if (type === "cascade")
    c.cascadePaths = [
      ["区域一", "城市一"],
      ["区域一", "城市二"],
      ["区域二", "城市三"],
    ];
  if (type === "rating") Object.assign(c, { min: 1, max: 5, step: 1 });
  if (type === "nps") Object.assign(c, { min: 0, max: 10, step: 1 });
  if (type === "slider") Object.assign(c, { min: 0, max: 100, step: 1 });
  if (type === "number") Object.assign(c, { step: 1 });
  if (type === "short") c.maxLength = 200;
  if (type === "open" || type === "matrix_input") c.maxLength = 20000;
  if (type === "allocation")
    Object.assign(c, { min: 0, total: 100, unit: "%" });
  if (type === "file" || type === "signature")
    Object.assign(c, {
      maxFiles: type === "signature" ? 1 : 3,
      maxFileBytes: SURVEY_UPLOAD_MAX_BYTES,
      allowedExtensions:
        type === "signature" ? ["png", "jpg"] : ["pdf", "png", "jpg"],
    });
  if (Object.keys(c).length) q.config = c;
  return q;
}
const unique = (values: string[]) => new Set(values).size === values.length;
const finiteNumber = (value: string) =>
  value.trim() !== "" &&
  /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim()) &&
  Number.isFinite(Number(value));
export function validateSurveyQuestion(q: SurveyWorkflowQuestion): string[] {
  const parsed = SurveyWorkflowQuestionSchema.safeParse(q);
  if (!parsed.success) return ["题目配置格式不正确"];
  const errors: string[] = [],
    c = q.config ?? {},
    choices = surveyChoices(q),
    ids = choices.map((item) => item.id);
  if (!q.title.trim()) errors.push("请填写题目标题");
  if (choiceTypes.has(q.type) && q.options.length < 2)
    errors.push("至少配置两个选项");
  if (!unique(ids) || ids.includes(SURVEY_OTHER_OPTION_ID))
    errors.push("选项 ID 必须唯一且不能使用保留 ID");
  if (c.optionIds && c.optionIds.length !== q.options.length)
    errors.push("选项 ID 与选项数量不一致");
  if (!unique(q.options)) errors.push("选项文字不能重复");
  if (q.options.some((option) => !option.trim())) errors.push("选项不能为空");
  for (const [low, high, label] of [
    [c.min, c.max, "数值"],
    [c.minLength, c.maxLength, "文字长度"],
    [c.minSelections, c.maxSelections, "选择数量"],
  ] as const)
    if (low !== undefined && high !== undefined && low > high)
      errors.push(`${label}下限不能超过上限`);
  if (
    c.maxSelections !== undefined &&
    c.maxSelections > choices.length + (c.other ? 1 : 0)
  )
    errors.push("最大选择数不能超过选项数");
  if (
    c.minSelections !== undefined &&
    c.minSelections > choices.length + (c.other ? 1 : 0)
  )
    errors.push("最小选择数不能超过选项数");
  if (c.exclusiveOptionIds?.some((id) => !ids.includes(id)))
    errors.push("互斥选项引用不存在");
  if (
    c.other &&
    !["single", "multi", "dropdown", "image_single", "image_multi"].includes(
      q.type,
    )
  )
    errors.push("此题型不支持其他选项");
  for (const [fields, label] of [
    [c.rows, "矩阵行"],
    [c.fields, "字段"],
  ] as const)
    if (
      fields &&
      (!unique(fields.map((field) => field.id)) ||
        fields.some((field) => !field.label.trim()))
    )
      errors.push(`${label}标识必须唯一且名称不能为空`);
  if (q.type.startsWith("matrix_") && !c.rows?.length)
    errors.push("至少配置一行矩阵");
  if (["multiple_text", "address"].includes(q.type) && !c.fields?.length)
    errors.push("至少配置一个字段");
  if (
    q.type === "cascade" &&
    (!c.cascadePaths?.length ||
      !unique(c.cascadePaths.map((path) => JSON.stringify(path))))
  )
    errors.push("级联路径不能为空且不能重复");
  if (
    ["scale", "matrix_scale"].includes(q.type) &&
    q.options.some((option) => !finiteNumber(option))
  )
    errors.push("量表选项必须是有效数字");
  if (
    q.type === "nps" &&
    ((c.min !== undefined && c.min !== 0) ||
      (c.max !== undefined && c.max !== 10) ||
      (c.step !== undefined && c.step !== 1))
  )
    errors.push("NPS 必须使用 0 至 10 的整数");
  if (
    ["rating", "slider"].includes(q.type) &&
    (c.min === undefined || c.max === undefined || c.min === c.max)
  )
    errors.push("评分范围必须有不同的最小值和最大值");
  if (
    ["image_single", "image_multi"].includes(q.type) &&
    choices.some(
      (choice) =>
        !c.images?.[choice.id]?.url.trim() ||
        !c.images?.[choice.id]?.alt.trim(),
    )
  )
    errors.push("请为每个图片选项配置图片和替代文字");
  if (c.images)
    for (const [id, image] of Object.entries(c.images))
      if (
        (!ids.includes(id) &&
          !(q.type === "description" && id === "description")) ||
        !image.alt.trim() ||
        !/^(https:\/\/|\/(?!\/))/.test(image.url)
      )
        errors.push("图片需有效选项、HTTPS/站内地址和替代文字");
  if (q.type === "allocation" && c.total === undefined)
    errors.push("请设置分配总额");
  if (isSurveyPageElement(q) && q.required) errors.push("页面元素不能设为必答");
  return errors;
}
function empty(value: SurveyAnswerValue | undefined): boolean {
  return (
    value === undefined ||
    (typeof value === "string"
      ? value.trim() === ""
      : Array.isArray(value)
        ? value.length === 0
        : Object.values(value).every((v) =>
            Array.isArray(v) ? v.length === 0 : v.trim() === "",
          ))
  );
}
function record(
  value: SurveyAnswerValue | undefined,
): value is Record<string, string | string[]> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function surveySelectedValues(
  q: SurveyWorkflowQuestion,
  value: SurveyAnswerValue | undefined,
): string[] {
  const selected = record(value) ? value.selected : value;
  const list = Array.isArray(selected)
    ? selected
    : typeof selected === "string"
      ? [selected]
      : [];
  const choices = surveyChoices(q);
  return list.map(
    (value) =>
      choices.find((choice) => choice.id === value || choice.label === value)
        ?.id ?? value,
  );
}
export function validateSurveyAnswer(
  q: SurveyWorkflowQuestion,
  value: SurveyAnswerValue | undefined,
): string[] {
  if (isSurveyPageElement(q))
    return value === undefined ? [] : ["说明和分页不能提交答案"];
  if (value !== undefined && !SurveyAnswerValueSchema.safeParse(value).success)
    return ["答案结构不正确"];
  if (record(value)) {
    const allowed = q.type.startsWith("matrix_")
      ? q.config?.rows?.map((row) => row.id)
      : ["multiple_text", "address"].includes(q.type)
        ? q.config?.fields?.map((field) => field.id)
        : q.type === "allocation"
          ? surveyChoices(q).map((choice) => choice.id)
          : q.config?.other
            ? ["selected", "other"]
            : [];
    if (Object.keys(value).some((key) => !allowed?.includes(key)))
      return ["答案含未知字段或行"];
  }
  if (empty(value)) return q.required ? ["请完成必答题"] : [];
  const c = q.config ?? {},
    errors: string[] = [];
  const text = (raw: unknown, label = "答案") => {
    if (typeof raw !== "string") return [`${label}必须是文字`];
    const len = raw.trim().length;
    return [
      ...(c.minLength !== undefined && len < c.minLength
        ? [`${label}长度不足`]
        : []),
      ...(len > (c.maxLength ?? 20000) ? [`${label}过长`] : []),
    ];
  };
  const number = (raw: unknown, label = "答案") => {
    if (typeof raw !== "string" || !finiteNumber(raw))
      return [`${label}必须是有效数字`];
    const n = Number(raw),
      min = q.type === "nps" ? 0 : c.min,
      max = q.type === "nps" ? 10 : c.max,
      step = q.type === "nps" ? 1 : c.step;
    return [
      ...(min !== undefined && n < min ? [`${label}低于最小值`] : []),
      ...(max !== undefined && n > max ? [`${label}高于最大值`] : []),
      ...(step &&
      Math.abs((n - (min ?? 0)) / step - Math.round((n - (min ?? 0)) / step)) >
        1e-7
        ? [`${label}不符合步长`]
        : []),
    ];
  };
  const choice = (
    raw: unknown,
    multiple: boolean,
    label = "答案",
    other = false,
  ) => {
    if (multiple ? !Array.isArray(raw) : typeof raw !== "string")
      return [`${label}选择格式不正确`];
    const list = (Array.isArray(raw) ? raw : [raw]) as string[],
      choices = surveyChoices(q),
      ids = list.map(
        (value) =>
          choices.find((item) => item.id === value || item.label === value)
            ?.id ?? value,
      );
    const problems: string[] = [];
    if (!unique(ids)) problems.push(`${label}含重复选项`);
    if (
      ids.some(
        (id) =>
          !choices.some((item) => item.id === id) &&
          !(other && id === SURVEY_OTHER_OPTION_ID),
      )
    )
      problems.push(`${label}含未知选项`);
    if (ids.length > 1 && ids.some((id) => c.exclusiveOptionIds?.includes(id)))
      problems.push("互斥选项不能与其他选项同时选择");
    if (
      multiple &&
      ((c.minSelections !== undefined && ids.length < c.minSelections) ||
        (c.maxSelections !== undefined && ids.length > c.maxSelections))
    )
      problems.push("选择数量不符合限制");
    return problems;
  };
  if (q.type.startsWith("matrix_")) {
    if (!record(value)) return ["矩阵答案必须按行填写"];
    const rows = c.rows ?? [];
    if (Object.keys(value).some((id) => !rows.some((row) => row.id === id)))
      errors.push("矩阵答案含未知行");
    for (const row of rows) {
      const item = value[row.id];
      if (empty(item)) {
        if (row.required ?? q.required) errors.push(`${row.label}尚未填写`);
        continue;
      }
      errors.push(
        ...(q.type === "matrix_input"
          ? text(item, row.label)
          : choice(item, q.type === "matrix_multi", row.label)),
      );
    }
  } else if (q.type === "multiple_text" || q.type === "address") {
    if (!record(value)) return ["请按字段填写答案"];
    const fields = c.fields ?? [];
    if (
      Object.keys(value).some((id) => !fields.some((field) => field.id === id))
    )
      errors.push("答案含未知字段");
    for (const field of fields) {
      const item = value[field.id];
      if (empty(item)) {
        if (field.required ?? q.required) errors.push(`${field.label}尚未填写`);
        continue;
      }
      errors.push(...text(item, field.label));
    }
  } else if (q.type === "allocation") {
    if (!record(value)) return ["请填写各选项分配值"];
    const choices = surveyChoices(q);
    if (
      Object.keys(value).some(
        (id) => !choices.some((choice) => choice.id === id),
      )
    )
      errors.push("分配答案含未知选项");
    let sum = 0;
    for (const option of choices) {
      const item = value[option.id];
      if (typeof item !== "string" || !finiteNumber(item)) {
        errors.push(`${option.label}需填写有效数字`);
        continue;
      }
      errors.push(...number(item, option.label));
      if (Number(item) < 0) errors.push("分配值不能小于零");
      sum += Number(item);
    }
    if (c.total !== undefined && Math.abs(sum - c.total) > 1e-7)
      errors.push(`分配合计必须为 ${c.total}`);
  } else if (q.type === "cascade") {
    if (
      !Array.isArray(value) ||
      !c.cascadePaths?.some(
        (path) => JSON.stringify(path) === JSON.stringify(value),
      )
    )
      errors.push("请选择完整有效的级联路径");
  } else if (q.type === "ranking") {
    errors.push(...choice(value, true));
    if (!Array.isArray(value) || value.length !== q.options.length)
      errors.push("排序须包含每个选项且仅一次");
  } else if (q.type === "file" || q.type === "signature") {
    if (!Array.isArray(value)) return ["附件答案必须是文件 ID 列表"];
    if (
      !unique(value) ||
      value.some((id) => !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(id))
    )
      errors.push("附件 ID 格式不正确或重复");
    if (value.length > (q.type === "signature" ? 1 : (c.maxFiles ?? 3)))
      errors.push("附件数量超出限制");
  } else if (choiceTypes.has(q.type)) {
    let selected: unknown = value;
    if (record(value)) {
      if (
        !c.other ||
        Object.keys(value).some((key) => !["selected", "other"].includes(key))
      )
        return ["选项答案结构不正确"];
      selected = value.selected;
      if (typeof value.other !== "string") errors.push("其他说明必须是文字");
      const ids = surveySelectedValues(q, value);
      if (ids.includes(SURVEY_OTHER_OPTION_ID)) {
        if (typeof value.other !== "string" || !value.other.trim())
          errors.push("请填写其他说明");
        else errors.push(...text(value.other, "其他说明"));
      } else if (typeof value.other === "string" && value.other.trim())
        errors.push("未选择其他选项，不能填写其他说明");
    } else if (surveySelectedValues(q, value).includes(SURVEY_OTHER_OPTION_ID))
      errors.push("其他选项必须附带说明");
    errors.push(...choice(selected, multiTypes.has(q.type), "答案", !!c.other));
  } else if (numericTypes.has(q.type)) errors.push(...number(value));
  else if (textTypes.has(q.type)) {
    errors.push(...text(value));
    if (typeof value === "string") {
      if (q.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
        errors.push("邮箱格式不正确");
      if (
        q.type === "phone" &&
        (!/^\+?[\d ()-]+$/.test(value) ||
          value.replace(/\D/g, "").length < 7 ||
          value.replace(/\D/g, "").length > 15)
      )
        errors.push("手机号码格式不正确");
      if (q.type === "date" && !validDate(value)) errors.push("日期无效");
      if (q.type === "time" && !validTime(value)) errors.push("时间无效");
      if (q.type === "datetime") {
        const [date, time] = value.split("T");
        if (!date || !time || !validDate(date) || !validTime(time))
          errors.push("日期时间无效");
      }
    }
  }
  return errors;
}
function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function validTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}
export function validateSurveyQuestions(
  questions: SurveyWorkflowQuestion[],
): string[] {
  const errors = questions.flatMap((q) =>
    validateSurveyQuestion(q).map((error) => `${q.title}：${error}`),
  );
  if (!unique(questions.map((q) => q.id))) errors.push("题目 ID 必须唯一");
  questions.forEach((q, index) => {
    for (const rule of q.config?.visibleWhen ?? []) {
      const previous = questions.findIndex(
        (item) => item.id === rule.questionId,
      );
      if (
        previous < 0 ||
        previous >= index ||
        isSurveyPageElement(questions[previous]!)
      ) {
        errors.push(`${q.title}：显示条件只能引用前面有效的题目`);
        continue;
      }
      const trigger = questions[previous]!;
      if (
        trigger.type.startsWith("matrix_") ||
        [
          "multiple_text",
          "address",
          "allocation",
          "file",
          "signature",
        ].includes(trigger.type)
      )
        errors.push(`${q.title}：显示条件不支持引用结构化字段或附件`);
      const choices = surveyChoices(trigger);
      if (
        choices.length &&
        !choices.some(
          (choice) => choice.id === rule.value || choice.label === rule.value,
        ) &&
        !(trigger.config?.other && rule.value === SURVEY_OTHER_OPTION_ID)
      )
        errors.push(`${q.title}：显示条件引用不存在的选项`);
    }
    if (!unique((q.config?.jumpTo ?? []).map((jump) => jump.optionId)))
      errors.push(`${q.title}：每个选项只能配置一个跳转目标`);
    for (const jump of q.config?.jumpTo ?? []) {
      const target = questions.findIndex((item) => item.id === jump.targetId);
      if (
        !surveyChoices(q).some((choice) => choice.id === jump.optionId) ||
        target <= index
      )
        errors.push(`${q.title}：跳转需有效选项及后续目标`);
    }
  });
  return errors;
}
export function visibleSurveyQuestions(
  questions: SurveyWorkflowQuestion[],
  answers: Record<string, SurveyAnswerValue>,
): SurveyWorkflowQuestion[] {
  const visible: SurveyWorkflowQuestion[] = [],
    active = new Map<string, SurveyWorkflowQuestion>();
  let skipUntil = -1;
  questions.forEach((q, index) => {
    if (index < skipUntil) return;
    const show = (q.config?.visibleWhen ?? []).every((rule) => {
      const previous = active.get(rule.questionId);
      const value = answers[rule.questionId];
      if (
        !previous ||
        empty(value) ||
        validateSurveyAnswer(previous, value).length
      )
        return false;
      const selected = surveySelectedValues(previous, value);
      const canonical =
        surveyChoices(previous).find(
          (choice) => choice.id === rule.value || choice.label === rule.value,
        )?.id ?? rule.value;
      return rule.operator === "includes"
        ? selected.includes(canonical)
        : rule.operator === "notEquals"
          ? !(selected.length === 1 && selected[0] === canonical)
          : selected.length === 1 && selected[0] === canonical;
    });
    if (!show) return;
    visible.push(q);
    active.set(q.id, q);
    const value = answers[q.id];
    if (empty(value) || validateSurveyAnswer(q, value).length) return;
    const selected = surveySelectedValues(q, value),
      jump = q.config?.jumpTo?.find((rule) => selected.includes(rule.optionId));
    if (jump) {
      const target = questions.findIndex((item) => item.id === jump.targetId);
      if (target > index) skipUntil = target;
    }
  });
  return visible;
}
export function formatSurveyAnswer(
  q: SurveyWorkflowQuestion,
  value: SurveyAnswerValue | undefined,
): string {
  if (value === undefined || empty(value)) return "未作答";
  const choices = surveyChoices(q),
    label = (item: string) =>
      choices.find((choice) => choice.id === item || choice.label === item)
        ?.label ?? (item === SURVEY_OTHER_OPTION_ID ? "其他" : item);
  if (record(value)) {
    if ("selected" in value) {
      const selected = Array.isArray(value.selected)
        ? value.selected
        : [value.selected ?? ""];
      return `${selected.map(label).join("、")}${typeof value.other === "string" && value.other.trim() ? `：${value.other}` : ""}`;
    }
    return Object.entries(value)
      .map(
        ([id, item]) =>
          `${[...(q.config?.rows ?? []), ...(q.config?.fields ?? [])].find((field) => field.id === id)?.label ?? label(id)}：${Array.isArray(item) ? item.map(label).join("、") : label(item)}`,
      )
      .join("；");
  }
  if (Array.isArray(value))
    return value
      .map(label)
      .join(q.type === "ranking" ? " > " : q.type === "cascade" ? " / " : "、");
  return label(value);
}
export function surveyQuestionStatistics(
  q: SurveyWorkflowQuestion,
): (
  | "mean"
  | "count"
  | "distribution"
  | "nps"
  | "mean_rank"
  | "first_choice"
  | "sum"
  | "responses"
  | "percentage"
)[] {
  if (isSurveyPageElement(q)) return [];
  if (q.type === "ranking") return ["mean_rank", "first_choice", "count"];
  if (q.type === "nps")
    return ["nps", "mean", "distribution", "percentage", "count"];
  if (q.type === "allocation") return ["mean", "sum", "count"];
  if (numericTypes.has(q.type) || q.type === "matrix_scale")
    return ["mean", "distribution", "percentage", "count"];
  if (
    choiceTypes.has(q.type) ||
    ["matrix_single", "matrix_multi", "matrix_dropdown"].includes(q.type)
  )
    return ["distribution", "percentage", "count"];
  return ["responses", "count"];
}
