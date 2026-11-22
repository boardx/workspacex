import { AIDT_TEST_GROUP_ROUND_PREFIX } from "@repo/contracts/aidt-return-reflection";
import { AIDT_REFLECTION_FIELDS, readAidtQuestionSnapshot, isAidtReflectionConfirmed, formatAidtTestReflectionMarkdown } from "./aidt-verification-loop";
import { AIDT_ITERATION_PROTOTYPE_REFERENCE_FIELD, AIDT_ITERATION_PROTOTYPE_RELATION_FIELD, AIDT_ITERATION_FEEDBACK_FIELD, AIDT_ITERATION_REASON_FIELD } from "./aidt-prototype-reference";
import { readAidtTestGroups, type AidtTestGroup } from "./aidt-test-groups";
import type { AidtSharedStage } from "./live-aidt-stages";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

const prefix = (id: string) => `${AIDT_TEST_GROUP_ROUND_PREFIX}${id}:`;
export const AIDT_TEST_GROUP_ROUND_FIELDS = ["questionSnapshot", "version", ...AIDT_REFLECTION_FIELDS, "reflectionConfirmed", "newVersion",
  AIDT_ITERATION_PROTOTYPE_REFERENCE_FIELD, AIDT_ITERATION_PROTOTYPE_RELATION_FIELD, AIDT_ITERATION_FEEDBACK_FIELD, AIDT_ITERATION_REASON_FIELD, "iterationSourceStageRevision", "testSourceSignature", "publicationRevision"] as const;

export function aidtTestGroupRoundMatches(round: AidtUiStageDraft, group: AidtTestGroup) {
  const snapshot = readAidtQuestionSnapshot(round);
  return Boolean(snapshot && snapshot.prototypeDesignId === group.designId && snapshot.prototypeVersionId === group.versionId && snapshot.sourceStageRevision === group.stage5Revision);
}

/** A display-only rename is not a new research source. All other fields remain exact. */
export function aidtTestGroupSourceSignature(group: AidtTestGroup) {
  const { name: _name, ...source } = group;
  return JSON.stringify(source);
}
function sourceSignatureMatches(raw: string | undefined, group: AidtTestGroup) {
  if (!raw || raw.length > 6000) return false;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    // Legacy signatures include name. New signatures omit it; both must still
    // parse as the same strict research record before comparing real sources.
    const record = Object.prototype.hasOwnProperty.call(value, "name") ? value : { ...value, name: "" };
    const stored = readAidtTestGroups({ ["testGroup:" + group.id]: JSON.stringify(record) })[0];
    return Boolean(stored && aidtTestGroupSourceSignature(stored) === aidtTestGroupSourceSignature(group));
  } catch { return false; }
}

/** An entity never borrows another testing entity's global reflection. */
export function readAidtTestGroupRound(draft: AidtUiStageDraft, entityId: string): AidtUiStageDraft | null {
  const group = readAidtTestGroups(draft.fields).find(item => item.id === entityId);
  if (!group) return null;
  const fields: Record<string, string> = {};
  for (const key of AIDT_TEST_GROUP_ROUND_FIELDS) {
    const value = draft.fields[prefix(entityId) + key];
    if (value !== undefined) fields[key] = value;
  }
  const round = { fields, ideas: [], selectedIdeaId: "" };
  return fields.questionSnapshot && sourceSignatureMatches(fields.testSourceSignature, group) && aidtTestGroupRoundMatches(round, group) ? round : null;
}

/** Writes only this entity. Global compatibility is published solely on explicit confirmation. */
export function writeAidtTestGroupRound(draft: AidtUiStageDraft, expected: AidtTestGroup, round: AidtUiStageDraft, publish: boolean, publicationRevision?: number): AidtUiStageDraft {
  const current = readAidtTestGroups(draft.fields).find(item => item.id === expected.id && !item.archived);
  if (!current || JSON.stringify(current) !== JSON.stringify(expected) || !aidtTestGroupRoundMatches(round, current)
    || publish && !isAidtReflectionConfirmed(round)) throw new Error("测试记录或冻结原型已变化，未保存本轮行动。");
  if (publish && (!Number.isInteger(publicationRevision) || publicationRevision! < 1 || publicationRevision! > 2147483647)) throw new Error("本轮发布版本尚未核对，未保存。");
  const fields = { ...draft.fields };
  for (const key of AIDT_TEST_GROUP_ROUND_FIELDS) {
    if (key === "publicationRevision" && publish) fields[prefix(expected.id) + key] = String(publicationRevision);
    else if (key === "testSourceSignature") fields[prefix(expected.id) + key] = aidtTestGroupSourceSignature(expected);
    else if (round.fields[key] !== undefined) fields[prefix(expected.id) + key] = round.fields[key]!;
    else delete fields[prefix(expected.id) + key];
  }
  if (publish) {
    for (const key of AIDT_TEST_GROUP_ROUND_FIELDS) {
      if (key === "testSourceSignature" || key === "publicationRevision") continue;
      if (round.fields[key] !== undefined) fields[key] = round.fields[key]!;
      else delete fields[key];
    }
    fields.reflectionSourceEntity = expected.id;
    fields.reflectionTestEntityId = expected.id;
  } else if (fields.reflectionSourceEntity === expected.id) fields.reflectionConfirmed = "";
  if (Object.keys(fields).length > 100 || Object.values(fields).some(value => value.length > 6000))
    throw new Error("本步保存空间不足，请精简本轮说明；未覆盖历史或其他测试记录。");
  return { ...draft, fields };
}

export function aidtTestGroupRoundReportLines(draft: AidtUiStageDraft, entityId: string) {
  const round = readAidtTestGroupRound(draft, entityId);
  return round ? [`### 测试 ${entityId} 的本轮行动`, ...formatAidtTestReflectionMarkdown(round)] : [];
}

/** A return link must use this entity's actual published historical revision. */
export function aidtTestGroupPublicationMatches(stage: AidtSharedStage, entityId: string, expected?: AidtUiStageDraft) {
  const round = readAidtTestGroupRound(stage.content.draft, entityId);
  if (stage.stageId !== 6 || stage.content.draft.fields.reflectionSourceEntity !== entityId
    || (stage.content.draft.fields.reflectionTestEntityId && stage.content.draft.fields.reflectionTestEntityId !== entityId) || !round
    || round.fields.publicationRevision !== String(stage.revision) || !isAidtReflectionConfirmed(round)) return false;
  if (expected && JSON.stringify(expected) !== JSON.stringify(round)) return false;
  return AIDT_TEST_GROUP_ROUND_FIELDS.every(key => key === "testSourceSignature" || key === "publicationRevision"
    || (round.fields[key] ?? "") === (stage.content.draft.fields[key] ?? ""));
}
