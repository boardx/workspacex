"use client";
import { useState } from "react";
import Link from "next/link";
import { ImportBatch, SkillImportUploadPolicy } from "@repo/contracts/skill-development";
import { SkillImportUploadResource, skillImportRecoveryExchanges, skillImportPreflightCompletion } from "@repo/contracts/skill-import-recovery";
import { Button } from "@/components/ui/button";

const now = "2026-09-10T01:00:00Z";
const digest = "a".repeat(64);
const policy = SkillImportUploadPolicy.parse({ policyRevision: "demo-policy", maxArchiveBytes: 10485760, maxExtractedBytes: 52428800, maxEntries: 100, maxPathDepth: 8, maxCompressionRatio: 20, expiresAfterSeconds: 86400 });
const jobBase = (id: string) => ({ uploadId: id, jobId: `${id}-job`, submittedAt: "2026-09-09T00:00:00Z", idempotencyKey: `${id}-original`, filename: `${id}.zip`, policyRevision: policy.policyRevision });
const running = SkillImportUploadResource.parse({ resourceRevision: 1, job: { ...jobBase("research"), status: "running", startedAt: "2026-09-10T00:00:00Z" }, retention: { state: "retained" } });
const expired = SkillImportUploadResource.parse({ resourceRevision: 2, job: { ...jobBase("archive"), status: "succeeded", completedAt: "2026-09-09T00:30:00Z", expiresAt: "2026-09-10T00:30:00Z", archiveDigest: digest, actualBytes: 1024 }, retention: { state: "expired" } });
const batch = ImportBatch.parse({ batchId: "demo-batch", previewId: "demo-preview", items: [{ jobId: "demo-import-job", submittedAt: "2026-09-09T00:35:00Z", idempotencyKey: "demo-import-key", candidateId: "selected-research", previewId: "demo-preview", sourceDigest: digest, attempt: 1, previousAttemptJobId: null, status: "succeeded", completedAt: "2026-09-09T00:40:00Z",
  result: { skillId: "research-skill", draftId: "research-draft", revision: 1, snapshotDigest: digest, manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest, sizeBytes: 42 }], sourcePin: { source: { kind: "zip", uploadId: "archive", archiveDigest: digest }, sourceDigest: digest }, basedOnPublishedVersionId: null, updatedAt: "2026-09-09T00:40:00Z" } }] });
type Resource = ReturnType<typeof SkillImportUploadResource.parse>;

