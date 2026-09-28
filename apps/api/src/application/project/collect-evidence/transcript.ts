/**
 * 个人转写片段 → 证据单元（`source_kind = transcript_segment`）。
 *
 * 粒度：每一段最终转写（`recording_segments.status = final`）一条，`sourceRef = segmentId`；
 * `locator` 带段序号与时间锚（有的话）；说话人取声道 id（没有解析出人名时为 null）。
 * ⚠ 只采录音段：F167 起个人转写还有一份可编辑的整体正文 `content`，它没有段落级引用，不采。
 */
import type { UpsertEvidenceCommand } from "../project-evidence-ports";
import type { TranscriptSegmentSource } from "./ports";
import { clipExcerpt, disclosedOrNull, EMPTY_RESULT, upsertAll, type CollectorDeps, type CollectorInput, type CollectResult } from "./shared";

/** 转写段 → 证据命令（访谈的录音段也走这一份，只是 `sourceKind` / `resourceId` 不同）。 */
export function segmentCommand(
  input: CollectorInput,
  sourceKind: "transcript_segment" | "interview_segment",
  resourceId: string,
  resourceTitle: string,
  seg: TranscriptSegmentSource,
): UpsertEvidenceCommand {
  return {
    orgId: input.orgId,
    projectId: input.projectId,
    sourceKind,
    resourceId,
    sourceRef: seg.segmentId,
    excerpt: clipExcerpt(seg.text),
    locator: {
      ordinal: seg.ordinal,
      ...(seg.startMs !== null ? { startMs: seg.startMs } : {}),
      ...(seg.endMs !== null ? { endMs: seg.endMs } : {}),
    },
    speakerLabel: seg.speakerLabel,
    resourceTitle,
  };
}

export async function collectTranscriptEvidence(deps: CollectorDeps, input: CollectorInput): Promise<CollectResult> {
  const docs = disclosedOrNull(await deps.sources.transcriptionsOf(input.orgId, input.projectId), input.decision);
  if (docs === null) return EMPTY_RESULT;
  const commands = docs.flatMap((doc) =>
    doc.segments.map((seg) => segmentCommand(input, "transcript_segment", doc.transcriptionId, doc.title, seg)),
  );
  return upsertAll(deps.evidence, commands);
}
