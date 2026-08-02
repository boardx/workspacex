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
 */
export function hasAllSixColumns(row: Readonly<Record<string, unknown>>): boolean {
  return INTERVIEW_SUBJECT_COLUMNS.every((col) => col in row);
}

/** 找出第一个字段不齐的行的下标；没有就是 `undefined`。 */
export function findRowMissingColumns(
  rows: readonly Readonly<Record<string, unknown>>[],
): number | undefined {
  const idx = rows.findIndex((row) => !hasAllSixColumns(row));
  return idx === -1 ? undefined : idx;
}
