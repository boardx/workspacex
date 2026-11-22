import { AidtPrototypeTextConfirmation as TextConfirmation } from "@repo/contracts/aidt-prototype-text";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { editAidtPrototypeText, confirmAidtPrototypeText, readAidtPrototypeTextConfirmation, isAidtPrototypeTextConfirmed, aidtPrototypeTextHashes,
  bindAidtPrototypeTextOutput, readAidtPrototypeTextOutputBindings, aidtPrototypeOutputMatchesText } from "@/features/aidt/lib/aidt-prototype-text-state";
import { readAidtPrototypeEntityDraft, updateAidtPrototypeEntityDraft, pinAidtPrototypeInputs } from "@/features/aidt/lib/aidt-prototype-handoff";
import { loadAidtBoundPrototypeTextSources, loadAidtConfirmedPrototypeText } from "@/features/aidt/lib/aidt-prototype-confirmed-text";
import { loadAidtDesignHandoff } from "@/features/aidt/lib/aidt-design-handoff";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";

const mocks = vi.hoisted(() => ({ read: vi.fn(), revision: vi.fn(), history: vi.fn(), sources: vi.fn(), request: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read, readAidtStageRevision: mocks.revision, listAidtStageHistory: mocks.history }));
vi.mock("@/features/aidt/lib/aidt-prototype-text-sources", () => ({ loadAidtPrototypeTextSources: mocks.sources }));
vi.mock("@/lib/api-client", () => ({ apiRequest: mocks.request, ApiError: class ApiError extends Error {} }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
import { completed, empty } from "./aidt-round-fixture-independent-qa";
const input = { projectId: "qa-project", designId: "qa-design", sessionToken: "qa-token" };
const formal = completed(empty(), "a");
const sourceStage: AidtSharedStage = { projectId: input.projectId, stageId: 4, revision: 12, content: { schemaVersion: 1, draft: StageDraft.parse(formal.draft) }, sourceStageRevisions: [], updatedAt: "2026-11-22T05:00:00Z", updatedBy: "qa-student" };
const selection = JSON.stringify({ revision: 12, brainstormId: formal.sessionId, ideaIds: formal.ids });
const lineage = { schemaVersion: 1, projectId: input.projectId, stage4Revision: 12, brainstormId: formal.sessionId,
  ideas: formal.ids.map(ideaId => ({ ideaId, references: [{ stageId: 4, revision: 12, entityId: ideaId, role: "idea" }], missing: ["合成单元夹具：未包含访谈正文"] })) };
function draft(text = "V2：三口试饮，先说明容量和等待时间。", version = "text-v2") {
  const pinned = pinAidtPrototypeInputs(emptyAidtUiDrafts()[5]!, sourceStage, formal.ids, formal.sessionId);
  let value: AidtUiStageDraft = { ...pinned, fields: { ...pinned.fields, prototypeTextLineage: JSON.stringify(lineage) } };
  value = editAidtPrototypeText(value, text, version);
  return value;
}
function stage(value: AidtUiStageDraft, revision = 20): AidtSharedStage {
  return { projectId: input.projectId, stageId: 5, revision, updatedBy: "qa-student", updatedAt: "2026-11-22T05:00:00Z", sourceStageRevisions: [{ stageId: 4, revision: 12 }],
    content: { schemaVersion: 1, draft: StageDraft.parse(updateAidtPrototypeEntityDraft(updateAidtPrototypeEntityDraft(emptyAidtUiDrafts()[5]!, input.designId, () => ({ ...value, fields: { ...value.fields, prototypeTextConfirmation: "" } })), input.designId, () => value)) } };
}
async function confirmedOutput() {
  const original = draft();
  const confirmed = confirmAidtPrototypeText(original, input.projectId, input.designId, 20)!;
  const basis = readAidtPrototypeTextConfirmation(confirmed)!;
  const hashes = await aidtPrototypeTextHashes(basis);
  const bound = bindAidtPrototypeTextOutput(confirmed, input.projectId, input.designId, "prototype-v2", basis, {
    ...hashes, kind: "native", bindingMethod: "student-selected-native-version", boundBy: "qa-student", boundAt: "2026-11-22T05:01:00Z",
  });
  return { original, confirmed, basis, bound, hashes };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ items: [{ kind: "design", id: input.designId, title: "合成设计", ownerUserId: "qa-student", status: "draft", updatedAt: "2026-11-22T05:00:00Z", linkedAt: "2026-11-22T05:00:00Z" }], counts: { design: 1 } });
  mocks.sources.mockImplementation(async value => ({ lineage: value.lineage, items: [], restricted: false }));
});

