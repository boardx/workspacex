import { z } from "zod";
import { ImportBatch, SkillDraft, SkillImportPreview, SkillImportRequestSource } from "@repo/contracts/skill-development";

export type ImportPreviewView = z.infer<typeof SkillImportPreview>;
export type ImportBatchView = z.infer<typeof ImportBatch>;
const digest = "a".repeat(64);
const now = "2026-09-09T00:00:00.000Z";

/** Contract-validated demonstration responses. No remote fetch, upload, or persistence. */
export function makeImportPreview(input: z.infer<typeof SkillImportRequestSource>): ImportPreviewView {
  const source = SkillImportRequestSource.parse(input);
  const resolved = source.kind === "github" ? { ...source, resolvedCommit: "b".repeat(40) } :
    source.kind === "zip" ? { ...source, archiveDigest: digest } : { ...source, contentDigest: digest };
  return SkillImportPreview.parse({
    previewId: "demo-preview", pin: { source: resolved, sourceDigest: digest }, previewDigest: digest,
    expiresAt: "2026-09-10T00:00:00.000Z",
    candidates: (source.kind === "https-file" || (source.kind === "github" && source.selection === "single-file") ? ["research-brief"] : ["research-brief", "meeting-notes"]).map(name => ({
      candidateId: name, name, manifestPath: "SKILL.md",
      files: [{ path: "SKILL.md", digest, sizeBytes: 180 }, { path: "references/style.md", digest, sizeBytes: 60 }],
      warnings: ["演示许可证：MIT；正式导入需读取原始LICENSE"],
    })),
  });
}

export function makeImportBatch(preview: ImportPreviewView, selected: string[]): ImportBatchView {
  if (selected.some(id => !preview.candidates.some(candidate => candidate.candidateId === id))) throw new Error("demo candidate does not belong to preview");
  return ImportBatch.parse({ batchId: "demo-batch", previewId: preview.previewId,
    items: selected.map(candidateId => ({
      jobId: `job-${candidateId}-1`, candidateId, previewId: preview.previewId,
      sourceDigest: preview.pin.sourceDigest, attempt: 1, previousAttemptJobId: null,
      submittedAt: now, idempotencyKey: `demo-import-${candidateId}`, status: "queued",
    })),
  });
}

export function advanceImportBatch(batch: ImportBatchView, preview: ImportPreviewView, action: "start" | "partial" | "success" | "cancel" | "retry"): ImportBatchView {
  const items = batch.items.map((item, index) => {
    const base = { jobId: item.jobId, candidateId: item.candidateId, previewId: item.previewId, sourceDigest: item.sourceDigest,
      attempt: item.attempt, previousAttemptJobId: item.previousAttemptJobId, submittedAt: item.submittedAt, idempotencyKey: item.idempotencyKey };
    if (action === "retry") {
      return item.status === "failed" && item.failure.retryable ? { ...base, jobId: `${item.jobId}-retry`, idempotencyKey: `demo-retry-${item.jobId}`, previousAttemptJobId: item.jobId, attempt: item.attempt + 1, status: "queued" } : item;
    }
    if (item.status !== "queued" && item.status !== "running") return item;
    if (action === "start") return { ...base, status: "running", startedAt: now };
    if (action === "cancel") return { ...base, status: "cancelled", completedAt: now };
    if (action === "partial" && index === batch.items.length - 1) return { ...base, status: "failed", completedAt: now,
      failure: { code: "DEPENDENCY_UNAVAILABLE", message: "示例读取暂时失败，可重试此项。", retryable: true } };
    const candidate = preview.candidates.find(entry => entry.candidateId === item.candidateId);
    if (!candidate) throw new Error("demo candidate missing");
    return { ...base, status: "succeeded", completedAt: now, result: SkillDraft.parse({
      skillId: `demo-${item.candidateId}`, draftId: `draft-${item.candidateId}`, revision: 1, snapshotDigest: digest,
      manifestPath: candidate.manifestPath, files: candidate.files, sourcePin: preview.pin, basedOnPublishedVersionId: null, updatedAt: now,
    }) };
  });
  return ImportBatch.parse({ ...batch, items });
}
