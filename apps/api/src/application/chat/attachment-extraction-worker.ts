/**
 * #946 · F153/W1（V9-b）—— 附件抽取 worker（application：编排，无 DB/anydoc 细节）。
 *
 * 一次 tick = 认领一条待办并处理到终态。镜像 files ingestion-worker 的骨架
 * （MAX_ATTEMPTS 上限、claim→process、putOnce→ObjectExistsError=已落跳过 的重放幂等）。
 *
 * 抽取路径由领域 `planExtraction(mime)` 决定：
 *   - convert     → `AttachmentToMarkdownPort.convert(bytes, format)`。
 *   - passthrough → 字节即文本（txt/md），直接当 markdown。
 *   - unsupported → 抽不出文本（图片），记 unsupported（非失败）。
 *
 * 失败语义**分两类**（关键）：
 *   - convert 的 `ConvertErrorCode`（malformed/encrypted/…）是**确定性**的，重试无用 →
 *     记附件 `failed` + **删 job**（终态，不无限重试）。
 *   - I/O 类抛错（读字节失败、putOnce 非 ObjectExists、DB 抖动）是**可重试** →
 *     `markJobFailed`（job 留着，靠 staleness 窗口重新认领），直到 MAX_ATTEMPTS。
 */
import type { OrgId } from "../../domain/org-id";
import { planExtraction } from "../../domain/chat/attachment-extraction";
import type { ObjectStore } from "../artifact/ports";
import { ObjectExistsError } from "../artifact/ports";
import type { AttachmentToMarkdownPort } from "./attachment-to-markdown.port";
import type { AttachmentExtractionJob, AttachmentExtractionStore } from "./attachment-extraction-store";

/** 认领到但 attempts 已越上限：不再无限重试。 */
export const MAX_EXTRACTION_ATTEMPTS = 5;

export interface AttachmentExtractionDeps {
  readonly store: ObjectStore;
  readonly extraction: AttachmentExtractionStore;
  readonly converter: AttachmentToMarkdownPort;
  readonly log: (message: string, ctx?: Record<string, unknown>) => void;
}

export type ExtractionOutcome = "extracted" | "unsupported" | "failed" | "retry" | "gone";

export type ExtractionTickResult =
  | { readonly claimed: false }
  | { readonly claimed: true; readonly attachmentId: string; readonly outcome: ExtractionOutcome };

/** extracted markdown 的对象 key——按 attachmentId 稳定命名（无 per-attempt 随机），重放同 key。 */
export function extractedObjectKey(orgId: OrgId, attachmentId: string): string {
  return `chat-attachments-extracted/${orgId}/${attachmentId}.md`;
}

export async function runExtractionTick(
  deps: AttachmentExtractionDeps,
  orgId: OrgId,
  workerId: string,
  staleAfterMs = 5 * 60 * 1000,
): Promise<ExtractionTickResult> {
  const job = await deps.extraction.claimNext(orgId, workerId, staleAfterMs);
  if (job === null) return { claimed: false };
  const outcome = await processJob(deps, orgId, job);
  return { claimed: true, attachmentId: job.attachmentId, outcome };
}

async function processJob(
  deps: AttachmentExtractionDeps,
  orgId: OrgId,
  job: AttachmentExtractionJob,
): Promise<ExtractionOutcome> {
  if (job.attempts > MAX_EXTRACTION_ATTEMPTS) {
    // 反复失败到上限：记 failed（malformed 兜底）并删 job，别把队列堵在一条死活上。
    await deps.extraction.recordFailed(orgId, job.attachmentId, "malformed");
    await deps.extraction.complete(orgId, job.jobId);
    return "failed";
  }

  const att = await readAttachmentOrRetry(deps, orgId, job);
  if (att === "retry") return "retry";
  if (att === null) {
    // 附件已删（thread/message 级联）——job 也没意义了，删掉。
    await deps.extraction.complete(orgId, job.jobId);
    return "gone";
  }

  const plan = planExtraction(att.mime);
  if (plan.kind === "unsupported") {
    await deps.extraction.recordUnsupported(orgId, job.attachmentId);
    await deps.extraction.complete(orgId, job.jobId);
    return "unsupported";
  }

  // 读原始字节（I/O：失败可重试）。
  let bytes: Uint8Array | null;
  try {
    bytes = await deps.store.get(att.storageRef);
  } catch (e) {
    await failRetryable(deps, orgId, job, e);
    return "retry";
  }
  if (bytes === null) {
    // 字节还没落对象存储（上传与挂消息之间的窗口）——可重试，别当终态失败。
    await deps.extraction.markJobFailed(orgId, job.jobId, "attachment bytes not found yet");
    return "retry";
  }

  // 转 markdown：passthrough 直接解码；convert 走 anydoc。
  let markdown: string;
  if (plan.kind === "passthrough") {
    markdown = new TextDecoder().decode(bytes);
  } else {
    const r = await deps.converter.convert(bytes, plan.format);
    if (!r.ok) {
      // 确定性 convert 错误——重试无用，记 failed + 删 job（终态）。
      await deps.extraction.recordFailed(orgId, job.attachmentId, r.code);
      await deps.extraction.complete(orgId, job.jobId);
      return "failed";
    }
    markdown = r.markdown;
  }

  // 落 markdown（putOnce 幂等：重放撞 ObjectExistsError 即视为已落，继续记状态）。
  const extractedRef = extractedObjectKey(orgId, job.attachmentId);
  try {
    await deps.store.putOnce(extractedRef, new TextEncoder().encode(markdown), "text/markdown");
  } catch (e) {
    if (!(e instanceof ObjectExistsError)) {
      await failRetryable(deps, orgId, job, e);
      return "retry";
    }
    // 已落——重放，落到下面记状态 + 删 job。
  }

  await deps.extraction.recordExtracted(orgId, job.attachmentId, extractedRef);
  await deps.extraction.complete(orgId, job.jobId);
  return "extracted";
}

async function readAttachmentOrRetry(
  deps: AttachmentExtractionDeps,
  orgId: OrgId,
  job: AttachmentExtractionJob,
): Promise<AttachmentForExtractionResult> {
  try {
    return await deps.extraction.readAttachment(orgId, job.attachmentId);
  } catch (e) {
    await failRetryable(deps, orgId, job, e);
    return "retry";
  }
}

type AttachmentForExtractionResult =
  | Awaited<ReturnType<AttachmentExtractionStore["readAttachment"]>>
  | "retry";

async function failRetryable(
  deps: AttachmentExtractionDeps,
  orgId: OrgId,
  job: AttachmentExtractionJob,
  e: unknown,
): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  deps.log("attachment extraction step failed, will retry", { attachmentId: job.attachmentId, detail: msg });
  await deps.extraction.markJobFailed(orgId, job.jobId, msg);
}
