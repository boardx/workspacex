"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { aidtUiReportMarkdown, type AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { artifactFileName } from "@/lib/chat-workbench/artifact-download";
import { printAidtUiText } from "@/features/aidt/components/aidt-stage-output";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";

export function AidtReportPreview({ drafts, text, sourceRevision, revision, onChange, regenerate, readOnly, toChat }: {
  drafts: AidtUiDrafts; text: string | null; sourceRevision: number; revision: number;
  onChange: (text: string) => void; regenerate: () => void; readOnly: boolean;
  toChat?: (text: string) => ComposerOfferResult;
}) {
  const [status, setStatus] = React.useState("");
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const value = text ?? aidtUiReportMarkdown(drafts);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setStatus("已复制报告草稿。请粘贴到本组聊天并发送，发送成功后才会保存。"); }
    catch { setStatus("未能复制，请在编辑区手动选择内容；尚未保存到小组。"); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([value], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = artifactFileName("小组研究报告 UI 草稿"); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus("已请求下载 Markdown 草稿；下载不会保存到小组空间。");
  }
  return <section className="space-y-4" data-testid="aidt-report-preview">
    <div><span className="rounded-full bg-muted px-2 py-1 text-11 text-muted-foreground">UI 预览 · 未保存</span><h3 className="mt-3 text-20 font-semibold">把研究过程讲清楚</h3><p className="mt-1 text-13 text-muted-foreground">从问题、证据和选择，讲到原型、测试与下一步。</p></div>
    <details className="text-12 text-muted-foreground"><summary className="cursor-pointer">取材范围与缺失项</summary><p className="mt-2">只整理本页填写的草稿，尚未读取全组历史或保存。原始证据、教师点评和版本关系缺失时保留缺口。</p></details>
    {text !== null && sourceRevision !== revision && <p role="status" className="text-12 text-muted-foreground">阶段表单已有变化。当前报告编辑被保留，可主动重新整理；不会自动覆盖你的修改。</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={preview ? "outline" : "primary"} onClick={() => setPreview(false)}>编辑报告</Button><Button size="sm" variant={preview ? "primary" : "outline"} onClick={() => setPreview(true)}>阅读预览</Button><Button size="sm" variant="ghost" disabled={readOnly} onClick={() => text === null ? regenerate() : setConfirmReplace(true)}>从成果重新整理</Button></div>
    {confirmReplace && <div role="alert" className="rounded-lg border border-border p-4" data-testid="aidt-report-replace-confirm"><p className="text-13">重新整理会替换当前报告，包括你的人工修改。</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={readOnly} onClick={() => { regenerate(); setConfirmReplace(false); }}>确认替换</Button><Button size="sm" variant="outline" onClick={() => setConfirmReplace(false)}>保留当前报告</Button></div></div>}
    {preview ? <article aria-label="小组报告阅读预览" className="rounded-xl border border-border bg-card p-4">{value.split("\n").map((line, index) => line.startsWith("# ") ? <h2 className="my-4 text-20 font-semibold" key={index}>{line.slice(2)}</h2> : line.startsWith("## ") ? <h3 className="mb-2 mt-5 text-16 font-semibold" key={index}>{line.slice(3)}</h3> : line.startsWith("### ") ? <h4 className="mb-1 mt-3 text-13 font-medium" key={index}>{line.slice(4)}</h4> : <p className="min-h-3 break-words whitespace-pre-wrap text-13 leading-relaxed" key={index}>{line}</p>)}</article> : <textarea aria-label="小组报告草稿" className="min-h-96 w-full rounded-xl border border-border bg-background p-3 text-13 leading-relaxed" value={value} maxLength={100000} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.value)} />}
    <div className="sticky bottom-0 space-y-2 border-t border-border bg-background py-3"><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={download}>下载 Markdown 草稿</Button><Button variant="outline" onClick={() => { printAidtUiText(value); setStatus("已请求打开打印预览，可选择另存为PDF；是否保存由浏览器决定。"); }}>PDF 打印预览</Button></div>{toChat && <Button className="w-full" disabled={readOnly} onClick={() => {
      const result = toChat(value);
      setStatus(result === "accepted" ? "已带入聊天输入框，审阅并发送后才保存。" : result === "occupied" ? "聊天中已有未发送草稿，未覆盖；请先处理或复制报告。" : "聊天尚未就绪，报告草稿仍保留，请稍后重试。");
    }}>审阅并发送报告到聊天</Button>}<Button variant="outline" className="w-full" onClick={() => void copy()}>复制报告到聊天</Button><p role="status" aria-live="polite" className="text-12 text-muted-foreground">{status}</p></div>
  </section>;
}