it("saves/reopens exact formal text and keeps the three chosen idea identities in the entity projection", () => {
  const value = draft(); const shared = stage(value);
  const reopened = readAidtPrototypeEntityDraft(JSON.parse(JSON.stringify(shared.content.draft)), input.designId)!;
  expect(reopened.fields.prototypeTextDesign).toBe(value.fields.prototypeTextDesign);
  expect(reopened.fields.prototypeTextVersion).toBe("text-v2");
  expect(JSON.parse(reopened.fields.prototypeIdeaSource!)).toEqual({ revision: 12, brainstormId: formal.sessionId, ideaIds: formal.ids });
  expect(isAidtPrototypeTextConfirmed(reopened)).toBe(false);
});

it("requires a content-matching confirmation and preserves old prototype bindings after an unconfirmed V3 edit", async () => {
  const { bound, basis } = await confirmedOutput();
  expect(isAidtPrototypeTextConfirmed(bound)).toBe(true);
  expect(aidtPrototypeOutputMatchesText(bound, input.designId, "prototype-v2")).toBe(true);
  const v3 = editAidtPrototypeText(bound, "V3：尚未确认，改成整杯免费并取消等待提示。", "text-v3");
  expect(isAidtPrototypeTextConfirmed(v3)).toBe(false);
  expect(aidtPrototypeOutputMatchesText(v3, input.designId, "prototype-v2")).toBe(false);
  expect(readAidtPrototypeTextOutputBindings(v3)).toEqual(readAidtPrototypeTextOutputBindings(bound));
  expect(readAidtPrototypeTextOutputBindings(v3)[0]).toMatchObject({ textStageRevision: 20, textVersion: basis.textVersion, versionId: "prototype-v2", providerIndependentlyVerified: false });
  expect(bindAidtPrototypeTextOutput(v3, input.projectId, input.designId, "prototype-v3", basis, {
    kind: "native", bindingMethod: "student-selected-native-version", boundBy: "qa-student", boundAt: "2026-11-22T05:02:00Z", textSha256: "a".repeat(64), lineageSha256: "b".repeat(64),
  })).toBe(v3);
});

it("refuses to silently rebind the same native prototype version to a later confirmed text revision", async () => {
  const { bound } = await confirmedOutput();
  const v3 = confirmAidtPrototypeText(editAidtPrototypeText(bound, "V3：新一轮明确不同的设计。", "text-v3"), input.projectId, input.designId, 24)!;
  const basis = readAidtPrototypeTextConfirmation(v3)!;
  const hashes = await aidtPrototypeTextHashes(basis);
  expect(bindAidtPrototypeTextOutput(v3, input.projectId, input.designId, "prototype-v2", basis, { ...hashes, kind: "native", bindingMethod: "student-selected-native-version", boundBy: "qa-student", boundAt: "2026-11-22T05:03:00Z" })).toBe(v3);
  expect(readAidtPrototypeTextOutputBindings(v3)[0]?.textVersion).toBe("text-v2");
});

