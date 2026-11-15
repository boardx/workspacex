"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { aidtUiReportMarkdown, type AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { artifactFileName } from "@/lib/chat-workbench/artifact-download";
import { printAidtUiText } from "@/features/aidt/components/aidt-stage-output";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import type { AidtSharedReportController } from "@/features/aidt/lib/use-aidt-shared-stages";
import { useOptionalSession } from "@/components/session/session-provider";

export function AidtReportPreview({ drafts, text, sourceRevision, revision, onChange, regenerate, readOnly, toChat, shared, discoveryCardsRevision }: {
  drafts: AidtUiDrafts; discoveryCardsRevision?: number; text: string | null; sourceRevision: number; revision: number;
  onChange: (text: string) => void; regenerate: () => void; readOnly: boolean;
  toChat?: (text: string) => ComposerOfferResult;
  shared?: AidtSharedReportController;
}) {
  const [status, setStatus] = React.useState("");
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  const [preview, setPreview] = React.useState(false);
  const [confirmRestore, setConfirmRestore] = React.useState(false);
  const me = useOptionalSession()?.session?.userId;
  const savedTime = shared?.savedAt ? new Date(shared.savedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const value = text ?? aidtUiReportMarkdown(drafts, { discoveryCardsRevision });
  const exportValue = shared?.matchesServer ? [value, "", "## 保存与来源版本", `报告保存版本：${shared.serverRevision}；保存者：${shared.savedBy}；保存时间：${shared.savedAt}`, ...(shared.sourceStageRevisions?.length ? shared.sourceStageRevisions.map((source) => `- 第 ${source.stageId} 步：版本 ${source.revision}`) : ["尚未关联已保存的阶段版本；正文不因此成为已验证研究事实。"]), ""].join("\n") : value;
  async function copy() {
    try { await navigator.clipboard.writeText(exportValue); setStatus("已复制报告。粘贴并发送成功后才会保存到对话；报告共享状态以上方回执为准。"); }
    catch { setStatus("未能复制，请在编辑区手动选择内容。报告编辑与共享保存状态未被改变。"); }
  }
  function download() {
    let url: string | null = null;
    try {
      url = URL.createObjectURL(new Blob([exportValue], { type: "text/markdown;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = artifactFileName("小组研究报告"); document.body.append(a);
      try { a.click(); } finally { a.remove(); }
      setStatus("已请求下载 Markdown 草稿；下载不会保存到小组空间。");
    } catch { setStatus("下载未能启动，报告编辑仍保留。可重试或复制内容。"); }
    finally { if (url) { const requestedUrl = url; setTimeout(() => URL.revokeObjectURL(requestedUrl), 1000); } }
  }
  return <section className="space-y-4" data-testid="aidt-report-preview">
    <div><span className="rounded-full bg-muted px-2 py-1 text-11 text-muted-foreground" data-testid="aidt-report-save-state">{shared ? shared.saving ? "正在保存小组报告…" : shared.matchesServer ? "小组报告已保存" : "报告编辑尚未保存" : "UI 预览 · 未保存"}</span><h3 className="mt-3 text-20 font-semibold">把研究过程讲清楚</h3><p className="mt-1 text-13 text-muted-foreground">从问题、证据和选择，讲到原型、测试与下一步。</p></div>
    <details className="text-12 text-muted-foreground"><summary className="cursor-pointer">取材范围与缺失项</summary><p className="mt-2">{shared ? "从本页已读取的阶段成果与学生当前编辑整理，未保存的阶段修改不自动成为已保存来源。报告按小组保存，原始材料仍由各原生模块授权读取。" : "只整理本页填写的草稿，尚未读取全组历史或保存。"}原始证据、教师点评和版本关系缺失时保留缺口。</p></details>
    {shared && <section className="space-y-2 rounded-lg border border-border p-3 text-12" aria-label="小组报告保存" data-testid="aidt-shared-report">
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={readOnly || !shared.canSave || shared.saving} data-testid="aidt-report-save" onClick={() => void shared.save()}>{shared.saving ? "正在保存…" : "保存小组报告"}</Button><Button size="sm" variant="outline" disabled={shared.saving || shared.loading} data-testid="aidt-report-reload" onClick={shared.reload}>重新读取</Button></div>
      {shared.loading && <p role="status">正在读取小组报告…</p>}
      {shared.savedAt && <details data-testid="aidt-report-receipt"><summary className="cursor-pointer text-muted-foreground">{savedTime} · {shared.savedBy === me ? "你" : "组员"}保存 · V{shared.serverRevision}</summary><p className="mt-2 break-all">服务器版本 {shared.serverRevision} · {shared.savedAt} · 保存者 {shared.savedBy}</p>{shared.sourceStageRevisions && <div className="mt-2" data-testid="aidt-report-source-versions"><p>来源版本</p><ul className="mt-1 space-y-1">{shared.sourceStageRevisions.length ? shared.sourceStageRevisions.map((source) => <li key={source.stageId}>第 {source.stageId} 步 · 版本 {source.revision}</li>) : <li>尚未关联已保存阶段版本；保留材料缺口。</li>}</ul></div>}</details>}
      {(shared.error || shared.loadError) && <p role="alert" data-testid="aidt-report-save-error">{shared.error ?? shared.loadError} 当前编辑保留。</p>}
      {(shared.conflict || shared.needsBaseReview) && <div className="space-y-2" data-testid="aidt-report-conflict"><p>服务器已有其他修改。先比较，再决定保存本页编辑；不会自动覆盖。</p><details><summary className="cursor-pointer">查看服务器报告</summary><p className="mt-2 whitespace-pre-wrap break-words">{shared.serverMarkdown ?? "服务器尚无报告正文"}</p></details><Button size="sm" variant="outline" disabled={readOnly || shared.saving || shared.loading || Boolean(shared.loadError)} data-testid="aidt-report-review-base" onClick={shared.reviewBase}>已比较，使用当前服务器版本为保存基准</Button></div>}
      {shared.serverMarkdown !== null && !shared.matchesServer && <Button size="sm" variant="ghost" disabled={readOnly || shared.saving} data-testid="aidt-report-restore" onClick={() => setConfirmRestore(true)}>恢复服务器报告到编辑区</Button>}
      {confirmRestore && <div role="alert" className="space-y-2" data-testid="aidt-report-restore-confirm"><p>替换当前报告编辑？未保存的报告修改将被替换，阶段成果与服务器报告不会被删除。</p><div className="flex gap-2"><Button size="sm" disabled={readOnly || shared.saving} onClick={() => { shared.restore(); setConfirmRestore(false); }}>确认恢复报告</Button><Button size="sm" variant="outline" onClick={() => setConfirmRestore(false)}>保留当前报告</Button></div></div>}
      {!shared.available && !shared.loading && <p>报告保存尚未就绪，可保留编辑或导出；不显示假保存回执。</p>}
    </section>}
    {text !== null && sourceRevision !== revision && <p role="status" className="text-12 text-muted-foreground">阶段表单已有变化。当前报告编辑被保留，可主动重新整理；不会自动覆盖你的修改。</p>}
    <div className="flex flex-wrap gap-2"><Button size="sm" variant={preview ? "outline" : "primary"} onClick={() => setPreview(false)}>编辑报告</Button><Button size="sm" variant={preview ? "primary" : "outline"} onClick={() => setPreview(true)}>阅读预览</Button><Button size="sm" variant="ghost" disabled={readOnly} onClick={() => text === null ? regenerate() : setConfirmReplace(true)}>从成果重新整理</Button></div>
    {confirmReplace && <div role="alert" className="rounded-lg border border-border p-4" data-testid="aidt-report-replace-confirm"><p className="text-13">重新整理会替换当前报告，包括你的人工修改。</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={readOnly} onClick={() => { regenerate(); setConfirmReplace(false); }}>确认替换</Button><Button size="sm" variant="outline" onClick={() => setConfirmReplace(false)}>保留当前报告</Button></div></div>}
    {preview ? <article aria-label="小组报告阅读预览" className="rounded-xl border border-border bg-card p-4">{value.split("\n").map((line, index) => line.startsWith("# ") ? <h2 className="my-4 text-20 font-semibold" key={index}>{line.slice(2)}</h2> : line.startsWith("## ") ? <h3 className="mb-2 mt-5 text-16 font-semibold" key={index}>{line.slice(3)}</h3> : line.startsWith("### ") ? <h4 className="mb-1 mt-3 text-13 font-medium" key={index}>{line.slice(4)}</h4> : <p className="min-h-3 break-words whitespace-pre-wrap text-13 leading-relaxed" key={index}>{line}</p>)}</article> : <textarea aria-label="小组报告草稿" className="min-h-96 w-full rounded-xl border border-border bg-background p-3 text-13 leading-relaxed" value={value} maxLength={100000} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.value)} />}
    <div className="space-y-3 border-t border-border bg-background py-3" data-testid="aidt-report-export-actions"><div className="grid grid-cols-2 gap-2"><Button variant="outline" onClick={download}>下载 Markdown 草稿</Button><Button variant="outline" onClick={() => {
      try { printAidtUiText(exportValue); setStatus("已请求打开打印预览，可选择另存为PDF；是否保存由浏览器决定。"); }
      catch { setStatus("打印预览未能打开，报告编辑仍保留。可重试或下载 Markdown。"); }
    }}>PDF 打印预览</Button></div><details data-testid="aidt-report-chat-actions"><summary className="cursor-pointer text-12 text-muted-foreground">把报告用于本组对话</summary><div className="mt-3 flex flex-wrap gap-2">{toChat && <Button size="sm" disabled={readOnly} onClick={() => {
      const result = toChat(exportValue);
      setStatus(result === "accepted" ? "已带入聊天输入框，审阅并发送后保存对话；报告共享状态以上方回执为准。" : result === "occupied" ? "聊天中已有未发送草稿，未覆盖；请先处理或复制报告。" : "聊天尚未就绪，报告草稿仍保留，请稍后重试。");
    }}>审阅并发送报告到聊天</Button>}<Button variant="outline" size="sm" onClick={() => void copy()}>复制报告到聊天</Button></div></details><p role="status" aria-live="polite" className="text-12 text-muted-foreground">{status}</p></div>
  </section>;
}
