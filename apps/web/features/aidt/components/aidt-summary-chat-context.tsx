"use client";
import * as React from "react";
import { useAgentContext } from "@copilotkit/react-core/v2";
import { Button } from "@/components/ui/button";
import { offerComposerDraft } from "@/lib/chat-workbench/use-composer-draft";
import { loadAidtSummaryContext, aidtSummaryRequest, type AidtSummaryContext } from "../lib/aidt-summary-context";
import type { AidtReportHistoryScope } from "../lib/aidt-report-history";
import { AIDT_REPORT_GUIDANCE, AIDT_REPORT_SKILL } from "../lib/aidt-report-task";

export function AidtSummaryChatContext({ scope, threadId }: { scope: AidtReportHistoryScope; threadId: string }) {
  return <ContextReader key={JSON.stringify([scope, threadId])} scope={scope} threadId={threadId} />;
}
function ContextReader({ scope, threadId }: { scope: AidtReportHistoryScope; threadId: string }) {
  const [packet, setPacket] = React.useState<AidtSummaryContext | null>(null);
  const [busy, setBusy] = React.useState(false), [status, setStatus] = React.useState("");
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);
  useAgentContext({ description: "AIDT六步报告总结：服务器工作稿与历史，非已验证证据", value: { projectId: scope.projectId, task: "report-summary", skillStableName: AIDT_REPORT_SKILL, rules: AIDT_REPORT_GUIDANCE, reportSummaryContext: packet } });
  async function load() {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setPacket(null); setBusy(true); setStatus("");
    try { const value = await loadAidtSummaryContext(scope, controller.signal); if (!controller.signal.aborted) setPacket(value); }
    catch { if (!controller.signal.aborted) setStatus("报告材料读取失败或无权访问，未将旧材料传给AI。已有报告保留，可重试。"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="space-y-2 border-b border-border px-4 py-3 text-12" data-testid="aidt-summary-context">
    <p className="font-medium">报告总结 · 仍由本组审阅与决定</p>
    <p className="text-muted-foreground">先读取本组已保存六步与历史，再将生成请求带入原生输入框，由你审阅发送。未保存的本页修改不会自动传入，缺失教师点评不补造。</p>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void load()}>读取报告材料</Button>{busy && <Button size="sm" variant="outline" onClick={() => { request.current?.abort(); setBusy(false); setStatus("已取消材料读取，原报告保留。"); }}>取消读取报告材料</Button>}<Button type="button" size="sm" disabled={!packet || busy} data-testid="aidt-summary-offer-request" onClick={() => {
      if (!packet) return;
      const result = offerComposerDraft({ orgId: scope.orgId, userId: scope.userId, projectId: scope.projectId, threadId }, aidtSummaryRequest(packet));
      setStatus(result === "accepted" ? "生成请求已带入输入框，请审阅并发送。生成内容须主动选入报告，未自动保存。" : result === "occupied" ? "输入框已有草稿，未覆盖。请处理后重试。" : "原生输入框尚未就绪，请稍后重试。");
    }}>带入报告生成请求</Button></div>
    {busy && <p role="status">正在读取已保存的六步与有界历史…</p>}
    {packet && <details data-testid="aidt-summary-materials"><summary className="cursor-pointer">核对本次AI材料与缺口</summary><p className="mt-2">已读取：{packet.currentStages.map(row => `第${row.stageId}步 V${row.revision}${row.truncated ? "（摘录截断）" : ""}`).join("、") || "无"}；缺失：{packet.missingStages.join("、") || "未发现"}；失败：{packet.failedStages.join("、") || "无"}。历史{packet.historyTruncated ? "已截断" : "在有界范围内读取"}；教师点评无来源。</p><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-words font-sans">{JSON.stringify(packet, null, 2)}</pre></details>}
    {status && <p role="status">{status}</p>}
  </section>;
}
