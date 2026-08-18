/**
 * #946 · F153/W1（V9-b）—— 附件抽取（application：编排，无 DB/anydoc 细节）。
 *
 * 两条入口共用同一个**抽取核心** `extractAttachment`：
 *   - 异步 worker `runExtractionTick`：认领 outbox job → extractAttachment → 按结果 complete/重试。
 *   - 同步内联（≤3MB，见 upload 用例）：直接 extractAttachment，无 job。
 *
 * 抽取路径由领域 `planExtraction(mime)` 决定：convert（anydoc）/ passthrough（txt/md 字节即文本）/
 * vision（图片交 VLM 转录+描述，#1560 P1）/ unsupported（白名单外）。
 * 重放幂等靠 putOnce→ObjectExistsError=已落跳过。
 *
 * 三条产文本的路径（convert / passthrough / vision）**汇到同一条落库路径**：putOnce 全文 markdown →
 * recordExtracted(extracted_ref + 有界 excerpt)。图片没有第二套字段，也没有第二套状态机。
 *
 * 失败语义**分两类**：确定性错误（convert 的 `ConvertErrorCode`、vision 的 `visionNotConfigured` /
 * `visionModelUnavailable` / `visionRejected`）→ 记附件 failed（终态，如实写码）；
 * I/O 类（读字节/putOnce/DB 抖动、vision 的 `visionTransport`）→ 返回 "retry"，由 job 侧
 * markJobFailed 靠 staleness 重试。**没有第三类**：绝不在失败时落一条空的 extracted 冒充成功。
 */
import type { OrgId } from "../../domain/org-id";
import { planExtraction, boundedExcerpt } from "../../domain/chat/attachment-extraction";
import type { ObjectStore } from "../artifact/ports";
import { ObjectExistsError } from "../artifact/ports";
import type { AttachmentToMarkdownPort } from "./attachment-to-markdown.port";
import { isRetryableVisionError, type AttachmentVisionPort } from "./attachment-vision.port";
import type { AttachmentExtractionJob, AttachmentExtractionStore } from "./attachment-extraction-store";

/** 认领到但 attempts 已越上限：不再无限重试。 */
export const MAX_EXTRACTION_ATTEMPTS = 5;

export type ExtractionOutcome = "extracted" | "unsupported" | "failed" | "retry" | "gone";

/** 抽取核心的依赖（不含 job/log）——worker 与内联路径共用。 */
export interface ExtractionCoreDeps {
  readonly store: ObjectStore;
  readonly extraction: AttachmentExtractionStore;
  readonly converter: AttachmentToMarkdownPort;
  /**
   * #1560 P1：图片视觉抽取端口。**可选**——没接（老测试、未配置视觉能力的部署）时图片如实落
   * `failed` + `visionNotConfigured`，不静默留空、不回落成 `unsupported` 假装「这类文件本来就抽不出」。
   */
  readonly vision?: AttachmentVisionPort;
}

export interface AttachmentExtractionDeps extends ExtractionCoreDeps {
  readonly log: (message: string, ctx?: Record<string, unknown>) => void;
}

export type ExtractionTickResult =
  | { readonly claimed: false }
  | { readonly claimed: true; readonly attachmentId: string; readonly outcome: ExtractionOutcome };

/** extracted markdown 的对象 key——按 attachmentId 稳定命名（无 per-attempt 随机），重放同 key。 */
export function extractedObjectKey(orgId: OrgId, attachmentId: string): string {
  return `chat-attachments-extracted/${orgId}/${attachmentId}.md`;
}

/**
 * 抽取一个附件到终态（记 extracted/unsupported/failed 到 chat_message_attachments）。
 * **不碰 outbox job**——只返回结果码，job 生命周期由调用方（worker）处理；内联路径无 job。
 *
 * 返回 `"retry"` = 遇到可重试的 I/O 类故障（读字节失败、字节还没落、putOnce 非 ObjectExists），
 * **未记任何终态**——附件保持 pending，交调用方决定怎么重试（worker markJobFailed；内联可回落入队）。
 */
export async function extractAttachment(
  deps: ExtractionCoreDeps,
  orgId: OrgId,
  attachmentId: string,
): Promise<ExtractionOutcome> {
  let att: Awaited<ReturnType<AttachmentExtractionStore["readAttachment"]>>;
  try {
    att = await deps.extraction.readAttachment(orgId, attachmentId);
  } catch {
    return "retry";
  }
  if (att === null) return "gone"; // 附件已删（thread/message 级联穿透）

  const plan = planExtraction(att.mime);
  if (plan.kind === "unsupported") {
    await deps.extraction.recordUnsupported(orgId, attachmentId);
    return "unsupported";
  }

  let bytes: Uint8Array | null;
  try {
    bytes = await deps.store.get(att.storageRef);
  } catch {
    return "retry";
  }
  if (bytes === null) return "retry"; // 字节还没落对象存储——可重试，非终态失败

  let markdown: string;
  if (plan.kind === "passthrough") {
    markdown = new TextDecoder().decode(bytes);
  } else if (plan.kind === "vision") {
    if (deps.vision === undefined) {
      // 本部署没有视觉能力——如实记 failed + 原因，绝不假装抽到了内容。
      await deps.extraction.recordFailed(orgId, attachmentId, "visionNotConfigured");
      return "failed";
    }
    const v = await deps.vision.describeImage(bytes, plan.mime);
    if (!v.ok) {
      if (isRetryableVisionError(v.code)) return "retry"; // 网络/5xx——未记终态，交 outbox 重试
      await deps.extraction.recordFailed(orgId, attachmentId, v.code);
      return "failed";
    }
    markdown = v.markdown;
  } else {
    const r = await deps.converter.convert(bytes, plan.format);
    if (!r.ok) {
      // 确定性 convert 错误——重试无用，记 failed（终态）。
      await deps.extraction.recordFailed(orgId, attachmentId, r.code);
      return "failed";
    }
    markdown = r.markdown;
  }

  // 落全文 markdown（putOnce 幂等：重放撞 ObjectExistsError 即视为已落，继续记状态）。
  const extractedRef = extractedObjectKey(orgId, attachmentId);
  try {
    await deps.store.putOnce(extractedRef, new TextEncoder().encode(markdown), "text/markdown");
  } catch (e) {
    if (!(e instanceof ObjectExistsError)) return "retry";
    // 已落——重放，继续记状态。
  }
  await deps.extraction.recordExtracted(orgId, attachmentId, extractedRef, boundedExcerpt(markdown));
  return "extracted";
}

/** 一次 tick：认领一条 outbox job 并处理到终态（或标记重试）。无活 → claimed:false。 */
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

  const outcome = await extractAttachment(deps, orgId, job.attachmentId);
  if (outcome === "retry") {
    deps.log("attachment extraction step failed, will retry", { attachmentId: job.attachmentId });
    await deps.extraction.markJobFailed(orgId, job.jobId, "extraction step failed, will retry");
    return "retry";
  }
  // extracted / unsupported / failed / gone —— 都是终态，删 job 排空。
  await deps.extraction.complete(orgId, job.jobId);
  return outcome;
}
