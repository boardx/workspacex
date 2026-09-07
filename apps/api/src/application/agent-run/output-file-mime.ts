/**
 * 按扩展名给 mime。与 `execute-trial-run.ts` 的表**同形**（⚠ 已知重复，两处各声明
 * 一次——本仓栽过五次的"同一事实两处声明"，本次只是按既有约定同步更新，不在本
 * feature 范围内合并成单一来源）。F979（design-delta skill-office-docs-node-runtime）
 * 新增 docx/xlsx/pdf 三个扩展——认不出的一律 `application/octet-stream`（诚实的
 * "不知道"，不猜一个像样的类型）。
 */
const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
};

export function outputFileMime(name: string): string {
  const dot = name.lastIndexOf(".");
  return (dot < 0 ? undefined : MIME_BY_EXTENSION[name.slice(dot).toLowerCase()]) ?? "application/octet-stream";
}
