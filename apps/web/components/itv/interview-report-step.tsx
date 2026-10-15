"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { InterviewReportSources } from "./interview-report-sources";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { Button } from "@/components/ui/button";
import { WorkflowActionButton as ActionButton } from "@/components/research-studio/research-workflow-actions";
import { ReportFileActions } from "@/components/report-files/report-file-actions";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";
import { InterviewStepHeader, InterviewStepActions } from "./interview-step-header";
import { researchWorkspaceStyle } from "@/components/research-studio/research-workspace-style";

/** The document is the sole body source; evidence remains server-controlled metadata. */
export function InterviewReportStep({ interviewId, revisionId, reportStatus, document, sourceDocuments = [], expertsDocument, shareUrl, actions: extraActions }: {
  readonly interviewId?: string;
  readonly revisionId?: string | null;
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
  const [shareStatus, setShareStatus] = React.useState("");
  const [tocExpanded, setTocExpanded] = React.useState(false);
  async function share() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(new URL(shareUrl, window.location.origin).href); setShareStatus("报告链接已复制。访问者仍需登录并拥有该访谈权限；链接绑定当前文档版本，不是公开发布。"); }
    catch { setShareStatus("复制未完成，请使用浏览器地址栏分享。链接不会绕过访谈权限。"); }
  }
  return <div data-testid="itv-source-report">
    <InterviewStepHeader title="研究报告" />

    <div className={researchWorkspaceStyle.report}>
      <nav aria-label="报告目录" className="min-w-0 border-b border-border pb-5 print:hidden xl:sticky xl:top-52 xl:max-h-[calc(100dvh-14rem)] xl:overflow-y-auto xl:border-b-0 xl:border-r xl:pr-5"><div className="mb-4 flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">目录</h3><Button variant="ghost" size="sm" className="xl:hidden" aria-expanded={tocExpanded} aria-controls="itv-report-toc" onClick={() => setTocExpanded((value) => !value)}>{tocExpanded ? "收起目录" : "展开目录"}</Button></div><ol id="itv-report-toc" className={`space-y-2 ${tocExpanded ? "block" : "hidden"} xl:block`}>{projection.headings.map((heading) => <li key={heading.id}><a className="block break-words text-xs leading-relaxed text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" href={`#${heading.id}`}>{heading.text}</a></li>)}</ol></nav>
      <article id="itv-source-report-print" className="min-w-0">
        <p data-testid="itv-report-print-version" className="hidden print:block mb-4 break-all text-sm">文档版本 {document.version} · SHA256 {document.contentHash}</p>
        <div data-testid="itv-report-print-provenance" className="hidden print:block mb-4 text-sm">
          {document.evidenceMode === "simulated" && <p>本报告基于 AI 模拟访谈，不代表真实用户证据，需真人验证。</p>}
          <p>该文档版本尚未关联审批记录，不代表已批准结论。</p>
        </div>
        <InterviewReportMarkdown document={document} markdown={document.markdown} testId="itv-source-report-markdown" longForm />
        <InterviewReportSources report={document} sources={sourceDocuments} experts={selectedExperts} />

      </article>
    </div>
    <InterviewStepActions>
      {interviewId ? <ReportFileActions key={JSON.stringify([revisionId, document.documentId, document.version, document.contentHash])} source={{ kind: "interview", id: interviewId, reportVersion: document.version, reportHash: document.contentHash }} disabled={!['draft', 'confirmed', 'completed'].includes(reportStatus ?? '')} /> : <p className="text-sm text-muted-foreground">当前报告暂不能生成文件，请刷新后重试。</p>}
      {shareUrl && <ActionButton variant="outline" onClick={() => void share()}>分享报告</ActionButton>}
      {extraActions}
    </InterviewStepActions>
    {shareStatus && <p role="status" className="mt-3 text-sm text-muted-foreground print:hidden">{shareStatus}</p>}
  </div>;
}
