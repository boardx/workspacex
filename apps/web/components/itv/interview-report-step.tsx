"use client";
import * as React from "react";
import { interviewMarkdown } from "@repo/contracts";
import { InterviewReportMarkdown } from "./interview-report-markdown";
import { Button } from "@/components/ui/button";
import { exportInterviewReportPdf, exportInterviewReportWord } from "@/lib/interview-report-export";
import type { InterviewMarkdownEnvelope } from "@/lib/interview-markdown-api";

/** The document is the sole body source; evidence remains server-controlled metadata. */
export function InterviewReportStep({ document, expertsDocument, execution, reportStatus, shareUrl }: {
  readonly document: interviewMarkdown.InterviewMarkdownDocument;
  readonly expertsDocument?: interviewMarkdown.InterviewMarkdownDocument;
  readonly execution?: InterviewMarkdownEnvelope["execution"];
  readonly reportStatus?: InterviewMarkdownEnvelope["states"][number]["status"];
  readonly shareUrl?: string;
}) {
  const projection = interviewMarkdown.parseInterviewMarkdown(document);
  const selectedExperts = expertsDocument ? interviewMarkdown.projectInterviewMarkdownExperts(expertsDocument) : [];
  const selectedIds = new Set(selectedExperts.map((expert) => expert.expertId));
  const completedTasks = execution?.tasks.filter((task) => selectedIds.has(task.expertId) && task.status === "completed").length ?? 0;
  const countEntries = (titles: readonly string[]) => projection.blocks.reduce((count, block) => {
    const title = block.title.trim().replace(/[：:]$/u, "").replace(/\s+/gu, "");
    if (block.depth !== 2 || !titles.includes(title)) return count;
    const section = { ...document, markdown: document.markdown.slice(block.contentStart, block.end) };
    return count + interviewMarkdown.parseInterviewMarkdown(section).entries.length;
  }, 0);
  const findings = countEntries(["核心发现", "关键发现"]);
  const actions = countEntries(["建议行动"]);
  const incomplete = reportStatus === "failed" || reportStatus === "draft";
  const [exportError, setExportError] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [shareStatus, setShareStatus] = React.useState("");
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
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <div><h2 className="text-3xl font-semibold tracking-tight lg:text-4xl">研究报告</h2><p className="mt-1 text-base leading-7 text-muted-foreground">文档版本 {document.version} · {document.evidenceMode === "simulated" ? "模拟访谈，需真人证据验证" : "证据资格以服务端审核为准"}</p></div>
      <div className="flex flex-wrap gap-2"><Button disabled={exporting} variant="outline" onClick={() => void runExport(() => exportInterviewReportWord(report, { evidenceMode: document.evidenceMode, source: { version: document.version, contentHash: document.contentHash }, review: { eligibility: "blocked_outdated_report", message: "该文档版本尚未关联审批记录，不代表已批准结论。", action: "完成当前版本的证据复核" } }))}>导出 Word</Button><Button disabled={exporting} variant="outline" onClick={() => void runExport(() => exportInterviewReportPdf("itv-source-report-print"))}>导出 PDF</Button>{shareUrl && <Button variant="outline" onClick={() => void share()}>分享报告</Button>}</div>
    </div>
    {exportError && <p role="alert" className="mb-4 text-sm text-destructive print:hidden">{exportError}</p>}
    {shareStatus && <p role="status" className="mb-4 text-sm text-muted-foreground print:hidden">{shareStatus}</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="报告目录" className="rounded-xl border border-border p-4 print:hidden"><h3 className="mb-3 font-semibold">报告目录</h3><ol className="space-y-3">{projection.headings.map((heading) => <li key={heading.id}><a className="text-sm text-muted-foreground transition-colors hover:text-foreground" href={`#${heading.id}`}>{heading.text}</a></li>)}</ol></nav>
      <article id="itv-source-report-print" className="min-w-0 rounded-xl border border-border bg-card p-6 lg:p-9">
        <div data-testid="itv-source-report-evidence-boundary" className="mb-6 rounded-lg border border-border p-4 text-sm leading-6">
          <p>文档版本 {document.version} · {document.evidenceMode === "simulated" ? "本报告基于 AI 模拟访谈，不代表真实用户证据。" : "证据资格以服务端审核为准。"}</p>
          <p>当前 Markdown 文档尚未关联批准记录；导出仅供研究审阅，不代表已批准结论。</p>
        </div>
        <section data-testid="itv-report-metrics" aria-label="已保存研究材料统计" className="mb-6">
          <div className="mb-3 text-xs leading-5 text-muted-foreground">{incomplete ? "报告未完成，以下仅为已保存部分的统计。" : "以下仅统计当前已保存版本。"}模拟任务，不代表真人样本；正文或表格未计入条目数。页面统计不改写报告 Markdown。</div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["experts", "已选专家角色", selectedExperts.length],
              ["completed", "已完成模拟访谈", completedTasks],
              ["findings", "列出的核心发现", findings],
              ["actions", "列出的建议行动", actions],
            ] as const).map(([id, label, value]) => <div key={id} data-testid={`itv-report-metric-${id}`} className="rounded-lg border border-border bg-muted/25 px-4 py-3"><dt className="text-xs leading-5 text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>)}
          </dl>
        </section>
        <InterviewReportMarkdown document={document} markdown={document.markdown} testId="itv-source-report-markdown" longForm />
      </article>
    </div>
  </div>;
}
