/**
 * 项目中枢 B3-T1（#4495）`collectProjectEvidence` —— 四个采集器的汇总入口。
 *
 * 对挂在某项目上的资源（`project_resource_links` 三类 + `interview_sessions.project_id`），把问卷答卷 /
 * 访谈片段 / 个人转写片段 / 深研来源写成证据单元（`ProjectEvidencePort.upsert`，幂等）。
 *
 * 本切片不给它开 HTTP 路由——采集是写路径的副作用，不是一个由界面发起的操作；要加入口先在契约束里签。两个调用方：
 *   · `linkProjectResource` 成功后顺带采刚挂上的那一类（+ 访谈，因为访谈没有自己的挂载动作）；
 *   · B3-T2 的入图用例在 `listForIngestion` 之前按 `project_ai_settings.allowed_sources` 调它（`kinds` 参数）。
 * 采集器不判权：`decision` 由调用方交出（对项目的 `read.published`），它是采集器披露来源内容的凭据。
 *
 * chat 消息证据不在这里：它在抽取器写锚点时同步回填（`collect-evidence/chat.ts`）。
 */
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { OrgId } from "../../domain/org-id";
import { collectInterviewEvidence } from "./collect-evidence/interview";
import { collectResearchEvidence } from "./collect-evidence/research";
import { collectSurveyEvidence } from "./collect-evidence/survey";
import { sumResults, type CollectorDeps, type CollectResult } from "./collect-evidence/shared";
import { collectTranscriptEvidence } from "./collect-evidence/transcript";
import type { ProjectEvidenceSourceKind } from "./project-evidence-ports";
import type { ProjectLinkableResourceKind } from "./project-resource-ports";

/** 本入口能采的四类（`chat_message` 走抽取器回填；`attachment` 本切片不采，见回报）。 */
export type CollectableEvidenceKind = Extract<
  ProjectEvidenceSourceKind,
  "survey_response" | "interview_segment" | "transcript_segment" | "research_source"
>;

export const COLLECTABLE_EVIDENCE_KINDS: readonly CollectableEvidenceKind[] = [
  "survey_response",
  "interview_segment",
  "transcript_segment",
  "research_source",
];

/** 可挂载资源类型 → 它产出的证据来源。 */
export const LINKABLE_KIND_TO_EVIDENCE: Record<ProjectLinkableResourceKind, CollectableEvidenceKind> = {
  survey: "survey_response",
  guided_research: "research_source",
  personal_transcription: "transcript_segment",
};

export interface CollectProjectEvidenceInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly decision: PermissionDecision;
  /** 缺省 = 四类全采。 */
  readonly kinds?: readonly CollectableEvidenceKind[];
}

const COLLECTORS: Record<CollectableEvidenceKind, (deps: CollectorDeps, input: Omit<CollectProjectEvidenceInput, "kinds">) => Promise<CollectResult>> = {
  survey_response: collectSurveyEvidence,
  interview_segment: collectInterviewEvidence,
  transcript_segment: collectTranscriptEvidence,
  research_source: collectResearchEvidence,
};

export async function collectProjectEvidence(
  deps: CollectorDeps,
  input: CollectProjectEvidenceInput,
): Promise<Record<CollectableEvidenceKind, CollectResult> & { readonly total: CollectResult }> {
  const kinds = input.kinds ?? COLLECTABLE_EVIDENCE_KINDS;
  const zero: CollectResult = { scanned: 0, created: 0, refreshed: 0 };
  const out: Record<CollectableEvidenceKind, CollectResult> = {
    survey_response: zero, interview_segment: zero, transcript_segment: zero, research_source: zero,
  };
  for (const kind of new Set(kinds)) {
    out[kind] = await COLLECTORS[kind](deps, { orgId: input.orgId, projectId: input.projectId, decision: input.decision });
  }
  return { ...out, total: sumResults(Object.values(out)) };
}
