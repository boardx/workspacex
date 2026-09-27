/** Native local text import; binary asset upload/extraction is a separate capability. */
export async function importInterviewTextFile(file: File): Promise<string> {
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  if (!["md", "markdown", "txt"].includes(extension ?? "")) throw new Error("仅支持 UTF-8 TXT / Markdown 文件");
  if (file.size > 2 * 1024 * 1024) throw new Error("文本文档不能超过 2 MB");
  const bytes = await file.arrayBuffer();
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error("文件不是有效 UTF-8 文本"); }
  if (!raw.trim()) throw new Error("文件没有可用文字");
  if (extension !== "txt") return raw;
  const fence = "`".repeat(Math.max(3, ...Array.from(raw.matchAll(/`+/g), (match) => match[0].length + 1)));
  const filename = file.name.replace(/[\r\n\[\]<>]/g, "_");
  return `## 导入材料：${filename}\n\n${fence}text\n${raw}\n${fence}`;
}
