import { z } from "zod";
import { AIDT_TEST_GROUP_ROUND_PREFIX, AidtPrototypeIdentifierSchema, type AidtQuestionSnapshot } from "@repo/contracts/aidt-return-reflection";
import { AidtResearchMaterial, AidtResearchMaterialIdentifier } from "./aidt-research-material-reference";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import { AidtTestResearchPath, AIDT_TEST_VIRTUAL_RESEARCH_PREFIX } from "./aidt-test-research";
import { AidtSyntheticFileAsrKind, AIDT_TEST_SYNTHETIC_ASR_PREFIX } from "@repo/contracts/aidt-test-research";

const prefix = "testGroup:";
const GroupId = z.string().uuid();
const TestResource = z.object({
  kind: z.enum(["interview", "survey"]),
  id: AidtResearchMaterialIdentifier,
}).strict();

const TestGroup = z.object({
  schemaVersion: z.literal(1),
  id: GroupId,
  stage5Revision: z.number().int().positive(),
  designId: AidtPrototypeIdentifierSchema,
  versionId: AidtPrototypeIdentifierSchema,
  name: z.string().max(80),
  archived: z.boolean().default(false),
  prototypeEntity: AidtPrototypeIdentifierSchema.optional(),
  reflection: z.string().max(400).default(""),
  evidenceGap: z.string().max(400).optional(),
  afterTestBelief: z.string().max(1200).optional(),
  understandingChange: z.enum(["changed", "unchanged", "insufficient"]).optional(),
  confirmedFromMessageId: z.string().min(1).max(200).optional(),
  planFromMessageId: z.string().min(1).max(200).optional(),
  task: z.string().max(300).default(""),
  participant: z.string().max(80),
  situation: z.string().max(300),
  method: TestResource.shape.kind,
  researchPath: AidtTestResearchPath.optional(),
  evidenceOrigin: AidtSyntheticFileAsrKind.optional(),
  source: TestResource.nullable(),
  sourceLocation: z.string().max(180),
  surveyResponseId: AidtResearchMaterialIdentifier.optional(),
  audioConsentAt: z.string().datetime().optional(),
  material: AidtResearchMaterial.nullable(),
  said: z.string().max(500),
  did: z.string().max(500),
  interpretation: z.string().max(500),
  decision: z.enum(["pending", "adopted", "declined"]),
  decisionReason: z.string().max(350),
}).strict().refine(group => (group.source?.kind === group.method || group.source === null)
  && (!group.surveyResponseId || group.source?.kind === "survey")
  && (!group.audioConsentAt || group.method === "interview")
  && (!group.researchPath || (group.researchPath === "survey" ? group.method === "survey" : group.method === "interview")));

export type AidtTestGroup = z.infer<typeof TestGroup>;

export function readAidtTestGroups(fields: Readonly<Record<string, string>>): AidtTestGroup[] {
  return Object.entries(fields).flatMap(([key, raw]) => {
    if (!key.startsWith(prefix) || raw.length > 6000) return [];
    try {
      const result = TestGroup.safeParse(JSON.parse(raw));
      return result.success && key === prefix + result.data.id ? [result.data] : [];
    } catch {
      return [];
    }
  });
}

export function aidtTestGroupDirectory(fields: Readonly<Record<string, string>>) {
  return readAidtTestGroups(fields).map(({ id, name, archived }) => ({ id, title: name.trim() || "测试组", archived }));
}

export function createAidtTestGroup(snapshot: AidtQuestionSnapshot | null, id: string, prototypeEntity?: string): AidtTestGroup | null {
  if (!snapshot?.sourceStageRevision || !snapshot.prototypeDesignId || !snapshot.prototypeVersionId) return null;
  return TestGroup.parse({
    schemaVersion: 1, id, stage5Revision: snapshot.sourceStageRevision,
    designId: snapshot.prototypeDesignId, versionId: snapshot.prototypeVersionId,
    name: "", prototypeEntity, participant: "", situation: "", method: "interview",
    source: null, sourceLocation: "", material: null, said: "", did: "", interpretation: "",
    decision: "pending", decisionReason: "",
  });
}

export function updateAidtTestGroup(draft: AidtUiStageDraft, group: AidtTestGroup): AidtUiStageDraft {
  const { id, designId, versionId, stage5Revision } = TestGroup.parse(group);
  const prior = readAidtTestGroups(draft.fields).find(item => item.id === id);
  const key = prefix + id;
  if (prior && (prior.designId !== designId || prior.versionId !== versionId || prior.stage5Revision !== stage5Revision || prior.prototypeEntity !== group.prototypeEntity)) return draft;
  if (!prior && (key in draft.fields || Object.keys(draft.fields).length >= 100)) return draft;
  const updated = TestGroup.parse(group);
  if (prior && updated.confirmedFromMessageId === prior.confirmedFromMessageId
    && testWorkChanged(prior, updated)) {
    delete updated.confirmedFromMessageId;
  }
  const value = JSON.stringify(updated);
  if (value.length > 6000 || value === draft.fields[key]) return draft;
  const reflectionChanged = !prior || prior.archived !== updated.archived || testWorkChanged(prior, updated);
  return { ...draft, fields: { ...draft.fields, [key]: value, ...(reflectionChanged ? { reflectionConfirmed: "" } : {}) } };
}

function testWorkChanged(before: AidtTestGroup, after: AidtTestGroup): boolean {
  const { name: _beforeName, archived: _beforeArchived, confirmedFromMessageId: _beforeConfirmation, ...beforeWork } = before;
  const { name: _afterName, archived: _afterArchived, confirmedFromMessageId: _afterConfirmation, ...afterWork } = after;
  return JSON.stringify(beforeWork) !== JSON.stringify(afterWork);
}

export function isAidtTestGroupConfirmed(group: AidtTestGroup): boolean {
  return Boolean(group.confirmedFromMessageId && group.task.trim() && group.reflection.trim()
    && (group.evidenceGap?.trim() || (group.researchPath !== "virtual" && !group.evidenceOrigin && (group.source || group.material) && group.sourceLocation.trim() && (group.said.trim() || group.did.trim()))));
}

export function aidtTestGroupsComplete(draft: AidtUiStageDraft): boolean {
  const keys = Object.keys(draft.fields).filter(key => key.startsWith(prefix));
  const groups = readAidtTestGroups(draft.fields);
  const active = groups.filter(group => !group.archived);
  return keys.length === groups.length && active.length > 0 && active.every(isAidtTestGroupConfirmed);
}

export function aidtTestGroupHasEvidence(group: AidtTestGroup, projectId: string, sourceAccessible: boolean, materialAccessible = false): boolean {
  if (group.researchPath === "virtual" || group.evidenceOrigin) return false;
  const hasMaterial = materialAccessible && group.material?.projectId === projectId;
  return Boolean((hasMaterial || (sourceAccessible && group.source)) && group.sourceLocation.trim() && (group.said.trim() || group.did.trim()));
}

/** A new round clears its shared reflection, while named testing entities remain addressable. */
export function resetAidtTestRound(draft: AidtUiStageDraft): AidtUiStageDraft {
  const fields = Object.fromEntries(Object.entries(draft.fields).filter(([key]) => key.startsWith(prefix) || key.startsWith(AIDT_TEST_GROUP_ROUND_PREFIX) || key.startsWith(AIDT_TEST_VIRTUAL_RESEARCH_PREFIX) || key.startsWith(AIDT_TEST_SYNTHETIC_ASR_PREFIX)));
  return { ...draft, fields };
}
