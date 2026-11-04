/** Exact validator message identities, translated only after canonical validation. */
export const surveyAnswerLiteralCatalogue = {
  required: ["请完成必答题", "Complete this required question."],
  pageAnswer: ["说明和分页不能提交答案", "Descriptions and page breaks cannot have answers."],
  structure: ["答案结构不正确", "The answer structure is invalid."],
  unknownFieldRow: ["答案含未知字段或行", "The answer contains an unknown field or row."],
  exclusive: ["互斥选项不能与其他选项同时选择", "An exclusive option cannot be selected with other options."],
  selections: ["选择数量不符合限制", "The number of selections is outside the allowed range."],
  matrixStructure: ["矩阵答案必须按行填写", "Complete matrix answers by row."],
  matrixUnknown: ["矩阵答案含未知行", "The matrix answer contains an unknown row."],
  fields: ["请按字段填写答案", "Complete the answer by field."],
  unknownField: ["答案含未知字段", "The answer contains an unknown field."],
  allocationStructure: ["请填写各选项分配值", "Enter an allocation for each option."],
  allocationUnknown: ["分配答案含未知选项", "The allocation contains an unknown option."],
  allocationNegative: ["分配值不能小于零", "Allocations cannot be negative."],
  cascade: ["请选择完整有效的级联路径", "Choose a complete valid cascading path."],
  ranking: ["排序须包含每个选项且仅一次", "Rank every option exactly once."],
  attachmentStructure: ["附件答案必须是文件 ID 列表", "Attachments must be a list of file IDs."],
  attachmentIds: ["附件 ID 格式不正确或重复", "Attachment IDs are invalid or duplicated."],
  attachmentCount: ["附件数量超出限制", "Too many attachments."],
  choiceStructure: ["选项答案结构不正确", "The choice answer structure is invalid."],
  otherText: ["其他说明必须是文字", "Other details must be text."],
  otherRequired: ["请填写其他说明", "Enter details for Other."],
  otherUnselected: ["未选择其他选项，不能填写其他说明", "Select Other before entering other details."],
  otherMissing: ["其他选项必须附带说明", "The Other option requires details."],
  email: ["邮箱格式不正确", "Enter a valid email address."],
  phone: ["手机号码格式不正确", "Enter a valid phone number."],
  date: ["日期无效", "Enter a valid date."],
  time: ["时间无效", "Enter a valid time."],
  datetime: ["日期时间无效", "Enter a valid date and time."],
} as const;
export const surveyAnswerSuffixCatalogue = {
  text: ["必须是文字", "{label}必须是文字", "{label} must be text."],
  short: ["长度不足", "{label}长度不足", "{label} is too short."],
  long: ["过长", "{label}过长", "{label} is too long."],
  number: ["必须是有效数字", "{label}必须是有效数字", "{label} must be a valid number."],
  below: ["低于最小值", "{label}低于最小值", "{label} is below the minimum."],
  above: ["高于最大值", "{label}高于最大值", "{label} is above the maximum."],
  step: ["不符合步长", "{label}不符合步长", "{label} does not match the step."],
  choice: ["选择格式不正确", "{label}选择格式不正确", "{label} selection format is invalid."],
  duplicate: ["含重复选项", "{label}含重复选项", "{label} contains duplicate options."],
  unknown: ["含未知选项", "{label}含未知选项", "{label} contains an unknown option."],
  required: ["尚未填写", "{label}尚未填写", "{label} is required."],
  allocationNumber: ["需填写有效数字", "{label}需填写有效数字", "{label} needs a valid number."],
} as const;
type LiteralMessages = Record<`survey.answer.${keyof typeof surveyAnswerLiteralCatalogue}`, string>;
type DynamicMessages = Record<`survey.answer.dynamic.${keyof typeof surveyAnswerSuffixCatalogue}`, string>;
function literals(index: 0 | 1): LiteralMessages {
  return Object.fromEntries(Object.entries(surveyAnswerLiteralCatalogue).map(([key, pair]) => [`survey.answer.${key}`, pair[index]])) as LiteralMessages;
}
function dynamic(index: 1 | 2): DynamicMessages {
  return Object.fromEntries(Object.entries(surveyAnswerSuffixCatalogue).map(([key, parts]) => [`survey.answer.dynamic.${key}`, parts[index]])) as DynamicMessages;
}
export const surveyPublicZhCN = {
  ...literals(0), ...dynamic(1),
  "survey.public.title": "问卷",
  "survey.public.loading": "正在加载…",
  "survey.public.intro": "匿名填写 · {count} 道题 · 标记 * 的题目为必答",
  "survey.public.page": "第 {page} / {count} 页",
  "survey.public.previous": "上一页",
  "survey.public.next": "下一页",
  "survey.public.submit": "提交答卷",
  "survey.public.submitting": "正在提交…",
  "survey.public.checkAnswers": "请检查标记的必答题或格式错误，已填写的内容会保留。",
  "survey.public.success": "提交成功，感谢您的参与。",
  "survey.public.submitFailed": "提交失败，请重试。",
  "survey.answer.label": "答案",
  "survey.answer.otherLabel": "其他说明",
  "survey.answer.total": "分配合计必须为 {total}",
} as const;
export const surveyPublicEn: Record<keyof typeof surveyPublicZhCN, string> = {
  ...literals(1), ...dynamic(2),
  "survey.public.title": "Survey",
  "survey.public.loading": "Loading…",
  "survey.public.intro": "Anonymous · {count} questions · Questions marked * are required",
  "survey.public.page": "Page {page} / {count}",
  "survey.public.previous": "Previous page",
  "survey.public.next": "Next page",
  "survey.public.submit": "Submit response",
  "survey.public.submitting": "Submitting…",
  "survey.public.checkAnswers": "Check the marked required questions or format errors. Your answers are retained.",
  "survey.public.success": "Submitted successfully. Thank you for participating.",
  "survey.public.submitFailed": "Submission failed. Try again.",
  "survey.answer.label": "Answer",
  "survey.answer.otherLabel": "Other details",
  "survey.answer.total": "The allocation total must be {total}.",
};
