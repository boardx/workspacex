/**
 * `generateOutline` / `regenerateOutline` —— AI 生成大纲（F84，uc-6-2 R3 步骤3，A3 / V10）。
 *
 * ⚠ 生成失败保留上一版大纲，不清空——本实现的生成器是确定性纯函数（不接外部依赖，
 *   见 `domain/interview/outline.ts` 文件头），因此这条异常路径现在不可达；仓储写入
 *   失败时按 Postgres 的失败语义（异常向上抛，不吞掉），不会出现「看似成功但清空了」
 *   的中间态。
 * ⚠ `force: true` 才覆盖已手改段落，否则 `OUTLINE_OVERWRITE_NEEDS_CONFIRM`（A3）。
 *   `manuallyEdited` 现在恒为 `false`（F85 的逐段编辑尚未实现，见 `outline-ports.ts`
 *   文件头），所以这条分支目前总是放行——这是如实反映当前系统状态，不是提前收窄
 *   接口形状。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import type { IdFactory } from "../artifact/ports";
import { generateOutlineDraft, type OutlineDraftContextThree } from "../../domain/interview/outline";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { NoInterviewAccessError, OutlineOverwriteNeedsConfirmError } from "./errors";
import type { OutlineRecord, OutlineRepository } from "./outline-ports";
import type { InterviewScopeRepository } from "./ports";
import type { TemplateRepository } from "./template-ports";
import type { ConsentSubmissionStore, SubjectRepository } from "./subject-ports";
import type { DecisionIdFactory } from "../identity/ports";
import { getInterviewRosterSubjects } from "./subject-projections";

export interface GenerateOutlineDeps {
  readonly outlines: OutlineRepository;
  readonly scope: InterviewScopeRepository;
  readonly templates: TemplateRepository;
  readonly subjects: SubjectRepository;
  readonly consent: ConsentSubmissionStore;
  readonly decisions: DecisionIdFactory;
  readonly ids: IdFactory;
}

export interface GenerateOutlineDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly interviewId: string;
  readonly context: OutlineDraftContextThree;
  /** 已套用的模板三样（调用方已经从 `getAppliedSnapshot`/wizard 结果里知道，这里不重查）。 */
  readonly templateSections: readonly { readonly name: string; readonly minutes: number; readonly order: number }[];
  readonly templateDataFields: readonly {
    readonly fieldId: string;
    readonly name: string;
    readonly kind: string;
    readonly required: boolean;
  }[];
  readonly force?: boolean;
}

async function rebuild(deps: GenerateOutlineDeps, input: GenerateOutlineDto) {
  const roster = await getInterviewRosterSubjects(
    { subjects: deps.subjects, consent: deps.consent, decisions: deps.decisions },
    input.orgId,
    input.actorId,
    input.interviewId,
  );
  return generateOutlineDraft({
    templateSections: input.templateSections,
    templateDataFields: input.templateDataFields,
    subjects: roster.map((s) => ({
      subjectId: s.subjectId,
      displayName: s.displayName,
      roleTitle: s.roleTitle,
      orgName: s.orgName,
      backgroundAndQuestions: s.backgroundAndQuestions,
    })),
    context: input.context,
  });
}

/** 首次生成（三步向导第三步复用同一逻辑时可直接调 `generateOutlineDraft`；这里是独立重新生成入口）。 */
export async function regenerateOutline(
  deps: GenerateOutlineDeps,
  input: GenerateOutlineDto,
): Promise<OutlineRecord> {
  const guarded = await deps.outlines.getByInterview(input.orgId, input.actorId, input.interviewId);
  let existing: OutlineRecord | null = null;
  if (guarded !== null) {
    const [orgMembership, projectIds] = await Promise.all([
      deps.scope.orgMembershipOf(input.orgId, input.actorId),
      deps.scope.projectIdsOf(input.orgId, input.actorId),
    ]);
    const decision = decideInterviewVisibility({
      decisionId: deps.decisions.next(),
      interview: guarded.facts,
      viewer: { userId: input.actorId, projectIds },
      orgRole: orgMembership.orgRole as OrgRole | null,
      viewerTeamId: orgMembership.teamId,
    });
    const disclosed = discloseDecided(guarded.item, decision);
    if (!isDisclosed(disclosed)) throw new NoInterviewAccessError(input.interviewId);
    existing = disclosed.payload;
  }
  if (existing !== null && existing.manuallyEdited && input.force !== true) {
    throw new OutlineOverwriteNeedsConfirmError(existing.outlineId);
  }

  const sections = await rebuild(deps, input);

  if (existing === null) {
    return deps.outlines.create({
      orgId: input.orgId,
      outlineId: deps.ids.next("outline"),
      interviewId: input.interviewId,
      sections,
      generatedBy: input.actorId,
    });
  }
  return deps.outlines.replaceSections(input.orgId, existing.outlineId, sections);
}
