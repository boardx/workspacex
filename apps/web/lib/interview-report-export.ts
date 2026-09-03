import type { DigitalInterviewWorkflowView } from "./interview-api";

type Report = NonNullable<DigitalInterviewWorkflowView["report"]>;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "-").trim() || "访谈报告";
}

export function reportMarkdownBody(title: string, markdown: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.replace(new RegExp(`^#\\s+${escaped}\\s*(?:\\r?\\n)+`, "i"), "").trim();
}

function markdownParagraphs(markdown: string): Array<{ readonly text: string; readonly heading?: 1 | 2 | 3; readonly bullet?: boolean }> {
  return markdown.split(/\r?\n/).flatMap((line) => {
    const value = line.trim();
    if (!value) return [];
    const heading = /^(#{1,3})\s+(.+)$/.exec(value);
    if (heading) return [{ text: heading[2]!, heading: heading[1]!.length as 1 | 2 | 3 }];
    const bullet = /^[-*+]\s+(.+)$/.exec(value);
    if (bullet) return [{ text: bullet[1]!, bullet: true }];
    return [{ text: value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1") }];
  });
}

/** Produces a real OOXML .docx rather than an HTML file renamed to .doc. */
export async function buildInterviewReportWordBlob(report: Report): Promise<Blob> {
  const { AlignmentType, Document, Footer, HeadingLevel, Packer, PageNumber, Paragraph, TextRun } = await import("docx");
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: report.title, bold: true })] }),
    new Paragraph({ children: [new TextRun({ text: report.executiveSummary, italics: true })] }),
    ...markdownParagraphs(reportMarkdownBody(report.title, report.markdown)).map((item) => new Paragraph({
      ...(item.heading ? { heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][item.heading - 1] } : {}),
      ...(item.bullet ? { bullet: { level: 0 } } : {}),
      children: [new TextRun(item.text)],
      spacing: { after: 120, line: 360 },
    })),
  ];
  return Packer.toBlob(new Document({
    styles: {
      default: { document: { run: { font: "Arial Unicode MS", size: 22 }, paragraph: { spacing: { after: 120, line: 360 } } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial Unicode MS", size: 38, bold: true, color: "111827" }, paragraph: { spacing: { after: 280 }, alignment: AlignmentType.CENTER } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial Unicode MS", size: 30, bold: true, color: "1F2937" }, paragraph: { spacing: { before: 300, after: 140 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial Unicode MS", size: 26, bold: true, color: "374151" }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial Unicode MS", size: 23, bold: true, color: "4B5563" }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["第 ", PageNumber.CURRENT, " 页"] })] })] }) },
    }],
  }));
}

export async function exportInterviewReportWord(report: Report): Promise<void> {
  const blob = await buildInterviewReportWordBlob(report);
  download(blob, `${safeFilename(report.title)}.docx`);
}

/** Opens the browser's native print dialog with only the persisted report visible; users can save as PDF. */
export function exportInterviewReportPdf(rootId: string): void {
  const root = document.getElementById(rootId);
  if (!root) return;
  root.classList.add("print-interview-report-root");
  document.body.dataset.printInterviewReport = "true";
  const cleanup = () => {
    root.classList.remove("print-interview-report-root");
    delete document.body.dataset.printInterviewReport;
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}
