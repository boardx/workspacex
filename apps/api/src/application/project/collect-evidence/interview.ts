/**
 * 访谈片段 → 证据单元（`source_kind = interview_segment`）。
 *
 * 两路来源，同一个 `resourceId`（访谈 id）：
 *   · 录音转写段（`recording_sessions.source_type = interview` 的最终段），`sourceRef = segmentId`，形状同个人转写；
 *   · 纪要引述（`interview_quotes`，抽引述那一刻冻结的原话），`sourceRef = quoteId`，说话人是已解析的受访者名。
 * 访谈归属直接看 `interview_sessions.project_id`，不经链接表——所以它没有「挂载」动作可触发采集，
 * 只在汇总入口 `collectProjectEvidence` 被调用时采（挂载其它资源时顺带、以及 B3-T2 入图前）。
 */
import type { UpsertEvidenceCommand } from "../project-evidence-ports";
import { clipExcerpt, disclosedOrNull, EMPTY_RESULT, upsertAll, type CollectorDeps, type CollectorInput, type CollectResult } from "./shared";
import { segmentCommand } from "./transcript";

export async function collectInterviewEvidence(deps: CollectorDeps, input: CollectorInput): Promise<CollectResult> {
  const docs = disclosedOrNull(await deps.sources.interviewsOf(input.orgId, input.projectId), input.decision);
  if (docs === null) return EMPTY_RESULT;
  const commands: UpsertEvidenceCommand[] = [];
  for (const doc of docs) {
    for (const seg of doc.segments) commands.push(segmentCommand(input, "interview_segment", doc.interviewId, doc.title, seg));
    for (const q of doc.quotes) {
      commands.push({
        orgId: input.orgId,
        projectId: input.projectId,
        sourceKind: "interview_segment",
        resourceId: doc.interviewId,
        sourceRef: q.quoteId,
        excerpt: clipExcerpt(q.text),
        locator: {},
        speakerLabel: q.speakerLabel,
        resourceTitle: doc.title,
      });
    }
  }
  return upsertAll(deps.evidence, commands);
}