it("loads current confirmed V2 against the real history return shape and rejects current unconfirmed V3", async () => {
  const { original, confirmed, hashes } = await confirmedOutput();
  mocks.read.mockResolvedValue({ stage: stage(confirmed, 21) });
  // The actual public helper returns SharedStageValue itself, not { stage }.
  mocks.revision.mockResolvedValue(stage(original, 20));
  const result = await loadAidtConfirmedPrototypeText(input);
  expect(result.confirmation.textVersion).toBe("text-v2"); expect(result.hashes).toEqual(hashes);
  expect(mocks.revision).toHaveBeenCalledWith(input.projectId, 5, 20, input.sessionToken, undefined);
  mocks.read.mockResolvedValue({ stage: stage(editAidtPrototypeText(confirmed, "V3 未确认的新设计", "text-v3"), 25) });
  await expect(loadAidtConfirmedPrototypeText(input)).rejects.toThrow("AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED");
});

it("resolves an older bound output from V2 only while V3 is current, and still rejects revoked sources", async () => {
  const { original, bound } = await confirmedOutput(); const binding = readAidtPrototypeTextOutputBindings(bound)[0]!;
  mocks.read.mockResolvedValue({ stage: stage(editAidtPrototypeText(bound, "V3 不应替代旧原型的设计", "text-v3"), 25) });
  mocks.revision.mockResolvedValue(stage(original, 20));
  await expect(loadAidtBoundPrototypeTextSources(input, binding)).resolves.toMatchObject({ restricted: false });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.revision).toHaveBeenLastCalledWith(input.projectId, 5, 20, input.sessionToken, undefined);
  mocks.sources.mockResolvedValue({ lineage, items: [], restricted: true });
  await expect(loadAidtBoundPrototypeTextSources(input, binding)).rejects.toThrow("AIDT_PROTOTYPE_SOURCE_REVOKED");
});

