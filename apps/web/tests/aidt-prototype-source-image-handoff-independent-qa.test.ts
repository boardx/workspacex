import { beforeEach, expect, it, vi } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { DesignProject } from "@repo/contracts/design-workbench";
import { loadAidtDesignHandoff } from "@/features/aidt/lib/aidt-design-handoff";
import { requireAidtNativeSourceImages } from "@/features/aidt/lib/aidt-prototype-source-images";
import { pinAidtPrototypeInputs, updateAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { editAidtPrototypeText, confirmAidtPrototypeText, readAidtPrototypeTextConfirmation, aidtPrototypeTextHashes } from "@/features/aidt/lib/aidt-prototype-text-state";
import { confirmAidtVerificationQuestion } from "@/features/aidt/lib/aidt-verification-loop";
import { completed, empty } from "./aidt-round-fixture-independent-qa";
const mocks = vi.hoisted(() => ({ read: vi.fn(), confirmed: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read, saveAidtStage: vi.fn(), listAidtStageHistory: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-prototype-confirmed-text", () => ({ loadAidtConfirmedPrototypeText: mocks.confirmed, loadAidtBoundPrototypeTextSources: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
vi.mock("@/features/aidt/lib/aidt-research-materials", () => ({ readAidtResearchMaterial: vi.fn(async () => ({})) }));
beforeEach(() => vi.resetAllMocks());
it("the actual handoff must not admit only two source images from a confirmed three-idea text/source list", async () => {
  const formal = completed(empty(), "a"), projectId = "qa-project", designId = "qa-design";
  const sourceStage = { projectId, stageId: 4, revision: 12, content: { schemaVersion: 1 as const, draft: formal.draft }, sourceStageRevisions: [], updatedBy: "qa-student", updatedAt: "2026-11-22T07:00:00Z" };
  const lineage = { schemaVersion: 1, projectId, stage4Revision: 12, brainstormId: formal.sessionId,
    ideas: formal.ids.map(ideaId => ({ ideaId, references: [{ stageId: 4, revision: 12, entityId: ideaId, role: "idea" }], missing: [] })) };
  let draft = pinAidtPrototypeInputs({ ...empty(), fields: { verificationQuestion: "用户能否理解两种比较方式？", beforeTestBelief: "尚无行为证据", verificationBasis: "学生推测", verificationLimits: "仅测试理解", type: "静态图", situation: "合成测试", task: "比较口味" } }, sourceStage, formal.ids, formal.sessionId);
  draft = { ...draft, fields: { ...draft.fields, prototypeTextLineage: JSON.stringify(lineage) } };
  draft = confirmAidtPrototypeText(editAidtPrototypeText(draft, "正式文字V2：展示三个已选择点子的比较流程。", "text-v2"), projectId, designId, 20)!;
  draft = confirmAidtVerificationQuestion(draft)!;
  const confirmation = readAidtPrototypeTextConfirmation(draft)!;
  expect(JSON.parse(confirmation.selection).ideaIds).toHaveLength(3);
  const stored = updateAidtPrototypeEntityDraft(updateAidtPrototypeEntityDraft(empty(), designId, () => ({ ...draft, fields: { ...draft.fields, prototypeTextConfirmation: "" } })), designId, () => draft);
  mocks.read.mockResolvedValue({ stage: { ...sourceStage, stageId: 5, revision: 21, content: { schemaVersion: 1, draft: StageDraft.parse(stored) } } });
  // A frozen text/source resolver can report a missing material without replacing
  // the selected idea or its historical text. The real handoff must preserve that
  // completeness boundary before allowing a visual prototype request.
  const items = formal.ids.map((ideaId, index) => ({ ideaId, title: "已选点子 " + index,
    missing: index === 2 ? ["该点子的冻结描述单图片缺失或不可核对"] : [],
    views: [{ reference: { stageId: 4, revision: 12, entityId: ideaId, role: "idea" }, title: "已选点子 " + index, text: "已保存文字", href: "/aidt/qa-project?step=4",
      ...(index === 2 ? {} : { image: JSON.parse(formal.draft.fields[`ideaFile:${ideaId}`]!) }) }] }));
  mocks.confirmed.mockResolvedValue({ confirmation, hashes: await aidtPrototypeTextHashes(confirmation), sources: { lineage, items, restricted: false } });
  const handoff = await loadAidtDesignHandoff({ projectId, stageId: 5, prototypeEntityId: designId, sessionToken: "qa-token" });
  expect(handoff.sourceImages).toHaveLength(2);
  // The fixture's two materials have the same bytes. An existing legitimate
  // native receipt therefore covers their one deduplicated image, but it cannot
  // stand in for the third selected idea that has no image at all.
  const image = handoff.sourceImages![1]!;
  const receipt = { sourceRunId: image.reference.runId, artifactId: image.reference.artifactId, versionId: image.reference.versionId,
    sha256: image.reference.sha256, stage4Revision: image.stage4Revision, brainstormId: image.brainstormId,
    nativeImageId: "native-ref", nativeName: "saved-source.png", nativeSize: image.reference.bytes, nativeMime: "image/png" };
  const withReceipt = updateAidtPrototypeEntityDraft(stored, designId, old => ({ ...old, fields: { ...old.fields, prototypeSourceImages: JSON.stringify({
    schemaVersion: 1, projectId, designId, textStageRevision: confirmation.stageRevision, textVersion: confirmation.textVersion,
    textSha256: handoff.textBasis!.textSha256, images: [receipt],
  }) } }));
  mocks.read.mockResolvedValue({ stage: { ...sourceStage, stageId: 5, revision: 22, content: { schemaVersion: 1, draft: StageDraft.parse(withReceipt) } } });
  const native = DesignProject.parse({ id: designId, name: "合成测试", template: "mobile", problem: "", criteria: [], frames: [], prototype: [], frameNotes: [],
    refImages: [{ id: receipt.nativeImageId, name: receipt.nativeName, size: receipt.nativeSize, mime: "image/png", createdAt: "2026-11-22" }],
    pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null, chat: [], ownerId: "qa-student", ownerName: "QA", createdAt: "2026-11-22", updatedAt: "2026-11-22" });
  await expect(requireAidtNativeSourceImages({ projectId, stageId: 5, sessionToken: "qa-token", prototypeEntityId: designId }, handoff, native)).rejects.toThrow(/部分入选点子/);
});
