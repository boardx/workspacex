import { openResearchPrintPreview, type ResearchPrintPreviewOptions } from "@/lib/research-print-preview";

/** Existing authorized AIDT export content only; no save, upload or model call. */
export function previewAidtPdf(root: HTMLElement, title: string, options: ResearchPrintPreviewOptions = {}) {
  return openResearchPrintPreview(root, title, options);
}

/** Exact student-authored text/revision supplied by the host, never a generated substitute. */
export function previewAidtText(text: string, title: string, options: Pick<ResearchPrintPreviewOptions, "isCurrent" | "defaultPaper"> = {}) {
  const root = document.createElement("article");
  if (!text.trim()) return Promise.reject(new Error("尚无可预览的文字成果"));
  if (!/^#{1,3} /m.test(text)) {
    const heading = document.createElement("h2"); heading.textContent = title; root.append(heading);
  }
  for (const line of text.split("\n")) {
    const node = document.createElement(line.startsWith("# ") ? "h2" : line.startsWith("## ") ? "h3" : line.startsWith("### ") ? "h4" : "p");
    node.textContent = line.replace(/^#{1,3} /, "");
    node.style.whiteSpace = "pre-wrap";
    root.append(node);
  }
  return previewAidtPdf(root, title, { ...options, layout: "flow" });
}
