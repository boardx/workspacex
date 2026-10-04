"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { InterviewReportSources } from "./interview-report-sources";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { Button } from "@/components/ui/button";
import { exportInterviewReportPdf, exportInterviewReportWord } from "@/lib/interview-report-export";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { InterviewStepHeader } from "./interview-step-header";
import { researchWorkspaceStyle } from "@/components/research-studio/research-workspace-style";

/** The document is the sole body source; evidence remains server-controlled metadata. */
export function InterviewReportStep({ document, sourceDocuments = [], expertsDocument, shareUrl, actions: extraActions }: {
  readonly document: interviewMarkdown.InterviewMarkdownDocument;
  readonly sourceDocuments?: readonly interviewMarkdown.InterviewMarkdownDocument[];
  readonly expertsDocument?: interviewMarkdown.InterviewMarkdownDocument;
  readonly execution?: InterviewMarkdownEnvelope["execution"];
  readonly legacySelectedExpertIds?: readonly string[];
  readonly legacyRuns?: readonly Readonly<{ expertId: string; status: string }>[];
  readonly reportStatus?: InterviewMarkdownEnvelope["states"][number]["status"];
  readonly shareUrl?: string;
  readonly actions?: React.ReactNode;
}) {
  const projection = interviewMarkdown.parseInterviewMarkdown(document);
  const selectedExperts = expertsDocument ? interviewMarkdown.projectInterviewMarkdownExperts(expertsDocument) : [];
  const [exportError, setExportError] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [shareStatus, setShareStatus] = React.useState("");
  const [tocExpanded, setTocExpanded] = React.useState(false);
  async function share() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(new URL(shareUrl, window.location.origin).href); setShareStatus("报告链接已复制。访问者仍需登录并拥有该访谈权限；链接绑定当前文档版本，不是公开发布。"); }
    catch { setShareStatus("复制未完成，请使用浏览器地址栏分享。链接不会绕过访谈权限。"); }
  }
  async function runExport(operation: () => void | Promise<void>) {
    setExportError(""); setExporting(true);
    try { await operation(); } catch { setExportError("导出未完成，报告原文仍保留，请重试。"); }
    finally { setExporting(false); }
  }
  const report = { title: projection.headings[0]?.text ?? "研究报告", executiveSummary: projection.sections[0]?.text ?? "", markdown: document.markdown };
  return <div data-testid="itv-source-report">
    <InterviewStepHeader title="研究报告">
      {extraActions}
      <div className="flex flex-wrap gap-2"><Button disabled={exporting} variant="outline" onClick={() => void runExport(() => exportInterviewReportWord(report, { evidenceMode: document.evidenceMode, source: { version: document.version, contentHash: document.contentHash }, review: { eligibility: "blocked_outdated_report", message: "该文档版本尚未关联审批记录，不代表已批准结论。", action: "完成当前版本的证据复核" } }))}>导出 Word</Button><Button disabled={exporting} variant="outline" onClick={() => void runExport(() => exportInterviewReportPdf("itv-source-report-print"))}>导出 PDF</Button>{shareUrl && <Button variant="outline" onClick={() => void share()}>分享报告</Button>}</div>
    </InterviewStepHeader>
    {exportError && <p role="alert" className="mb-4 text-sm text-destructive print:hidden">{exportError}</p>}
    {shareStatus && <p role="status" className="mb-4 text-sm text-muted-foreground print:hidden">{shareStatus}</p>}
    <div className={researchWorkspaceStyle.report}>
      <nav aria-label="报告目录" className="min-w-0 border-b border-border pb-5 print:hidden xl:sticky xl:top-52 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto xl:border-b-0 xl:border-r xl:pr-5"><div className="mb-4 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">目录</h3><Button variant="ghost" size="sm" className="xl:hidden" aria-expanded={tocExpanded} aria-controls="itv-report-toc" onClick={() => setTocExpanded((value) => !value)}>{tocExpanded ? "收起目录" : "展开目录"}</Button></div><ol id="itv-report-toc" className={`space-y-2 ${tocExpanded ? "block" : "hidden"} xl:block`}>{projection.headings.map((heading) => <li key={heading.id}><a className="block break-words text-xs leading-relaxed text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" href={`#${heading.id}`}>{heading.text}</a></li>)}</ol></nav>
      <article id="itv-source-report-print" className="min-w-0">
        <p data-testid="itv-report-print-version" className="hidden print:block mb-4 break-all text-sm">报告版本 {document.version} · SHA256 {document.contentHash}</p>
        <InterviewReportMarkdown document={document} markdown={document.markdown} testId="itv-source-report-markdown" longForm />
        <InterviewReportSources report={document} sources={sourceDocuments} experts={selectedExperts} />

      </article>
    </div>
  </div>;
}
