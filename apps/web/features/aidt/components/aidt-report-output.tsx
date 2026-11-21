"use client";

import { MarkdownProse } from "@/components/chat/markdown-prose";
import { AidtReportVersions } from "./aidt-report-versions";
import type { AidtReportHistoryScope } from "../lib/aidt-report-history";
import type { AidtSharedReportController } from "../lib/use-aidt-shared-stages";

export function AidtReportOutput({ text, proposalText, shared, historyScope, reportEntityId }: {
  text: string | null;
  proposalText?: string | null;
  shared?: AidtSharedReportController;
  historyScope?: AidtReportHistoryScope;
  reportEntityId?: string;
}) {
  const draft = proposalText?.trim();
  const showProposal = Boolean(draft && draft !== text && draft !== shared?.serverMarkdown);
  const value = showProposal ? draft : text ?? shared?.serverMarkdown;
  const confirmed = Boolean(!showProposal && shared?.matchesServer && shared?.confirmedAtRevision);
  return <section aria-label="小组报告产物" className="space-y-3" data-testid="aidt-report-preview">
    <h2 className="text-16 font-semibold">小组报告</h2>
    {shared?.loading && !value ? <p role="status" className="text-12">正在读取报告…</p> : value ? <>
      <p className="text-12 text-muted-foreground" data-testid="aidt-report-save-state">
        {confirmed ? `已确认 · V${shared?.confirmedAtRevision}` : showProposal ? "AI 草稿 · 待采用" : shared?.matchesServer ? "已保存 · 待确认" : "草稿 · 未保存"}
      </p>
      <article aria-label="报告正文" className="chat-markdown break-words text-14"><MarkdownProse text={value} /></article>
    </> : <p className="text-12 text-muted-foreground">暂无报告产物。</p>}
    {historyScope && <AidtReportVersions scope={historyScope} confirmedRevision={shared?.confirmedAtRevision} reportEntityId={reportEntityId} />}
  </section>;
}