function UploadRecord({ initial, ownPreflight, externalConsumers }: { initial: Resource; ownPreflight: boolean; externalConsumers: boolean }) {
  const [resource, setResource] = useState(initial);
  const [references, setReferences] = useState({ ownPreflight, externalConsumers });
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const inflight = resource.job.status === "running" || resource.job.status === "queued";
  const gone = resource.retention.state === "discarded";
  const mutate = (action: "cancel" | "discard") => {
    if (action === "discard" && !confirm) return;
    const request = { uploadId: resource.job.uploadId, expectedResourceRevision: resource.resourceRevision, idempotencyKey: `${resource.job.uploadId}-${action}-${resource.resourceRevision}` };
    const nextJob = action === "cancel" ? { ...jobBase(resource.job.uploadId), status: "cancelled", completedAt: now } : resource.job;
    const candidate = { resourceRevision: resource.resourceRevision + 1, job: nextJob, retention: action === "discard" ? { state: "discarded", discardedAt: now } : resource.retention };
    const validator = action === "cancel" ? skillImportRecoveryExchanges.cancelSkillImportUpload : skillImportRecoveryExchanges.discardSkillImportUpload;
    const checked = validator.safeParse({ request, response: { resource: candidate, idempotencyKey: request.idempotencyKey }, stored: { resource, references, now } });
    setConfirm(false);
    if (!checked.success) { setNotice("来源仍被占用或状态已变化，本次未作修改。等待占用释放后再试；已有草稿保持原样。"); return; }
    setResource(checked.data.response.resource);
    setNotice(action === "cancel" ? "已取消演示预检。等待预检释放占用后才可丢弃归档。" : "已丢弃演示归档；保留历史记录，已有草稿保持原样。");
  };
  const lateCompletion = () => {
    const completed = { resourceRevision: initial.resourceRevision + 1, job: { ...jobBase(initial.job.uploadId), status: "succeeded", completedAt: now, expiresAt: "2026-09-11T01:00:00Z", archiveDigest: digest, actualBytes: 1024 }, retention: { state: "retained" } };
    const checked = skillImportPreflightCompletion.safeParse({ request: { uploadId: initial.job.uploadId, jobId: initial.job.jobId, expectedResourceRevision: initial.resourceRevision }, response: completed, stored: { resource, references, now } });
    if (checked.success) setResource(checked.data.response);
    setNotice(checked.success ? "演示预检已完成。" : "旧预检结果已拒绝，取消状态不会被覆盖。");
  };
  const checkedRead = skillImportRecoveryExchanges.getSkillImportUploadJob.parse({ request: { uploadId: resource.job.uploadId }, response: resource, stored: { resource, now } }).response;
  const status = { queued: "排队中", running: "预检进行中", succeeded: "预检成功", failed: "预检失败", cancelled: "已取消" }[checkedRead.job.status];
  const retention = { retained: "归档保留中", expired: "归档已过期", discarded: "归档已丢弃" }[checkedRead.retention.state];
  return <article className="space-y-3 border-b border-border py-5" data-testid={`upload-${resource.job.uploadId}`}>
    <h3 className="text-16 font-semibold">{resource.job.filename}</h3>
    <dl className="grid grid-cols-2 gap-3 text-13"><div><dt className="text-muted-foreground">处理结果</dt><dd>{status}</dd></div><div><dt className="text-muted-foreground">文件保留</dt><dd>{retention}</dd></div></dl>
    <p className="text-12 text-muted-foreground">{resource.job.uploadId} · 记录版本 {resource.resourceRevision}</p>
    {resource.job.status === "succeeded" && <p className="text-12">归档到期时间：{resource.job.expiresAt}。过期后记录可查看，归档不可再次导入。</p>}
    <p className="text-12">预检占用：{references.ownPreflight ? "待释放" : "已释放"}；其他读取占用：{references.externalConsumers ? "待释放" : "已释放"}</p>
    <div className="flex flex-wrap gap-2">
      {inflight && <Button variant="outline" onClick={() => mutate("cancel")}>取消预检（演示）</Button>}
      {resource.job.status === "cancelled" && <Button variant="outline" onClick={lateCompletion}>模拟旧预检完成</Button>}
      {references.ownPreflight && !inflight && <Button variant="outline" onClick={() => { setReferences(value => ({ ...value, ownPreflight: false })); setConfirm(false); }}>模拟预检释放占用</Button>}
      {references.externalConsumers && <Button variant="outline" onClick={() => { setReferences(value => ({ ...value, externalConsumers: false })); setConfirm(false); }}>模拟其他读取释放占用</Button>}
      <Button variant="outline" disabled={resource.retention.state !== "retained" || resource.job.status !== "succeeded"} onClick={() => setNotice("这是独立示例，请回到导入向导重新选择来源；不传递演示归档。")}>使用此归档（演示）</Button>
    </div>
    {!inflight && !gone && <div className="space-y-2"><p className="text-12">丢弃只影响归档副本，保留任务记录和已导入草稿；所有读取占用释放后才能完成。</p><label className="flex gap-2 text-13"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} />确认丢弃 {resource.job.filename} 的演示归档</label><Button variant="destructive" disabled={!confirm} onClick={() => mutate("discard")}>确认丢弃归档（演示）</Button></div>}
    <p role="status" className="text-13">{notice}</p>
  </article>;
}

export function ImportRecoveryPreview() {
  return <main className="min-h-screen bg-background px-4 py-6 text-background-foreground"><div className="mx-auto max-w-4xl space-y-6">
    <Link href="/preview/ai-capability-studio/import" className="text-13 text-primary">返回导入向导示例</Link>
    <header><h1 className="text-28 font-semibold">上传记录与归档清理</h1><p className="mt-2 text-13 text-muted-foreground">独立交互演示，不联网、不上传或删除真实文件、不持久化；刷新页面会重置。上传传输已结束，取消的是后续预检，不提供断点续传。</p><p className="mt-2 text-12 text-muted-foreground">示例时间固定为 {now}，过期状态按此示例时间展示。</p></header>
    <aside className="space-y-2 rounded-control border border-border bg-muted p-4"><h2 className="text-16 font-semibold">示例上传限制</h2><p className="text-12">以下来自固定演示策略，并非真实生产配置。正式界面须读取服务端策略。</p><p className="text-13">压缩包 {policy.maxArchiveBytes / 1048576} MiB · 展开后 {policy.maxExtractedBytes / 1048576} MiB · {policy.maxEntries} 个文件 · 路径 {policy.maxPathDepth} 层 · 压缩比 {policy.maxCompressionRatio} · 保留 {policy.expiresAfterSeconds / 3600} 小时</p></aside>
    <section aria-label="上传记录"><UploadRecord initial={running} ownPreflight externalConsumers={false} /><UploadRecord initial={expired} ownPreflight={false} externalConsumers /></section>
    <section className="space-y-3 rounded-container border border-border p-5" data-testid="import-batch-history"><h2 className="text-16 font-semibold">导入批次 · 示例结果</h2><p className="text-12">只展示明确选中的候选项。归档过期或丢弃不会删除已经生成的草稿；这里不恢复真实历史。</p>{batch.items.map(item => <div key={item.jobId} className="text-13">候选项 {item.candidateId} · {item.status === "succeeded" ? `已生成草稿 ${item.result.draftId} · r${item.result.revision}` : item.status}</div>)}</section>
  </div></main>;
}
