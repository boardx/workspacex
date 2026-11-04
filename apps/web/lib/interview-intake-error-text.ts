/** Controlled local import errors; canonical file contents and Markdown framing stay unchanged. */
export const INTERVIEW_INTAKE_ERROR_TEXT = {
  UTF8_ONLY: "仅支持 UTF-8 TXT / Markdown 文件",
  TOO_LARGE_TEXT: "文本文档不能超过 2 MB",
  INVALID_UTF8: "文件不是有效 UTF-8 文本",
  EMPTY_FILE: "文件没有可用文字",
  IMMUTABLE: "已确认需求需要创建新修订",
  TOO_LARGE_SYNC: "研究文件不能超过同步提取上限",
} as const;
