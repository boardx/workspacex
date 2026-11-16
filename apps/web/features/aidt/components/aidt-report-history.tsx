"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { aidtReportHistoryMarkdown, collectAidtReportHistory, type AidtReportHistoryScope } from "../lib/aidt-report-history";

/** Key all authorization dimensions so old rows disappear synchronously on account/project changes. */
export function AidtReportHistory({ scope, ...props }: { scope: AidtReportHistoryScope; value: string; onChange: (value: string) => void; readOnly: boolean }) {
  return <HistoryReader key={JSON.stringify([scope.projectId, scope.orgId, scope.userId, scope.sessionToken, scope.lifecycleKey, props.readOnly])} scope={scope} {...props} />;
}
function HistoryReader({ scope, value, onChange, readOnly }: { scope: AidtReportHistoryScope; value: string; onChange: (value: string) => void; readOnly: boolean }) {
  const [chapter, setChapter] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [reviewed, setReviewed] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const request = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => request.current?.abort(), []);
  async function load() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setChapter(null); setReviewed(false); setMessage("");
    try {
      const result = await collectAidtReportHistory(scope, controller.signal);
      if (!controller.signal.aborted) setChapter(aidtReportHistoryMarkdown(result));
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error && error.message === "AIDT_HISTORY_ACCESS_DENIED" ? "当前登录无法访问本组历史，已清除本次读取结果。请核对项目权限后重试。" : "历史读取失败，本次没有插入内容。当前报告编辑保留，可重试。");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  const appendix = chapter ? `\n\n${chapter}\n` : "";
  const tooLong = value.length + appendix.length > 100000;
  return <details className="space-y-3 rounded-lg border border-border p-3 text-12" data-testid="aidt-report-history">
    <summary className="cursor-pointer font-medium">审阅历史学习并加入报告</summary>
    <p className="mt-2 text-muted-foreground">读取本组服务器历史，不自动修改或保存报告。每步最多10版、总计60版，最长20秒；缺失、失败、截断和未决定均会保留。</p>
    <p className="text-muted-foreground">历史版本与轮次关系写入报告正文；保存回执中的阶段来源仍按现有规则记录，不代表所有历史引用都已核实。</p>
    <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}>读取历史学习记录</Button>{loading && <Button type="button" size="sm" variant="outline" onClick={() => { request.current?.abort(); setLoading(false); setChapter(null); setReviewed(false); setMessage("已取消历史读取，报告编辑保留。"); }}>取消历史读取</Button>}</div>
    {loading && <p role="status">正在读取历史；当前报告可继续编辑…</p>}
    {chapter && <>
      <pre data-testid="aidt-report-history-chapter" className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-sans">{chapter}</pre>
      <label className="flex gap-2"><input type="checkbox" checked={reviewed} disabled={readOnly} onChange={event => setReviewed(event.currentTarget.checked)} />我已审阅来源版本、学习决定与缺失项</label>
      {tooLong && <p role="alert">加入后超过报告10万字限制，请先精简当前报告；编辑稿没有被改动。</p>}
      <Button type="button" size="sm" disabled={readOnly || !reviewed || tooLong} onClick={() => {
        onChange(value + appendix); setChapter(null); setReviewed(false); setMessage("已追加所审阅的历史章节，保留原有报告正文。请审阅完整报告，再主动保存到小组。");
      }}>追加历史章节到当前报告</Button>
    </>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </details>;
}
