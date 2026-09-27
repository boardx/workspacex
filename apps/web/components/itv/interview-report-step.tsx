"use client";
import { interviewMarkdown } from "@repo/contracts";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { Button } from "@/components/ui/button";
import { exportInterviewReportPdf, exportInterviewReportWord } from "@/lib/interview-report-export";

/** The document is the sole body source; evidence remains server-controlled metadata. */
export function InterviewReportStep({ document }: { readonly document: interviewMarkdown.InterviewMarkdownDocument }) {
  const projection = interviewMarkdown.parseInterviewMarkdown(document);
  const report = { title: projection.headings[0]?.text ?? "研究报告", executiveSummary: projection.sections[0]?.text ?? "", markdown: document.markdown };
  return <div data-testid="itv-source-report">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div><h2 className="text-xl font-semibold">研究报告</h2><p className="mt-1 text-sm text-muted-foreground">文档版本 {document.version} · {document.evidenceMode === "simulated" ? "模拟访谈，需真人证据验证" : "证据资格以服务端审核为准"}</p></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => void exportInterviewReportWord(report, { evidenceMode: document.evidenceMode, review: { eligibility: "blocked_outdated_report", message: "该文档版本尚未关联审批记录，不代表已批准结论。", action: "完成当前版本的证据复核" } })}>导出 Word</Button><Button variant="outline" onClick={() => exportInterviewReportPdf("itv-source-report-print")}>导出 PDF</Button></div>
    </div>
    <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="报告目录" className="rounded-xl border border-border p-4 print:hidden"><h3 className="mb-3 font-semibold">报告目录</h3><ol className="space-y-3">{projection.headings.map((heading) => <li key={heading.id}><a className="text-sm text-muted-foreground transition-colors hover:text-foreground" href={`#${heading.id}`}>{heading.text}</a></li>)}</ol></nav>
      <article id="itv-source-report-print" className="min-w-0 rounded-xl border border-border bg-card p-6 lg:p-9">
        <InterviewReportMarkdown document={document} markdown={document.markdown} testId="itv-source-report-markdown" />
      </article>
    </div>
  </div>;
}
