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
export function InterviewReportStep({ document, sourceDocuments = [], expertsDocument, execution, legacySelectedExpertIds, legacyRuns, reportStatus, shareUrl, actions: extraActions }: {
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
  const selectedIds = new Set(selectedExperts.map((expert) => expert.expertId));
  const isLegacyExperts = expertsDocument?.markdown.startsWith("# 专家画像\n") ?? false;
  const expertCount = isLegacyExperts ? (legacySelectedExpertIds?.length ?? "—") : expertsDocument ? selectedExperts.length : "—";
  const completedTasks = execution
    ? execution.tasks.filter((task) => selectedIds.has(task.expertId) && task.status === "completed").length
    : legacyRuns && legacySelectedExpertIds
      ? legacyRuns.filter((run) => legacySelectedExpertIds.includes(run.expertId) && run.status === "completed").length
      : "—";
  const countEntries = (titles: readonly string[]) => projection.blocks.reduce((count, block) => {
    const title = block.title.trim().replace(/[：:]$/u, "").replace(/\s+/gu, "");
    if (block.depth !== 2 || !titles.includes(title)) return count;
    const section = { ...document, markdown: document.markdown.slice(block.contentStart, block.end) };
    return count + interviewMarkdown.parseInterviewMarkdown(section).entries.filter((entry) => entry.listDepth === 1).length;
  }, 0);
  const findings = countEntries(["核心发现", "关键发现"]);
  const actions = countEntries(["建议行动"]);
  const incomplete = reportStatus === "failed" || reportStatus === "draft";
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
  const quality = interviewMarkdown.assessInterviewReportAnalysis(document.markdown);
  const missing = quality.missing.concat(interviewMarkdown.hasInterviewReportVerifiableAction(document.markdown) ? [] : ["verifiable_action" as const]);
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
        <div data-testid="itv-source-report-evidence-boundary" className="mb-6 text-sm leading-6 text-muted-foreground">
          <p>文档版本 {document.version} · {document.evidenceMode === "simulated" ? "本报告基于 AI 模拟访谈，不代表真实用户证据。" : "证据资格以服务端审核为准。"}</p>
          <p>当前 Markdown 文档尚未关联批准记录；导出仅供研究审阅，不代表已批准结论。</p>
        </div>
        <InterviewReportMarkdown document={document} markdown={document.markdown} testId="itv-source-report-markdown" longForm />
        <InterviewReportSources report={document} sources={sourceDocuments} experts={selectedExperts} />
        <details data-testid="itv-report-details" className="mt-8 border-t border-border pt-4 print:hidden">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">材料统计与质量检查</summary>
        <section data-testid="itv-report-metrics" aria-label="已保存研究材料统计" className="mb-6">
          <div className="mb-3 text-xs leading-5 text-muted-foreground">{incomplete ? "报告未完成，以下仅为已保存部分的统计。" : "以下仅统计当前已保存版本。"}模拟任务，不代表真人样本；正文或表格未计入条目数；“—”表示缺少可核实的历史记录。页面统计不改写报告 Markdown。</div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["experts", "已选专家角色", expertCount],
              ["completed", "已完成模拟访谈", completedTasks],
              ["findings", "列出的核心发现", findings],
              ["actions", "列出的建议行动", actions],
            ] as const).map(([id, label, value]) => <div key={id} data-testid={`itv-report-metric-${id}`} className="rounded-lg border border-border bg-muted/25 px-4 py-3"><dt className="text-xs leading-5 text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>)}
          </dl>
        </section>
        <section data-testid="itv-report-quality" aria-label="报告质量检查" className={`mb-6 rounded-lg border p-4 text-sm ${missing.length ? "border-warning/40 bg-warning/5" : "border-success/30 bg-success/5"}`}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">报告质量检查</h3>
            <span className="text-xs font-medium">{missing.length ? "待补齐" : "结构完整"}</span>
          </div>
          <p className="mt-1 leading-6 text-muted-foreground">检查报告是否包含跨回答综合、决策影响、分歧与反例、适用边界和可验证行动建议。此检查不替代人工复核。</p>
          {missing.length ? <p className="mt-2" data-testid="itv-report-quality-missing">缺少：{missing.map((gap) => QUALITY_GAP_LABELS[gap]).join("、")}</p> : <p className="mt-2" data-testid="itv-report-quality-complete">已包含关键分析结构。</p>}
        </section>
        </details>
      </article>
    </div>
  </div>;
}

const QUALITY_GAP_LABELS: Record<interviewMarkdown.InterviewReportAnalysisGap, string> = {
  cross_answer_synthesis: "跨回答综合",
  decision_implication: "决策影响",
  boundary_or_counterevidence: "分歧与反例及适用边界",
  verifiable_action: "可验证行动建议",
};
