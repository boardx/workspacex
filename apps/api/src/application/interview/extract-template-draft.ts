/**
 * `extractTemplateDraft` —— 从若干已办访谈反向抽取模板草案（uc-6-1 A3 / R3 步骤5）。
 *
 * ⚠ 结果是**草案**，`confirmTemplateDraft` 之前**不进模板库**（V3）——`listTemplates`/
 * `getTemplate` 都只读 `interview_templates`/`interview_template_versions`，草案存在
 * 别的地方（`TemplateDraftStore`），这条边界靠「压根没有共享存储」保证，不是靠约定。
 *
 * ## 可访问性判定复用 F80 的既有门，不新开一条
 *
 * 每个 `sourceInterviewId` 先经 `InterviewScopeRepository.findVisibleById` +
 * `decideInterviewVisibility`（与 `getInterview` 同一条路径，见该文件）——这是本仓
 * UC-0.3 R7「权限跟着数据路径走」的既有实现，不是为本 feature 另起一套判断。只有通过
 * 这道门的 id，才会被拿去读 `TemplateDraftSourceReader`（同意位 + 已套用素材，那两张表
 * 的读不是第二道未判定的门——见 `pg-source-interview-reader.ts` 文件头）。
 *
 * O-05：拒绝 AI 分析的场次不进抽取输入（在通过可访问性判定之后再判）。
 */
import type { IdFactory } from "../artifact/ports";
import type { OrgId } from "../../domain/org-id";
import type { OrgRole } from "../../domain/identity/roles";
import { decideInterviewVisibility } from "../../domain/interview/visibility-decision";
import { defaultDraftName, mergeTemplateDraftContent } from "../../domain/interview/template-draft";
import type { DecisionIdFactory } from "../identity/ports";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { NoInterviewAccessError } from "./errors";
import type { InterviewScopeRepository } from "./ports";
import type { TemplateDraftRecord, TemplateDraftSourceReader, TemplateDraftStore } from "./template-draft-ports";

export interface ExtractTemplateDraftDeps {
  readonly scopeRepo: InterviewScopeRepository;
  readonly decisions: DecisionIdFactory;
  readonly reader: TemplateDraftSourceReader;
  readonly store: TemplateDraftStore;
  readonly ids: IdFactory;
}

export interface ExtractTemplateDraftDto {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly sourceInterviewIds: readonly string[];
}

async function assertVisible(
  deps: ExtractTemplateDraftDeps,
  orgId: OrgId,
  viewerUserId: string,
  interviewId: string,
): Promise<void> {
  const guarded = await deps.scopeRepo.findVisibleById(orgId, viewerUserId, interviewId);
  if (guarded === null) throw new NoInterviewAccessError(interviewId);

  const [projectIds, membership] = await Promise.all([
    deps.scopeRepo.projectIdsOf(orgId, viewerUserId),
    deps.scopeRepo.orgMembershipOf(orgId, viewerUserId),
  ]);
  const disclosed = discloseDecided(
    guarded.item,
    decideInterviewVisibility({
      decisionId: deps.decisions.next(),
      interview: guarded.facts,
      viewer: { userId: viewerUserId, projectIds },
      orgRole: membership.orgRole as OrgRole | null,
      viewerTeamId: membership.teamId,
    }),
  );
  if (!isDisclosed(disclosed)) throw new NoInterviewAccessError(interviewId);
}

export async function extractTemplateDraft(
  deps: ExtractTemplateDraftDeps,
  input: ExtractTemplateDraftDto,
): Promise<TemplateDraftRecord> {
  // 任一来源 id 不可见 ⇒ 整体拒绝（NO_INTERVIEW_ACCESS）：不静默把它从来源里丢掉——
  // 那会让研究员以为自己选的 3 场全都参与了抽取，实际上只有 2 场。
  for (const interviewId of input.sourceInterviewIds) {
    await assertVisible(deps, input.orgId, input.actorId, interviewId);
  }

  const lookups = await deps.reader.readSourceMaterials(input.orgId, input.sourceInterviewIds);

  // O-05：拒绝 AI 分析的场次静默排除在合并素材之外（不是错误，是「这场没有可用素材」）。
  const usable = lookups.filter((l) => l.aiAnalysisAllowed);
  const merged = mergeTemplateDraftContent(
    usable.map((l) => ({ interviewId: l.interviewId, sections: l.sections, dataFields: l.dataFields })),
  );
  const sourceInterviewIds = usable.map((l) => l.interviewId);

  return deps.store.save({
    draftId: deps.ids.next("tpldraft"),
    orgId: input.orgId,
    actorId: input.actorId,
    name: defaultDraftName(sourceInterviewIds),
    goal: "",
    sections: merged.sections,
    dataFields: merged.dataFields,
    sourceInterviewIds,
  });
}
