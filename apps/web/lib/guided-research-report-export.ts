import { exportFileStem, loadRomanize } from "./export-file-name";
import { printResearchPdf } from "./research-report-export";
import { buildGuidedResearchWord, type GuidedResearchWordInput } from "./guided-research-word-export";

/** Safe, isolated report content; user text is never interpreted as HTML. */
export function guidedResearchExportDocument(input: GuidedResearchWordInput): HTMLElement {
  const root = document.createElement("article");
  const add = (tag: string, text: string) => {
    const node = document.createElement(tag);
    node.textContent = text;
    root.append(node);
  };
  add("h2", input.title);
  add("p", "演示报告：仅包含当前已确认的大纲、摘要和已保留的演示来源，不代表真实检索或研究结论。");
  add("h3", "目录");
  input.sections.forEach((section, index) => add("p", `${index + 1}. ${section.title}`));
  add("h3", "摘要");
  add("p", input.summary || "尚未提供摘要。");
  add("h3", "已确认章节大纲");
  input.sections.forEach((section) => add("p", section.title));
  add("h3", "来源与引用");
  if (!input.citations.length) add("p", "没有已保留的演示来源。");
  input.citations.forEach((citation, index) => add("p", `[${index + 1}] ${citation.label}\n${citation.url}`));
  return root;
}

/** PDF opens native printing; only Word uses a binary download. */
export async function exportGuidedResearchReport(input: GuidedResearchWordInput, format: "pdf" | "word"): Promise<void> {
  const snapshot = structuredClone(input);
  const stem = exportFileStem(snapshot.title, "research-report", await loadRomanize());
  if (format === "pdf") {
    printResearchPdf(guidedResearchExportDocument(snapshot), stem);
    return;
  }
  const blob = await buildGuidedResearchWord(snapshot);
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${stem}.docx`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
