import { z } from "zod";
import { AidtPrototypeIdentifierSchema, type AidtQuestionSnapshot } from "@repo/contracts/aidt-return-reflection";
import { AidtResearchMaterial, AidtResearchMaterialIdentifier } from "./aidt-research-material-reference";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

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
  task: z.string().max(300).default(""),
  participant: z.string().max(80),
  situation: z.string().max(300),
  method: TestResource.shape.kind,
  source: TestResource.nullable(),
  sourceLocation: z.string().max(180),
  material: AidtResearchMaterial.nullable(),
  said: z.string().max(500),
  did: z.string().max(500),
  interpretation: z.string().max(500),
  decision: z.enum(["pending", "adopted", "declined"]),
  decisionReason: z.string().max(350),
}).strict().refine(group => group.source?.kind === group.method || group.source === null);

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
  const value = JSON.stringify(TestGroup.parse(group));
  if (value.length > 6000 || value === draft.fields[key]) return draft;
  return { ...draft, fields: { ...draft.fields, [key]: value, reflectionConfirmed: "" } };
}

export function aidtTestGroupHasEvidence(group: AidtTestGroup, projectId: string, sourceAccessible: boolean, materialAccessible = false): boolean {
  const hasMaterial = materialAccessible && group.material?.projectId === projectId;
  return Boolean((hasMaterial || (sourceAccessible && group.source)) && group.sourceLocation.trim() && (group.said.trim() || group.did.trim()));
}

/** A new round clears its shared reflection, while named testing entities remain addressable. */
export function resetAidtTestRound(draft: AidtUiStageDraft): AidtUiStageDraft {
  const fields = Object.fromEntries(Object.entries(draft.fields).filter(([key]) => key.startsWith(prefix)));
  return { ...draft, fields };
}
