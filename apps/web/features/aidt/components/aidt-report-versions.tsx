"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { artifactFileName } from "@/lib/chat-workbench/artifact-download";
import { MarkdownProse } from "@/components/chat/markdown-prose";
import { printAidtUiText } from "./aidt-stage-output";
import { listAidtStageHistory, type AidtSharedStage } from "../lib/live-aidt-stages";
import { isConfirmedReportVersion, readConfirmedReportForExport, readExactReportSource, reportInStage } from "../lib/aidt-report-versions";
import { aidtUiStageSummary } from "../lib/aidt-ui-drafts";
import type { AidtReportHistoryScope } from "../lib/aidt-report-history";

type Props = { scope: AidtReportHistoryScope; confirmedRevision?: number; reportEntityId?: string };
export function AidtReportVersions(props: Props) {
  const { scope } = props;
  return <Versions key={JSON.stringify([scope.orgId, scope.userId, scope.projectId, scope.sessionToken, scope.lifecycleKey, props.reportEntityId])} {...props} />;
}

function Versions({ scope, confirmedRevision, reportEntityId }: Props) {
  const [versions, setVersions] = React.useState<AidtSharedStage[]>([]);
  const [next, setNext] = React.useState<number | null | undefined>(undefined);
  const [selected, setSelected] = React.useState<AidtSharedStage | null>(null);
  const [source, setSource] = React.useState<AidtSharedStage | null>(null);
  const [status, setStatus] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const pending = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { pending.current?.abort(); }, []);
  const selectedReport = selected ? reportInStage(selected, reportEntityId) : undefined;
  const exportRevision = selected?.revision ?? confirmedRevision;

  async function run(operation: (signal: AbortSignal) => Promise<void>, failure: string) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setStatus("");
    try {
      await operation(controller.signal);
    } catch {
      if (!controller.signal.aborted) setStatus(failure);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  function loadHistory() {
    if (next === null) return;
    void run(async signal => {
      const page = await listAidtStageHistory(scope.projectId, 6, scope.sessionToken, { beforeRevision: next, limit: 10 }, signal);
      if (signal.aborted) return;
      const confirmed = page.items.filter(item => isConfirmedReportVersion(item, reportEntityId));
      setVersions(previous => [...previous, ...confirmed]);
      setNext(page.nextBeforeRevision);
      if (!confirmed.length) setStatus(page.nextBeforeRevision === null ? "这一页没有确认版本。" : "这一页没有确认版本，可继续读取更早的记录。");
    }, "未能读取小组报告版本。请核对访问权限后重试。");
  }
  function openReport(revision: number) {
    setSource(null);
    setSelected(null);
    void run(async signal => {
      const stage = await readExactReportSource(scope.projectId, 6, revision, scope.sessionToken, signal);
      if (!isConfirmedReportVersion(stage, reportEntityId)) throw new Error("AIDT_REPORT_UNCONFIRMED");
      if (!signal.aborted) setSelected(stage);
    }, "这个确认版本暂时无法读取。请核对访问权限后重试。");
  }
  function exportReport(format: "markdown" | "pdf") {
    if (exportRevision === undefined) return;
    const revision = exportRevision;
    void run(async signal => {
      const markdown = await readConfirmedReportForExport(scope.projectId, revision, scope.sessionToken, signal, reportEntityId);
      if (signal.aborted) return;
      if (format === "pdf") {
        await printAidtUiText(markdown, { isCurrent: () => !signal.aborted });
        if (!signal.aborted) setStatus(`已请求打开 V${revision} 的打印预览，可在浏览器中另存为 PDF。`);
        return;
      }
      const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = artifactFileName(`小组研究报告-V${revision}`);
      try {
        document.body.append(link);
        link.click();
        setStatus(`已请求下载小组报告 V${revision}。`);
      } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    }, `V${revision} 导出未能启动。请核对来源权限或重新尝试；版本仍保留。`);
  }
  return <details className="space-y-3 rounded-lg border border-border p-3 text-12" data-testid="aidt-report-versions">
    <summary className="cursor-pointer font-medium">已确认版本与导出</summary>
    <div className="flex flex-wrap gap-2">
      {confirmedRevision !== undefined && !selected && <Button size="sm" variant="outline" disabled={busy} onClick={() => openReport(confirmedRevision)}>查看确认版 V{confirmedRevision}</Button>}
      {exportRevision !== undefined && <>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => exportReport("markdown")}>下载 V{exportRevision} Markdown</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => exportReport("pdf")}>打印 V{exportRevision} PDF</Button>
      </>}
      {next !== null && <Button size="sm" variant="ghost" disabled={busy} onClick={loadHistory}>{next === undefined ? "读取版本历史" : "读取更早版本"}</Button>}
    </div>
    {versions.length > 0 && <ul aria-label="报告版本历史" className="space-y-2">
      {versions.map(item => <li key={item.revision}><Button size="sm" variant="ghost" disabled={busy} onClick={() => openReport(item.revision)}>查看确认版 V{item.revision} · {new Date(item.updatedAt).toLocaleDateString("zh-CN")}</Button></li>)}
    </ul>}
    {selected && selectedReport && <div className="space-y-3">
      <p>报告 V{selected.revision} · {selected.updatedAt} · 确认者 {selected.updatedBy}</p>
      <article className="chat-markdown" aria-label="已确认报告正文"><MarkdownProse text={selectedReport.markdown} /></article>
      {selectedReport.sourceStageRevisions.length ? <ul aria-label="确认版本来源">
        {selectedReport.sourceStageRevisions.map(item => <li key={item.stageId}><Button size="sm" variant="ghost" disabled={busy} onClick={() => {
          setSource(null);
          void run(async signal => {
            const stage = await readExactReportSource(scope.projectId, item.stageId, item.revision, scope.sessionToken, signal);
            if (!signal.aborted) setSource(stage);
          }, "无法读取该来源版本，请核对项目权限。");
        }}>查看第 {item.stageId} 步 V{item.revision}</Button></li>)}
      </ul> : <p>尚未关联已保存的阶段版本。</p>}
    </div>}
    {source && <div aria-label="来源版本详情"><p>第 {source.stageId} 步 V{source.revision} · {source.updatedAt} · 保存者 {source.updatedBy}</p><pre className="whitespace-pre-wrap break-words font-sans">{aidtUiStageSummary(source.stageId, source.content.draft) || "该来源没有已填写的阶段摘要。"}</pre></div>}
    <p role="status" aria-live="polite">{busy ? "正在读取确认版本或核对来源…" : status}</p>
  </details>;
}
