"use client";
import { useState } from "react";
import Link from "next/link";
import { SkillSourceBoundDraft, sourceBindingExchanges, sourceBindingMergeEligibility } from "@repo/contracts/skill-source-binding";
import { Button } from "@/components/ui/button";
import { sourcePreviewIdentity, sourceConnectionRepairHref } from "./source-preview-navigation";
import { Input } from "@/components/ui/input";
const digest = "a".repeat(64), incomingDigest = "b".repeat(64), now = "2026-09-10T01:00:00Z";
const originalPin = { source: { kind: "github", repositoryUrl: "https://github.com/example/old-skills", selection: "repository-root", path: null, requestedRef: "main", resolvedCommit: "c".repeat(40), authConnectionId: "demo-personal-source" }, sourceDigest: digest };
const initial = SkillSourceBoundDraft.parse({ draft: { ...sourcePreviewIdentity, revision: 3, snapshotDigest: digest, manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest, sizeBytes: 42 }, { path: "references/local-notes.md", digest, sizeBytes: 25 }], sourcePin: originalPin, basedOnPublishedVersionId: "demo-published-v1", updatedAt: "2026-09-09T00:00:00Z" }, sourceBinding: { state: "established", baselineId: "demo-original-base" } });
const preview = { previewId: "demo-new-source", previewDigest: incomingDigest, pin: { source: { ...originalPin.source, repositoryUrl: "https://github.com/example/new-skills", resolvedCommit: "d".repeat(40) }, sourceDigest: incomingDigest }, expiresAt: "2026-09-11T01:00:00Z", candidates: [{ candidateId: "demo-compatible-skill", name: "research-skill", manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest: incomingDigest, sizeBytes: 100 }], warnings: [] }] };
const assessment = { assessmentId: "demo-assessment", assessmentDigest: incomingDigest, pin: preview.pin, expiresAt: preview.expiresAt, compatibility: "compatible", preview };
const exact = (value: typeof initial) => ({ skillId: value.draft.skillId, draftId: value.draft.draftId, expectedRevision: value.draft.revision, expectedSnapshotDigest: value.draft.snapshotDigest });
export function SourceBindingPreview() {
  const [current, setCurrent] = useState(initial);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const apply = (action: "detach" | "rebind", stale = false) => {
    if (!stale && (!reason.trim() || !confirmed || action === "rebind" && !selected)) return;
    const baseline = stale ? exact(initial) : exact(current);
    const request = { ...baseline, reason: stale ? "演示旧页面请求" : reason, idempotencyKey: `demo-${action}-${baseline.expectedRevision}`, ...(action === "rebind" ? { previewId: preview.previewId, candidateId: preview.candidates[0]!.candidateId, expectedPreviewDigest: preview.previewDigest } : {}) };
    const response = { draft: { ...current.draft, revision: current.draft.revision + 1, updatedAt: now, sourcePin: action === "detach" ? null : preview.pin }, sourceBinding: action === "detach" ? { state: "detached" } : { state: "baseline-required", previewId: preview.previewId, candidateId: preview.candidates[0]!.candidateId } };
    const result = action === "detach"
      ? sourceBindingExchanges.detachSkillSource.safeParse({ request, response, stored: { current, now } })
      : sourceBindingExchanges.rebindSkillSource.safeParse({ request, response, stored: { current, now, assessment, preview, sourceAccess: "allowed", currentSourceDigest: preview.pin.sourceDigest } });
    setConfirmed(false);
    if (!result.success) { setNotice("请求已拒绝：页面版本或来源状态已变化。未改写当前草稿，请重新审阅后确认。"); return; }
    setCurrent(result.data.response); setReason(""); setSelected(false);
    setNotice(action === "detach" ? "演示来源已解绑。远端离线不影响解绑；本地文件和发布血缘保留。" : "演示新来源已绑定，需建立比较基线。未采用新源文件，也未创建共同祖先。");
  };
  const read = sourceBindingExchanges.getSkillDraft.parse({ request: { skillId: current.draft.skillId }, response: current, stored: current }).response;
  const mergeAllowed = sourceBindingMergeEligibility.safeParse({ request: { ...exact(current), checkedSourceDigest: preview.pin.sourceDigest, resolutions: [], idempotencyKey: "demo-merge-check" }, stored: current }).success;
  return <main className="min-h-screen bg-background p-6 text-background-foreground"><div className="mx-auto max-w-4xl space-y-5">
    <nav aria-label="来源恢复示例导航" className="flex flex-wrap gap-4 text-13 text-primary"><Link href="/preview/ai-capability-studio/workbench">返回开发工作台</Link><Link href="/preview/ai-capability-studio/import">返回导入向导</Link><Link href={sourceConnectionRepairHref}>管理个人来源连接</Link></nav>
    <header><h1 className="text-28 font-semibold">恢复草稿的上游来源</h1><p className="mt-2 text-13 text-muted-foreground">独立演示 · 固定来源预检，不联网、不持久化，刷新页面会重置；页面之间不传递演示状态。</p></header>
    <section className="space-y-3 rounded-container border border-border bg-card p-5" data-testid="source-binding-current"><h2 className="text-16 font-semibold">当前来源与比较状态</h2><p className="text-13">草稿 {read.draft.draftId} · r{read.draft.revision}</p><p className="break-all text-12">{read.draft.sourcePin?.source.kind === "github" ? read.draft.sourcePin.source.repositoryUrl : "未绑定上游来源"}</p><p className="text-13">{read.sourceBinding.state === "established" ? "原来源离线（演示）；原比较基线保留" : read.sourceBinding.state === "detached" ? "已解绑，比较基线已清除" : "需建立比较基线（baseline-required）"}</p><p className="text-12">发布血缘：{read.draft.basedOnPublishedVersionId}；已有发布版本与 Agent 固定版本不受本页操作影响。</p>
      {read.sourceBinding.state === "baseline-required" && <p className="text-13">下一步需逐文件审阅新来源与本地差异，明确保留或采用后建立基线。此步骤尚未实现，不能将本地文件冒充历史共同祖先。</p>}
      <Button variant="outline" disabled>合并上游（尚未接线）</Button><p className="text-12 text-muted-foreground">{mergeAllowed ? "当前原来源离线，演示不执行合并。" : "当前绑定状态不允许合并。"}</p>
    </section>
    <section className="space-y-2 rounded-container border border-border p-5" data-testid="source-binding-files"><h2 className="text-16 font-semibold">本地文件 · 绑定操作不覆盖内容</h2><ul className="space-y-2 text-12">{read.draft.files.map(file => <li key={file.path}>{file.path} · {file.sizeBytes} 字节 · 摘要 {file.digest.slice(0, 12)}</li>)}</ul></section>
    <section className="space-y-4 rounded-container border border-border p-5"><h2 className="text-16 font-semibold">明确选择一次来源变更</h2><p className="text-12">仅连接授权失效时，应先在个人来源连接中重新授权；换源用于明确选择其他仓库或路径。</p><label htmlFor="source-binding-reason" className="block text-13">变更理由<Input id="source-binding-reason" value={reason} maxLength={2000} onChange={event => { setReason(event.target.value); setConfirmed(false); }} /></label><fieldset className="space-y-2"><legend className="text-13">新来源：有效兼容预检（演示）</legend><label className="flex items-start gap-2 text-12"><input type="checkbox" checked={selected} onChange={event => { setSelected(event.target.checked); setConfirmed(false); }} />选择 research-skill · example/new-skills · SKILL.md</label><p className="text-12">选择只确认来源候选，不采用它的文件；本地改动仍保留。</p></fieldset><label className="flex items-start gap-2 text-13"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我已审阅理由与来源选择，确认这次变更只更新绑定；换源后需另行建立基线。</label><div className="flex flex-wrap gap-2"><Button variant="destructive" disabled={read.sourceBinding.state === "detached" || !reason.trim() || !confirmed || selected} onClick={() => apply("detach")}>解绑当前来源（演示）</Button><Button variant="primary" disabled={!reason.trim() || !confirmed || !selected} onClick={() => apply("rebind")}>绑定所选新来源（演示）</Button></div><p className="text-12 text-muted-foreground">解绑前请取消新来源选择。来源变更后，旧页面操作、AI 修改建议和精确版本试跑证据需要重新验证。</p></section>
    {current.draft.revision > initial.draft.revision && <Button variant="outline" onClick={() => apply("rebind", true)}>模拟旧页面重新绑定请求</Button>}
    <p role="status" className="text-13">{notice}</p>
  </div></main>;
}
