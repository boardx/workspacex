/**
 * 观察/访谈对象表 —— 六列结构与填写（F25 / `uc-2-2` R8 V9 / 契约 `templates.updateInterviewSubjects`）。
 *
 * 六列：对象(`name`) / 部门角色(`role`) / 联系方式(`contact`) / 背景与要问什么(`focus`) /
 * 方式(`method`) / 状态(`status`)。本 feature **只断言结构与填写**——预约、提纲生成、
 * 转写自动回流是 06-itv（`interview` 束）的活，本文件不建那条线（issue #322 notes 逐字）。
 */

export const INTERVIEW_SUBJECT_COLUMNS = [
  "name",
  "role",
  "contact",
  "focus",
  "method",
  "status",
] as const;
export type InterviewSubjectColumn = (typeof INTERVIEW_SUBJECT_COLUMNS)[number];

export interface InterviewSubjectRow {
  readonly subjectId: string;
  readonly name: string;
  readonly role: string;
  readonly contact: string;
  readonly focus: string;
  readonly method: string;
  readonly status: string;
}

/**
 * 六列齐全——每一行都必须持有这六个字段的键（哪怕值是空串；V9「可增删」允许新加一行先留空
 * 待填写，但字段本身不能缺）。
 *
 * ⚠ 参数类型刻意是 `object`（不是 `Record<string, unknown>`）：`InterviewSubjectRow` 这类
 *   具名接口在结构上满足 `Record<string, unknown>` 的语义，但 TS 要求显式索引签名才能直接
 *   赋值给它——本函数就是要接受「结构上满足六列，但不一定声明了索引签名」的任意行（包括
 *   测试里故意漏字段的半成品行），所以用 `object` + `in` 判断，不强加索引签名。
 */
export function hasAllSixColumns(row: object): boolean {
  return INTERVIEW_SUBJECT_COLUMNS.every((col) => col in row);
}

/** 找出第一个字段不齐的行的下标；没有就是 `undefined`。 */
export function findRowMissingColumns(rows: readonly object[]): number | undefined {
  const idx = rows.findIndex((row) => !hasAllSixColumns(row));
  return idx === -1 ? undefined : idx;
}
