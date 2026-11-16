"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import type { AidtReportHistoryScope } from "../lib/aidt-report-history";
import { loadAidtSummaryChoices, readAidtSummaryChoice, aidtSummaryImportMarkdown, aidtSummarySourceReviewLines, type AidtSummaryChoice } from "../lib/aidt-summary-results";

export function AidtSummaryImport(props: { scope: AidtReportHistoryScope; threadId: string | null; value: string; readOnly: boolean; onChange: (text: string) => void }) {
  return <Importer key={JSON.stringify([props.scope, props.threadId, props.readOnly])} {...props} />;
}
function Importer({ scope, threadId, value, readOnly, onChange }: { scope: AidtReportHistoryScope; threadId: string | null; value: string; readOnly: boolean; onChange: (text: string) => void }) {
  const [choices, setChoices] = React.useState<AidtSummaryChoice[]>([]), [selected, setSelected] = React.useState<AidtSummaryChoice | null>(null);
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof readAidtSummaryChoice>> | null>(null);
  const [busy, setBusy] = React.useState(false), [reviewed, setReviewed] = React.useState(false), [status, setStatus] = React.useState("");
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);
  async function read(choice?: AidtSummaryChoice) {
    if (!threadId) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy(true); setResult(null); setReviewed(false); setStatus(""); setSelected(choice ?? null);
    if (!choice) setChoices([]);
    try {
      if (choice) { const source = await readAidtSummaryChoice(scope, threadId, choice, controller.signal); if (!controller.signal.aborted) setResult(source); }
      else {
        const source = await loadAidtSummaryChoices(scope, threadId, controller.signal);
        if (!controller.signal.aborted) { setChoices(source.choices); setStatus(`${source.choices.length ? "已读取真实AI消息/原生产物，请选择并核对。" : "本总结对话尚无可导入的AI结果；先在原生聊天发送生成请求。"}${source.truncated ? "读取范围已截断，旧结果可能未列入。" : ""}${source.artifactsUnavailable ? "产物列表读取失败；真实消息仍可选择。" : ""}`); }
      }
    } catch { if (!controller.signal.aborted) { setChoices([]); setSelected(null); setStatus("总结结果读取失败、权限变化或版本已变；没有导入内容，报告编辑保留。请重试。"); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const appendix = result && threadId ? `\n\n${aidtSummaryImportMarkdown(threadId, result)}` : "";
  const sourceLines = result ? aidtSummarySourceReviewLines(result.sourceReview) : [];
  return <details className="space-y-3 rounded-lg border border-border p-3 text-12" data-testid="aidt-summary-import">
    <summary className="cursor-pointer font-medium">选择AI总结结果带入报告</summary>
    <p className="mt-2 text-muted-foreground">只读取本组已挂总结Skill的对话。选择消息或产物后先审阅，再主动追加；保留原文，不自动保存。个人草稿产物在你导入并保存报告后会成为本组报告内容。</p>
    {!threadId && <p>先打开报告引导师完成总结，再返回此处。</p>}
    <Button type="button" size="sm" variant="outline" disabled={!threadId || busy} onClick={() => void read()}>读取AI总结结果</Button>
    {busy && <Button type="button" size="sm" variant="outline" onClick={() => { request.current?.abort(); setBusy(false); setStatus("已取消读取，报告保留。"); }}>取消读取AI结果</Button>}
    {choices.length > 0 && <label className="block">选择要审阅的AI结果<select aria-label="选择要审阅的AI结果" className="mt-2 block w-full rounded border border-border bg-background p-2" disabled={busy} value={selected ? `${selected.kind}:${selected.id}` : ""} onChange={event => { const choice = choices.find(row => `${row.kind}:${row.id}` === event.currentTarget.value); if (choice) void read(choice); }}><option value="">请选择，不自动采用</option>{choices.map(choice => <option key={`${choice.kind}:${choice.id}`} value={`${choice.kind}:${choice.id}`}>{choice.kind === "artifact" ? "产物" : "消息"} · {choice.title}</option>)}</select></label>}
    {result && <>
      <section aria-label="所选AI结果的来源核对" data-testid="aidt-summary-source-review" className="space-y-2 rounded border border-border p-3">
        <p className="font-medium">先核对来源，再审阅报告</p>
        {sourceLines.slice(0, 3).map(line => <p key={line}>{line}</p>)}
        {result.sourceReview.status === "available" && <>
          <details><summary className="cursor-pointer">查看未读材料与应用状态</summary><ul className="mt-2 list-disc space-y-1 pl-4">{sourceLines.slice(3, -1).map((line, index) => <li key={index}>{line}</li>)}</ul></details>
          <p className="text-muted-foreground">{sourceLines.at(-1)}</p>
        </>}
      </section>
      <pre data-testid="aidt-summary-result-preview" className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 font-sans">{result.markdown}</pre><p>来源消息：{result.choice.messageId} · 运行：{result.choice.runId}{result.immutableRevision ? ` · ${result.immutableRevision}` : ""}</p><label className="flex gap-2"><input type="checkbox" disabled={readOnly} checked={reviewed} onChange={event => setReviewed(event.currentTarget.checked)} />我已核对AI草稿、材料缺口与点评来源</label><Button size="sm" disabled={readOnly || busy || !reviewed || value.length + appendix.length > 100000} onClick={() => { onChange(value + appendix); setResult(null); setReviewed(false); setStatus("已将所选AI草稿追加到编辑区，原文保留。请修改、核对来源后主动保存；导入不代表文件导出成功。"); }} data-testid="aidt-summary-import-apply">追加所选AI草稿到报告</Button>{value.length + appendix.length > 100000 && <p role="alert">追加后超过报告长度限制，请先精简当前稿。未更改正文。</p>}
    </>}
    {status && <p role="status">{status}</p>}
  </details>;
}
