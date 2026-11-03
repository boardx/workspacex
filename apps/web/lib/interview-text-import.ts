import { INTERVIEW_INTAKE_ERROR_TEXT } from "./interview-intake-error-text";
/** Native local text import; binary asset upload/extraction is a separate capability. */
export async function importInterviewTextFile(file: File): Promise<string> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!["md", "markdown", "txt"].includes(extension ?? "")) throw new Error(INTERVIEW_INTAKE_ERROR_TEXT.UTF8_ONLY);
  if (file.size > 2 * 1024 * 1024) throw new Error(INTERVIEW_INTAKE_ERROR_TEXT.TOO_LARGE_TEXT);
  const bytes = await file.arrayBuffer();
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error(INTERVIEW_INTAKE_ERROR_TEXT.INVALID_UTF8); }
  if (!raw.trim()) throw new Error(INTERVIEW_INTAKE_ERROR_TEXT.EMPTY_FILE);
  if (extension !== "txt") return raw;
  const fence = "`".repeat(Math.max(3, ...Array.from(raw.matchAll(/`+/g), (match) => match[0].length + 1)));
  const filename = file.name.replace(/[\r\n\[\]<>]/g, "_");
  return `## 导入材料：${filename}\n\n${fence}text\n${raw}\n${fence}`;
}