it("does not accept a substituted revision or hash even if it looks like a valid saved design", async () => {
  const { bound } = await confirmedOutput(); const binding = readAidtPrototypeTextOutputBindings(bound)[0]!;
  mocks.revision.mockResolvedValue(stage(draft("V3：替换内容", "text-v3"), 20));
  await expect(loadAidtBoundPrototypeTextSources(input, binding)).rejects.toThrow("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
  mocks.revision.mockResolvedValue(stage(draft(), 20));
  await expect(loadAidtBoundPrototypeTextSources(input, { ...binding, textSha256: "f".repeat(64) })).rejects.toThrow("AIDT_PROTOTYPE_TEXT_VERSION_MISMATCH");
  expect(mocks.sources).not.toHaveBeenCalled();
});


async function frozenRound() {
  const values = await confirmedOutput();
  const preparation = { verificationQuestion: "用户能否理解试饮量？", beforeTestBelief: "应当能理解", verificationBasis: "尚无行为证据", verificationLimits: "仅核对理解，不代表实际购买" };
  const original = confirmAidtVerificationQuestion({ ...values.original, fields: { ...values.original.fields, ...preparation } })!;
  const prototype = confirmAidtVerificationQuestion(updateAidtPrototypeReference({ ...values.bound, fields: { ...values.bound.fields, ...preparation } }, {
    designId: input.designId, versionId: "prototype-v2", designName: "V2合成服务原型", seq: 2, createdAt: "2026-11-22T05:02:00Z", summary: "三口试饮", frameCount: 1, generatedFrameCount: 1, source: "model",
  }))!;
  const snapshot = createAidtQuestionSnapshot(prototype, 22); if (!snapshot.ok) throw new Error(snapshot.reason);
  const round: AidtSharedStage = { ...stage(original, 30), stageId: 6, content: { schemaVersion: 1, draft: { fields: { questionSnapshot: snapshot.serialized }, ideas: [], selectedIdeaId: "" } } };
  mocks.read.mockImplementation(async (_project: string, id: number) => {
    if (id === 5) throw new Error("MUST_NOT_READ_CURRENT_V3");
    return { stage: id === 6 ? round : null };
  });
  mocks.revision.mockImplementation(async (_project: string, id: number, revision: number) => id === 5 && revision === 20 ? stage(original, 20) : null);
  mocks.history.mockImplementation(async (_project: string, id: number, _token: string, options: { beforeRevision: number }) => ({ items: id === 5 && options.beforeRevision === 23 ? [stage(prototype, 22)] : id === 5 && options.beforeRevision === 21 ? [stage(original, 20)] : [], nextBeforeRevision: null }));
  return { ...values, original, prototype, round };
}

it("builds S6 frozen handoff from the exact prototype's V2 text while current V3 is forbidden to that read path", async () => {
  await frozenRound();
  const handoff = await loadAidtDesignHandoff({ projectId: input.projectId, stageId: 6, sessionToken: input.sessionToken });
  expect(handoff.offer.text).toContain("V2：三口试饮");
  expect(handoff.offer.text).not.toContain("V3");
  expect(handoff.textBasis).toMatchObject({ designId: input.designId, stageRevision: 20, textVersion: "text-v2" });
  expect(handoff.sources).toContainEqual({ stageId: 5, revision: 20 });
  expect(handoff.sources).toContainEqual({ stageId: 5, revision: 22 });
  expect(mocks.read.mock.calls.some(([, id]) => id === 5)).toBe(false);
});

it("does not replace a missing frozen text revision with current V3 or fabricate a confirmed text basis", async () => {
  const { prototype } = await frozenRound();
  mocks.history.mockImplementation(async (_project: string, id: number, _token: string, options: { beforeRevision: number }) => ({ items: id === 5 && options.beforeRevision === 23 ? [stage(prototype, 22)] : [], nextBeforeRevision: null }));
  const handoff = await loadAidtDesignHandoff({ projectId: input.projectId, stageId: 6, sessionToken: input.sessionToken });
  expect(handoff.textBasis).toBeUndefined(); expect(handoff.warnings.join(" ")).toContain("文字设计历史缺失");
  expect(handoff.offer.text).toContain("用户能否理解试饮量");
  expect(mocks.read.mock.calls.some(([, id]) => id === 5)).toBe(false);
});


it("retains a pre-round output binding for historical reading but refuses to reconfirm or generate from that legacy basis", async () => {
  const value = draft();
  const { brainstormId: _legacyRound, ...oldLineage } = lineage;
  const legacy: AidtUiStageDraft = { ...value, fields: { ...value.fields, prototypeIdeaSource: JSON.stringify({ revision: 12, ideaIds: formal.ids }), prototypeTextLineage: JSON.stringify(oldLineage) } };
  const oldBasis = TextConfirmation.parse({ schemaVersion: 1, projectId: input.projectId, designId: input.designId, stageRevision: 20,
    textVersion: legacy.fields.prototypeTextVersion, text: legacy.fields.prototypeTextDesign, selection: legacy.fields.prototypeIdeaSource, lineage: legacy.fields.prototypeTextLineage });
  const { text, lineage: historicLineage, ...metadata } = oldBasis;
  const oldConfirmed = { ...legacy, fields: { ...legacy.fields, prototypeTextConfirmation: JSON.stringify(metadata), prototypeTextConfirmedText: text, prototypeTextConfirmedLineage: historicLineage } };
  const hashes = await aidtPrototypeTextHashes(oldBasis);
  const binding = { schemaVersion: 1 as const, projectId: input.projectId, designId: input.designId, versionId: "legacy-native-version", textStageRevision: 20, textVersion: oldBasis.textVersion,
    ...hashes, kind: "native" as const, bindingMethod: "student-selected-native-version" as const, boundBy: "historical-student", boundAt: "2026-11-20T05:00:00Z", providerIndependentlyVerified: false as const };
  mocks.revision.mockResolvedValue(stage(legacy, 20));
  await expect(loadAidtBoundPrototypeTextSources(input, binding)).resolves.toMatchObject({ restricted: false });
  expect(mocks.read).not.toHaveBeenCalled();
  expect(confirmAidtPrototypeText(oldConfirmed, input.projectId, input.designId, 22)).toBeNull();
  mocks.read.mockResolvedValue({ stage: stage(oldConfirmed, 21) });
  await expect(loadAidtConfirmedPrototypeText(input)).rejects.toThrow("AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED");
});
