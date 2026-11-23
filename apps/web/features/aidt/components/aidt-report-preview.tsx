"use client";
import * as React from "react";
import { MarkdownProse } from "@/components/chat/markdown-prose";
import { Button } from "@/components/ui/button";
import { aidtUiReportMarkdown, type AidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { artifactFileName } from "@/lib/chat-workbench/artifact-download";
import { printAidtUiText } from "@/features/aidt/components/aidt-stage-output";
import type { ComposerOfferResult } from "@/lib/chat-workbench/use-composer-draft";
import type { AidtSharedReportController } from "@/features/aidt/lib/use-aidt-shared-stages";
import { useOptionalSession } from "@/components/session/session-provider";
import { AidtReportHistory } from "./aidt-report-history";
import type { AidtReportHistoryScope } from "../lib/aidt-report-history";
import { AidtReportVersions } from "./aidt-report-versions";
import { AidtSummaryImport } from "./aidt-summary-import";
import type { AidtReportReviewView } from "../lib/use-aidt-report-review";

export function AidtReportPreview({ drafts, text, sourceRevision, revision, onChange, regenerate, readOnly, toChat, shared, discoveryCardsRevision, historyScope, onOpenSummary, summaryThread, reportEntityId, initialPreview = false, reviewView }: {
  drafts: AidtUiDrafts; discoveryCardsRevision?: number; text: string | null; sourceRevision: number; revision: number;
  onChange: (text: string) => void; regenerate: () => void; readOnly: boolean;
  toChat?: (text: string) => ComposerOfferResult;
  shared?: AidtSharedReportController;
  historyScope?: AidtReportHistoryScope;
  onOpenSummary?: () => void; summaryThread?: string | null; reportEntityId?: string; initialPreview?: boolean; reviewView?: AidtReportReviewView;
}) {
  const [status, setStatus] = React.useState("");
  const [confirmReplace, setConfirmReplace] = React.useState(false);
  const [localPreview, setLocalPreview] = React.useState(initialPreview);
  const [localReviewRevision, setLocalReviewRevision] = React.useState<number | null>(null);
  const preview = reviewView?.preview ?? localPreview;
  const reviewRevision = reviewView ? reviewView.reviewRevision : localReviewRevision;
  const setPreview = reviewView?.setPreview ?? setLocalPreview;
  const setReviewRevision = (value: number | null) => reviewView
    ? value === null ? reviewView.clearReview() : reviewView.review()
    : setLocalReviewRevision(value);
  const [confirmRestore, setConfirmRestore] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  const session = useOptionalSession()?.session;
  const me = session?.userId;
  const savedTime = shared?.savedAt ? new Date(shared.savedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
  const value = text ?? aidtUiReportMarkdown(drafts, { discoveryCardsRevision, projectId: historyScope?.projectId });
  const exportValue = shared?.matchesServer ? [value, "", "## 保存与来源版本", `报告保存版本：${shared.serverRevision}；保存者：${shared.savedBy}；保存时间：${shared.savedAt}`, ...(shared.sourceStageRevisions?.length ? shared.sourceStageRevisions.map((source) => `- 第 ${source.stageId} 步：版本 ${source.revision}`) : ["尚未关联已保存的阶段版本；正文不因此成为已验证研究事实。"]), ""].join("\n") : value;
  const printScope = JSON.stringify([session?.currentOrgId, session?.userId, session?.sessionToken, historyScope?.projectId, historyScope?.lifecycleKey, readOnly, revision, sourceRevision]);
  const printLifecycle = React.useRef({ scope: printScope, value: exportValue, active: true, generation: 0 });
  if (printLifecycle.current.scope !== printScope || printLifecycle.current.value !== exportValue) { printLifecycle.current.scope = printScope; printLifecycle.current.value = exportValue; printLifecycle.current.generation++; }
  React.useEffect(() => { const current = printLifecycle.current; current.active = true; return () => { current.active = false; }; }, []);
  async function print() {
    if (printing) return;
    const generation = printLifecycle.current.generation;
    const isCurrent = () => printLifecycle.current.active && printLifecycle.current.generation === generation;
    setPrinting(true);
    try { const result = await printAidtUiText(exportValue, { isCurrent }); if (isCurrent()) setStatus(result === "cancelled" ? "已关闭打印预览，报告未改变。" : "已请求系统打印。是否另存成功请核对实际 PDF 文件。"); }
    catch { if (printLifecycle.current.active) setStatus(isCurrent() ? "打印预览未能打开，报告编辑仍保留。可重试或下载 Markdown。" : "报告内容或访问状态已变化，未打印旧稿。请重新核对后重试。"); }
    finally { if (printLifecycle.current.active) setPrinting(false); }
  }
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
  return <section className="mx-auto w-full max-w-4xl space-y-4" data-testid="aidt-report-preview">
    <div><span className="rounded-full bg-muted px-2 py-1 text-11 text-muted-foreground" data-testid="aidt-report-save-state">{shared ? shared.saving ? "正在保存小组报告…" : shared.matchesServer ? shared.confirmedAtRevision ? `小组报告已确认 · V${shared.confirmedAtRevision}` : "小组报告已保存 · 待确认" : "报告编辑尚未保存" : "UI 预览 · 未保存"}</span></div>
    <div className="sticky top-0 z-10 flex flex-wrap gap-2 border-b border-border-subtle bg-card py-2"><Button size="sm" variant={preview ? "outline" : "primary"} onClick={() => setPreview(false)}>编辑报告</Button><Button size="sm" variant={preview ? "primary" : "outline"} onClick={() => setPreview(true)}>阅读预览</Button><Button size="sm" variant="ghost" disabled={readOnly} onClick={() => text === null ? regenerate() : setConfirmReplace(true)}>从成果重新整理</Button>{shared && <Button size="sm" disabled={readOnly || !shared.canSave || shared.saving} data-testid="aidt-report-save" onClick={() => void shared.save()}>{shared.saving ? "正在保存…" : "保存小组报告"}</Button>}{reportEntityId === undefined && <div className="flex flex-wrap gap-2 sm:ml-auto" data-testid="aidt-report-export-actions"><Button size="sm" variant="outline" onClick={download}>下载 Markdown 草稿</Button><Button size="sm" variant="outline" disabled={printing} onClick={() => void print()}>PDF 打印预览</Button></div>}</div>
    {preview && shared?.confirm && shared.matchesServer && shared.confirmedAtRevision === undefined && <div className="space-y-2">
      <Button size="sm" disabled={readOnly || !shared.canConfirm} onClick={() => setReviewRevision(shared.serverRevision)}>确认审阅此版本</Button>
      {reviewRevision !== null && reviewRevision === shared.serverRevision && <div role="alert" className="space-y-2">
        <p>确认后冻结当前正文和来源版本。后续修改可另存新版本。</p>
        <Button size="sm" disabled={readOnly || !shared.canConfirm} onClick={() => { if (reviewView && !reviewView.takeReview()) return; if (!reviewView) setReviewRevision(null); void shared.confirm?.(); }}>确认小组报告</Button>
        <Button size="sm" variant="ghost" onClick={() => setReviewRevision(null)}>继续审阅</Button>
      </div>}
    </div>}
    {historyScope && shared && <AidtReportVersions scope={historyScope} confirmedRevision={shared.confirmedAtRevision} reportEntityId={reportEntityId} />}
    {confirmReplace && <div role="alert" className="rounded-lg border border-border p-4" data-testid="aidt-report-replace-confirm"><p className="text-13">重新整理会替换当前报告，包括你的人工修改。</p><div className="mt-3 flex gap-2"><Button size="sm" disabled={readOnly} onClick={() => { regenerate(); setConfirmReplace(false); }}>确认替换</Button><Button size="sm" variant="outline" onClick={() => setConfirmReplace(false)}>保留当前报告</Button></div></div>}
    {preview ? <article aria-label="小组报告阅读预览" className="chat-markdown rounded-xl border border-border bg-card p-4 text-14 leading-relaxed sm:p-6"><MarkdownProse text={value} /></article> : <textarea aria-label="小组报告草稿" className="min-h-[max(24rem,52dvh)] w-full rounded-xl border border-border bg-background p-3 text-13 leading-relaxed" value={value} maxLength={100000} disabled={readOnly} onChange={(e) => onChange(e.currentTarget.value)} />}
    <details className="text-12 text-muted-foreground"><summary className="cursor-pointer">取材范围与缺失项</summary><p className="mt-2">{shared ? "从本页已读取的阶段成果与学生当前编辑整理，未保存的阶段修改不自动成为已保存来源。报告按小组保存，原始材料仍由各原生模块授权读取。" : historyScope ? "主体整理本页填写的草稿，历史需主动读取、审阅并加入；读取本身不保存报告。" : "只整理本页填写的草稿，尚未读取全组历史或保存。"}原始证据、教师点评和版本关系缺失时保留缺口。</p></details>
    {shared?.chooseSources && Boolean(shared.availableSources?.length) && <details className="space-y-2 rounded-lg border border-border p-3 text-12">
      <summary className="cursor-pointer font-medium">选择报告引用的阶段版本</summary>
      <p className="text-muted-foreground">只有选中的服务器版本会写入来源回执。如上游有更新，请核对报告正文后再切换。</p>
      {shared.availableSources?.map(available => {
        const selected = shared.selectedSources ?? [];
        const current = selected.find(ref => ref.stageId === available.stageId);
        return <label key={available.stageId} className="flex gap-2">
          <span>第 {available.stageId} 步</span>
          <select disabled={readOnly || shared.saving || shared.loading} value={current?.revision ?? ""} onChange={event => {
            const revision = Number(event.currentTarget.value);
            const others = selected.filter(ref => ref.stageId !== available.stageId);
            shared.chooseSources?.((revision ? [...others, { stageId: available.stageId, revision }] : others).sort((a, b) => a.stageId - b.stageId));
          }} className="rounded border border-border bg-background">
            <option value="">不引用</option>
            {current && current.revision !== available.revision && <option value={current.revision}>V{current.revision}（已选历史版本）</option>}
            <option value={available.revision}>V{available.revision}（当前保存版本）</option>
          </select>
        </label>;
      })}
    </details>}
    {historyScope && <AidtReportHistory scope={historyScope} value={value} onChange={onChange} readOnly={readOnly} />}
    {onOpenSummary && <div className="space-y-2 text-12"><Button type="button" size="sm" disabled={readOnly} onClick={onOpenSummary} data-testid="aidt-open-summary-chat">打开报告引导师</Button></div>}
    {historyScope && onOpenSummary && <AidtSummaryImport scope={historyScope} threadId={summaryThread ?? null} value={value} onChange={onChange} readOnly={readOnly} />}
    {shared && <section className="space-y-2 rounded-lg border border-border p-3 text-12" aria-label="小组报告保存" data-testid="aidt-shared-report">
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={shared.saving || shared.loading} data-testid="aidt-report-reload" onClick={shared.reload}>重新读取</Button></div>
      {shared.loading && <p role="status">正在读取小组报告…</p>}
      {shared.savedAt && <details data-testid="aidt-report-receipt"><summary className="cursor-pointer text-muted-foreground">{savedTime} · {shared.savedBy === me ? "你" : "组员"}保存 · V{shared.serverRevision}</summary><p className="mt-2 break-all">服务器版本 {shared.serverRevision} · {shared.savedAt} · 保存者 {shared.savedBy}</p>{shared.sourceStageRevisions && <div className="mt-2" data-testid="aidt-report-source-versions"><p>来源版本</p><ul className="mt-1 space-y-1">{shared.sourceStageRevisions.length ? shared.sourceStageRevisions.map((source) => <li key={source.stageId}>第 {source.stageId} 步 · 版本 {source.revision}</li>) : <li>尚未关联已保存阶段版本；保留材料缺口。</li>}</ul></div>}</details>}
      {(shared.error || shared.loadError) && <p role="alert" data-testid="aidt-report-save-error">{shared.error ?? shared.loadError} 当前编辑保留。</p>}
      {(shared.conflict || shared.needsBaseReview) && <div className="space-y-2" data-testid="aidt-report-conflict"><p>服务器已有其他修改。先比较，再决定保存本页编辑；不会自动覆盖。</p><details><summary className="cursor-pointer">查看服务器报告</summary><p className="mt-2 whitespace-pre-wrap break-words">{shared.serverMarkdown ?? "服务器尚无报告正文"}</p></details><Button size="sm" variant="outline" disabled={readOnly || shared.saving || shared.loading || Boolean(shared.loadError)} data-testid="aidt-report-review-base" onClick={shared.reviewBase}>已比较，使用当前服务器版本为保存基准</Button></div>}
      {shared.serverMarkdown !== null && !shared.matchesServer && <Button size="sm" variant="ghost" disabled={readOnly || shared.saving} data-testid="aidt-report-restore" onClick={() => setConfirmRestore(true)}>恢复服务器报告到编辑区</Button>}
      {confirmRestore && <div role="alert" className="space-y-2" data-testid="aidt-report-restore-confirm"><p>替换当前报告编辑？未保存的报告修改将被替换，阶段成果与服务器报告不会被删除。</p><div className="flex gap-2"><Button size="sm" disabled={readOnly || shared.saving} onClick={() => { shared.restore(); setConfirmRestore(false); }}>确认恢复报告</Button><Button size="sm" variant="outline" onClick={() => setConfirmRestore(false)}>保留当前报告</Button></div></div>}
      {!shared.available && !shared.loading && <p>报告保存尚未就绪，可保留编辑或导出；不显示假保存回执。</p>}
    </section>}
    {text !== null && sourceRevision !== revision && <p role="status" className="text-12 text-muted-foreground">阶段表单已有变化。当前报告编辑被保留，可主动重新整理；不会自动覆盖你的修改。</p>}
    <div className="space-y-3 border-t border-border bg-background py-3"><details data-testid="aidt-report-chat-actions"><summary className="cursor-pointer text-12 text-muted-foreground">把报告用于本组对话</summary><div className="mt-3 flex flex-wrap gap-2">{toChat && <Button size="sm" disabled={readOnly} onClick={() => {
      const result = toChat(exportValue);
      setStatus(result === "accepted" ? "已带入聊天输入框，审阅并发送后保存对话；报告共享状态以上方回执为准。" : result === "occupied" ? "聊天中已有未发送草稿，未覆盖；请先处理或复制报告。" : "聊天尚未就绪，报告草稿仍保留，请稍后重试。");
    }}>审阅并发送报告到聊天</Button>}<Button variant="outline" size="sm" onClick={() => void copy()}>复制报告到聊天</Button></div></details><p role="status" aria-live="polite" className="text-12 text-muted-foreground">{status}</p></div>
  </section>;
}
