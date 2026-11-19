"use client";
import * as React from "react";
import type { AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { aidtSummaryContextSelector } from "../lib/aidt-native-context-selector";
import { Button } from "@/components/ui/button";
import { offerComposerDraft } from "@/lib/chat-workbench/use-composer-draft";
import { loadAidtSummaryContext, aidtSummaryRequest, type AidtSummaryContext } from "../lib/aidt-summary-context";
import type { AidtReportHistoryScope } from "../lib/aidt-report-history";


type Props = { scope: AidtReportHistoryScope; threadId: string; onSelectorChange?: (selector: AidtContextSelector | null) => void };
export function AidtSummaryChatContext(props: Props) {
  return <ContextReader key={JSON.stringify([props.scope, props.threadId])} {...props} />;
}
function ContextReader({ scope, threadId, onSelectorChange }: Props) {
  const [packet, setPacket] = React.useState<AidtSummaryContext | null>(null);
  const [busy, setBusy] = React.useState(false), [status, setStatus] = React.useState("");
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);
  const selectorCallback = React.useRef(onSelectorChange); selectorCallback.current = onSelectorChange;
  React.useEffect(() => { selectorCallback.current?.(null); return () => selectorCallback.current?.(null); }, []);
  async function load() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setPacket(null); selectorCallback.current?.(null); setBusy(true); setStatus("");
    try { const value = await loadAidtSummaryContext(scope, controller.signal); if (!controller.signal.aborted) { const selector = aidtSummaryContextSelector(scope.projectId, value); setPacket(value); selectorCallback.current?.(selector); } }
    catch { if (!controller.signal.aborted) setStatus("报告材料读取失败或无权访问，未将旧材料传给AI。已有报告保留，可重试。"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="space-y-1 border-b border-border px-3 py-2 text-12" data-testid="aidt-summary-context">
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void load()}>读取报告材料</Button>{busy && <Button size="sm" variant="outline" onClick={() => { request.current?.abort(); setBusy(false); setStatus("已取消材料读取，原报告保留。"); }}>取消读取报告材料</Button>}<Button type="button" size="sm" disabled={!packet || busy} data-testid="aidt-summary-offer-request" onClick={() => {
      if (!packet) return;
      const result = offerComposerDraft({ orgId: scope.orgId, userId: scope.userId, projectId: scope.projectId, threadId }, aidtSummaryRequest(packet));
      setStatus(result === "accepted" ? "生成请求已带入输入框，请审阅并发送。生成内容须主动选入报告，未自动保存。" : result === "occupied" ? "输入框已有草稿，未覆盖。请处理后重试。" : "原生输入框尚未就绪，请稍后重试。");
    }}>带入报告生成请求</Button></div>
    {busy && <p role="status">正在读取已保存的六步与有界历史…</p>}
    {packet && (packet.historyTruncated || packet.currentStages.some(row => row.truncated) || packet.existingSavedReport?.truncated) && <p role="status" data-testid="aidt-summary-materials-truncated">材料预览已截断，未展示全部正文。版本选择不表示模型已读全文；发送后的实际范围请核对运行材料回执。</p>}
    {packet && <details data-testid="aidt-summary-materials" aria-label="报告材料范围" className="space-y-2 rounded border border-border px-2 py-1">
      <summary className="cursor-pointer font-medium">核对报告材料</summary>
      <p>本次选择：{packet.currentStages.map(row => `第${row.stageId}步 V${row.revision}${row.truncated ? "（预览摘录截断）" : ""}`).join("、") || "无已保存阶段"}。</p>
      <p>缺失步骤：{packet.missingStages.join("、") || "无"}；读取失败：{packet.failedStages.join("、") || "无"}；教师点评无来源。</p>
      <p className="mt-2">历史选择：{packet.historyRevisions.map(row => `第${row.stageId}步 V${row.revision}`).join("、") || "无"}。历史预览{packet.historyTruncated ? "已截断" : "在有界范围内读取"}；旧轮次与原型版本需逐项核对。</p>
      <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-sans">{JSON.stringify(packet, null, 2)}</pre>
    </details>}
    {status && <p role="status">{status}</p>}
  </section>;
}
