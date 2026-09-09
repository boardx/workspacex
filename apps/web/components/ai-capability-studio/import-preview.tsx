"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, FileCode2, GitBranch, Upload } from "lucide-react";
import { SkillImportRequestSource, summarizeImportBatch } from "@repo/contracts/skill-development";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { advanceImportBatch, makeImportBatch, makeImportPreview, type ImportBatchView, type ImportPreviewView } from "./import-preview-data";

const labels = { queued: "排队中", running: "正在导入", succeeded: "已创建演示草稿", failed: "导入失败", cancelled: "已取消", partial: "部分完成" } as const;
export function CapabilityImportPreview() {
  const [kind, setKind] = useState("github");
  const [url, setUrl] = useState("https://github.com/example/skills");
  const [ref, setRef] = useState("main");
  const [selection, setSelection] = useState("repository-root");
  const [path, setPath] = useState("");
  const [connection, setConnection] = useState("public");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<ImportPreviewView | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [batch, setBatch] = useState<ImportBatchView | null>(null);
  const [history, setHistory] = useState<ImportBatchView[]>([]);
  const [startNew, setStartNew] = useState(false);
  const sourceLocked = batch !== null;
  const busy = batch?.items.some(item => item.status === "queued" || item.status === "running") ?? false;
  const invalidate = () => { setPreview(null); setSelected([]); setBatch(null); setError(""); };
  const inspect = () => {
    if (kind === "github" && connection === "expired") { setError("示例连接已失效。更换连接后可继续，地址和ref已保留。"); return; }
    if (kind === "zip" && !fileName.toLowerCase().endsWith(".zip")) { setError("请先选择ZIP文件。本原型仅读取文件名，不上传或解压文件。"); return; }
    const input = kind === "zip" ? { kind, uploadId: "demo-upload" } : kind === "https-file" ? { kind, url, authConnectionId: null } :
      { kind: "github", repositoryUrl: url, requestedRef: ref, path: selection === "repository-root" ? null : path, selection, authConnectionId: connection === "private" ? "demo-private-connection" : null };
    const parsed = SkillImportRequestSource.safeParse(input);
    if (!parsed.success) { setError(kind === "https-file" ? "请输入以 https:// 开头的完整文件地址。" : "检查来源地址、ref和相对路径。GitHub仓库填写 https://github.com/owner/repo，目录另填；路径不能包含 ..。"); return; }
    setPreview(makeImportPreview(parsed.data)); setSelected([]); setBatch(null); setError("");
  };
  const advance = (action: Parameters<typeof advanceImportBatch>[2]) => {
    if (batch && preview && !startNew) setBatch(advanceImportBatch(batch, preview, action));
  };
  return <main className="min-h-screen bg-background px-4 py-6 text-background-foreground" data-testid="studio-import-flow">
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/preview/ai-capability-studio/workbench" className="inline-flex items-center gap-2 text-13 text-muted-foreground" data-testid="import-back"><ArrowLeft className="h-4 w-4" aria-hidden />工作台交互示例</Link>
      <header><p className="text-12 text-primary">能力库 / 导入方案</p><h1 className="mt-2 text-28 font-semibold">从已有方案开始</h1><p className="mt-2 text-13 text-muted-foreground">选择来源、检查文件，创建自己的工作草稿。</p></header>
      <div className="rounded-control border border-border bg-muted p-3 text-12" role="note">交互原型 · 来源预览和任务结果均为契约校验后的演示数据。不联网、不上传、不保存真实草稿。</div>
      <Link href="/preview/ai-capability-studio/adapt" className="inline-block text-13 text-primary" data-testid="import-adaptation-example">没有 SKILL.md？查看普通仓库适配示例</Link>
      <Link href="/preview/ai-capability-studio/connections" className="block text-13 text-primary">需要私有仓库？查看连接与重新授权示例（独立演示）</Link>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-container border border-border bg-card p-5">
          <h2 className="text-16 font-semibold">1. 选择来源</h2>
          <div className="flex flex-wrap gap-2">{[["github", "GitHub"], ["zip", "ZIP 文件"], ["https-file", "HTTPS 单文件"]].map(([value, label]) => <Button key={value} disabled={sourceLocked} variant={kind === value ? "secondary" : "outline"} data-testid={`import-kind-${value}`} onClick={() => { setKind(value!); invalidate(); }}>{label}</Button>)}</div>
          {kind !== "zip" ? <><label htmlFor="import-url" className="block text-12">{kind === "github" ? "GitHub仓库地址" : "HTTPS文件地址"}</label><Input id="import-url" data-testid="import-url" disabled={sourceLocked} value={url} onChange={event => { setUrl(event.target.value); invalidate(); }} /></> : <><label htmlFor="import-zip" className="block text-12">选择本地ZIP</label><Input id="import-zip" data-testid="import-zip" type="file" accept=".zip" disabled={sourceLocked} onChange={event => { setFileName(event.target.files?.[0]?.name ?? ""); invalidate(); }} /><p className="text-12 text-muted-foreground">{fileName || "尚未选择文件"}。正式版本由服务端验证解压大小、路径、符号链接和内容哈希。</p></>}
          {kind === "github" && <><label htmlFor="import-ref" className="block text-12">分支、Tag或Commit</label><Input id="import-ref" data-testid="import-ref" disabled={sourceLocked} value={ref} onChange={event => { setRef(event.target.value); invalidate(); }} /><p className="text-12">扫描范围</p><Select data-testid="import-selection" disabled={sourceLocked} value={selection} options={[{ value: "repository-root", label: "整个仓库" }, { value: "subdirectory", label: "指定目录" }, { value: "single-file", label: "指定单文件" }]} onValueChange={value => { setSelection(value); invalidate(); }} /><label htmlFor="import-path" className="block text-12">包内目录或文件路径</label><Input id="import-path" data-testid="import-path" disabled={sourceLocked || selection === "repository-root"} value={path} onChange={event => { setPath(event.target.value); invalidate(); }} /><p className="text-12">读取连接（示例）</p><Select data-testid="import-connection" disabled={sourceLocked} value={connection} options={[{ value: "public", label: "公开来源，无连接" }, { value: "private", label: "团队只读连接 · 演示" }, { value: "expired", label: "已失效连接 · 演示" }]} onValueChange={value => { setConnection(value); invalidate(); }} /></>}
          <p className="rounded-control bg-panel p-3 text-12">导入目标：<strong>新建能力草稿</strong>。同名不会自动覆盖现有能力。更新已有草稿须在工作台明确确认。</p>
          {error && <p role="alert" data-testid="import-error" className="text-12 text-destructive">{error}</p>}
          <Button disabled={sourceLocked} variant="primary" data-testid="import-inspect" onClick={inspect}><GitBranch className="h-4 w-4" aria-hidden />查看演示预检</Button>
        </section>
        <section className="space-y-4 rounded-container border border-border bg-card p-5">
          <h2 className="text-16 font-semibold">2. 选择要开发的能力</h2>
          {!preview ? <p className="py-12 text-13 text-muted-foreground">预检后显示来源快照、文件、许可证和候选能力。</p> : <><p className="text-12 text-muted-foreground" data-testid="import-source-pin">来源已固定为示例快照 {preview.pin.sourceDigest.slice(0, 8)}{preview.pin.source.kind === "github" ? ` · commit ${preview.pin.source.resolvedCommit.slice(0, 12)} · ref ${preview.pin.source.requestedRef}` : ""}，候选与任务使用同一快照。</p>{preview.candidates.map(candidate => <label key={candidate.candidateId} className="block cursor-pointer rounded-control border border-border p-4"><span className="flex items-center gap-3"><input type="checkbox" data-testid={`import-candidate-${candidate.candidateId}`} disabled={busy || batch !== null} checked={selected.includes(candidate.candidateId)} onChange={event => setSelected(items => event.target.checked ? [...items, candidate.candidateId] : items.filter(id => id !== candidate.candidateId))} /><FileCode2 className="h-4 w-4" aria-hidden /><strong className="text-13">{candidate.name}</strong></span><span className="mt-2 block text-12 text-muted-foreground">{candidate.files.map(file => file.path).join(" · ")}</span><span className="mt-2 block text-12 text-muted-foreground">{candidate.warnings.join("；")}</span></label>)}<Button variant="primary" disabled={!selected.length || batch !== null} data-testid="import-submit-batch" onClick={() => setBatch(makeImportBatch(preview, selected))}><Upload className="h-4 w-4" aria-hidden />确认新建 {selected.length} 个演示草稿</Button></>}
        </section>
      </div>
      {batch && <section className="space-y-4 rounded-container border border-border bg-card p-5" data-testid="import-batch"><div className="flex flex-wrap justify-between gap-2"><h2 className="text-16 font-semibold">3. {labels[summarizeImportBatch(batch)]}</h2><span className="text-12 text-muted-foreground">批次 {batch.batchId} · 来源已锁定，重试沿用原快照</span></div>{batch.items.map(item => <div key={item.candidateId} className="flex flex-wrap justify-between gap-3 border-b border-border py-3" data-testid={`import-result-${item.candidateId}`}><div><p className="text-13 font-medium">{item.candidateId}</p><p className="mt-1 text-12 text-muted-foreground">第 {item.attempt} 次尝试{item.status === "succeeded" ? ` · 草稿 ${item.result.draftId} r${item.result.revision} · 未发布` : ""}</p>{item.status === "failed" && <p className="mt-1 text-12 text-destructive">{item.failure.message}</p>}</div><span className={`text-13 ${item.status === "failed" ? "text-destructive" : item.status === "succeeded" ? "text-success" : "text-muted-foreground"}`}>{item.status === "succeeded" && <Check className="mr-1 inline h-3 w-3" aria-hidden />}{labels[item.status]}</span></div>)}
        <div className="flex flex-wrap gap-2" aria-label="演示任务状态控制"><Button variant="outline" disabled={!busy} data-testid="import-start" onClick={() => advance("start")}>演示开始执行</Button><Button variant="outline" disabled={!busy} data-testid="import-partial" onClick={() => advance("partial")}>演示一项失败</Button><Button variant="outline" disabled={!busy} data-testid="import-complete" onClick={() => advance("success")}>演示完成</Button><Button variant="outline" disabled={!busy} data-testid="import-cancel" onClick={() => advance("cancel")}>取消未完成项</Button><Button variant="primary" disabled={busy || startNew || !batch.items.some(item => item.status === "failed" && item.failure.retryable)} data-testid="import-retry" onClick={() => advance("retry")}>仅重试可重试失败项</Button></div>
        <p className="text-12 text-muted-foreground">上方按钮仅用于审阅状态。生产界面由服务端任务驱动进度，并在刷新后通过批次ID恢复。</p>
        {!busy && <Button variant="outline" data-testid="import-new-batch" onClick={() => setStartNew(true)}>开始新的导入</Button>}
        {startNew && !busy && <div className="space-y-3 rounded-control border border-border p-3" role="group" aria-label="开始新导入确认"><p className="text-13">当前结果将保留在本页历史中。新导入会重新预检；仍需重试的失败项请先完成重试。</p><Button variant="primary" data-testid="import-confirm-new" onClick={() => { if (busy) return; setHistory(items => [...items, batch]); invalidate(); setStartNew(false); }}>保留结果并开始新导入</Button><Button variant="ghost" onClick={() => setStartNew(false)}>继续查看当前结果</Button></div>}
      </section>}
      {history.length > 0 && <section className="space-y-3 rounded-container border border-border bg-card p-5" data-testid="import-history"><h2 className="text-16 font-semibold">本页导入历史</h2>{history.map((entry, index) => <details key={index}><summary className="text-13">第 {index + 1} 批 · {labels[summarizeImportBatch(entry)]}</summary><ul className="text-12">{entry.items.map(item => <li key={item.jobId}>{item.candidateId} · {labels[item.status]}{item.status === "succeeded" ? ` · ${item.result.draftId}` : ""}</li>)}</ul></details>)}</section>}
    </div>
  </main>;
}
