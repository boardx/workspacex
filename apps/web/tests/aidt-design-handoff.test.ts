import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { loadAidtDesignHandoff } from "@/features/aidt/lib/aidt-design-handoff";
import { confirmAidtVerificationQuestion, createAidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";
import { aidtUiStageSummary, emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { ApiError } from "@/lib/api-client";
import { pinAidtPrototypeInputs, updateAidtPrototypeEntityDraft, confirmAidtPrototypeHandoff, listAidtConfirmedPrototypeEntities, readAidtConfirmedPrototypeHandoff, readAidtPrototypeInputSelection } from "@/features/aidt/lib/aidt-prototype-handoff";
import { reviewedFormalRoundFixture } from "./aidt-round-fixture-independent-qa";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { confirmAidtPrototypeText, bindAidtPrototypeTextOutput, readAidtPrototypeTextConfirmation } from "@/features/aidt/lib/aidt-prototype-text-state";
import { StageDraft } from "@repo/contracts/aidt-stages";
const mock = vi.hoisted(() => ({ enabled: true, read: vi.fn(), history: vi.fn(), confirmedText: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-prototype-confirmed-text", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-prototype-confirmed-text")>(), loadAidtConfirmedPrototypeText: mock.confirmedText }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mock.enabled }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mock.read, listAidtStageHistory: mock.history }));
function stage(stageId: number, revision: number, fields: Record<string, string> = {}): AidtSharedStage {
  return { projectId: "class", stageId, revision, content: { schemaVersion: 1, draft: StageDraft.parse({ ...emptyAidtUiDrafts()[stageId]!, fields }) }, sourceStageRevisions: [], updatedBy: "student", updatedAt: "2026-11-16T00:00:00Z" };
}
const input = { projectId: "class", stageId: 5, sessionToken: "captured-token" };
let records: Record<number, AidtSharedStage>;
let old5: AidtSharedStage;
beforeEach(() => {
  vi.clearAllMocks(); mock.enabled = true; mock.confirmedText.mockRejectedValue(new Error("AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED"));
  old5 = stage(5, 3, { verificationQuestion: "如何理解原入口？", beforeTestBelief: "可能清楚", verificationBasis: "观察A", verificationLimits: "静态意向不等于行为", version: "纸样V1", idea: "排队提示", task: "寻找入口", type: "静态图" });
  old5.content.draft = StageDraft.parse(confirmAidtVerificationQuestion(old5.content.draft));
  old5.sourceStageRevisions = [{ stageId: 3, revision: 2 }, { stageId: 4, revision: 4 }];
  const ideation = stage(4, 4); ideation.content.draft.ideas = [{ id: "chosen", title: "排队提示", description: "展示预计排队位置" }]; ideation.content.draft.selectedIdeaId = "chosen";
  const result = createAidtQuestionSnapshot(old5.content.draft, old5.revision); if (!result.ok) throw new Error(result.reason);
  records = { 3: stage(3, 2, { hmw: "如何帮助赶课者判断？" }), 4: ideation, 5: old5, 6: stage(6, 7, { questionSnapshot: result.serialized, understandingChangeStatus: "insufficient", unresolvedQuestions: "还需观察", returnStep: "5", returnReason: "继续检查入口理解", nextAction: "重做静态图", reflectionConfirmed: "true" }) };
  mock.read.mockImplementation(async (_project: string, id: number) => ({ stage: records[id] ?? null }));
  mock.history.mockImplementation(async (_project: string, id: number, _token: string, options: { beforeRevision: number }) => {
    const found = id === 5 ? old5 : records[id];
    return { items: found && found.revision === options.beforeRevision - 1 ? [found] : [], nextBeforeRevision: null };
  });
});
it("collects only saved confirmed question, HMW and the selected original idea record through authorized read APIs", async () => {
  const result = await loadAidtDesignHandoff(input);
  for (const value of ["如何理解原入口？", "可能清楚", "观察A", "静态意向不等于行为", "如何帮助赶课者判断？", "排队提示", "展示预计排队位置"]) expect(result.offer.text).toContain(value);
  expect(result.sources).toEqual([{ stageId: 5, revision: 3 }, { stageId: 3, revision: 2 }, { stageId: 4, revision: 4 }]);
  expect(mock.read).toHaveBeenCalledWith("class", 5, "captured-token", undefined);
  expect(mock.history).toHaveBeenCalledWith("class", 4, "captured-token", { beforeRevision: 5, limit: 1 }, undefined);
  expect(result.offer.text).toContain("生成结果仍需学生检查");
});
it("uses exact historical S5 for S6 and returning to S5, never the new S5 question", async () => {
  records[5] = stage(5, 99, { verificationQuestion: "新问题不该覆盖旧轮？" });
  for (const request of [{ ...input, stageId: 6 }, { ...input, stageId: 5, roundRevision: 7 }]) {
    mock.read.mockClear(); const result = await loadAidtDesignHandoff(request);
    expect(result.offer.text).toContain("如何理解原入口？"); expect(result.offer.text).not.toContain("新问题不该覆盖旧轮");
    expect(result.offer.text).toContain("第5步 V3"); expect(result.offer.label).toContain("冻结问题");
    expect(mock.read.mock.calls.some(([, id]) => id === 5)).toBe(false);
  }
});
it("preserves a frozen card when its old sources are unavailable and does not substitute current stages", async () => {
  mock.history.mockResolvedValue({ items: [], nextBeforeRevision: null });
  const result = await loadAidtDesignHandoff({ ...input, stageId: 6 });
  expect(result.offer.text).toContain("如何理解原入口？"); expect(result.offer.text).not.toContain("展示预计排队位置");
  expect(result.warnings.join("\n")).toContain("未改用新的第5步");
  expect(mock.read.mock.calls.map(([, id]) => id)).toEqual([6]);
});
it("rejects manual return links for unconfirmed, undecided or other-target saved reflections without locking ordinary S6 drafts", async () => {
  const original = { ...records[6]!.content.draft.fields };
  const changes: Record<string, string>[] = [{ reflectionConfirmed: "" }, { returnStep: "undecided" }, ...[1, 2, 3, 4].map(step => ({ returnStep: String(step) }))];
  for (const fields of changes) {
    records[6]!.content.draft.fields = { ...original, ...fields };
    await expect(loadAidtDesignHandoff({ ...input, roundRevision: 7 })).rejects.toThrow("AIDT_DESIGN_RETURN_CONTEXT_INVALID");
  }
  records[6]!.content.draft.fields = { ...original, reflectionConfirmed: "" };
  expect((await loadAidtDesignHandoff({ ...input, stageId: 6 })).offer.text).toContain("如何理解原入口？");
});
it("does not promote an unsaved/unconfirmed question or treat API failure as missing material", async () => {
  records[5] = stage(5, 3, { verificationQuestion: "学生未确认" });
  await expect(loadAidtDesignHandoff(input)).rejects.toThrow("AIDT_DESIGN_SAVED_QUESTION_REQUIRED");
  mock.read.mockRejectedValueOnce(new Error("503")); await expect(loadAidtDesignHandoff(input)).rejects.toThrow("503");
});
it.each([401, 403, 404])("discards the whole offer when a later historical/source read returns %s after the saved round was readable", async status => {
  const original = mock.history.getMockImplementation()!;
  for (const deniedStage of [5, 3, 4]) {
    const denied = new ApiError(status, status === 404 ? "AIDT_STAGE_NOT_FOUND" : null, undefined);
    mock.history.mockImplementation(async (...args: unknown[]) => { if (args[1] === deniedStage) throw denied; return original(...args); });
    await expect(loadAidtDesignHandoff({ ...input, stageId: 6 })).rejects.toBe(denied);
  }
});
it("keeps unbound current saved S3/S4 visibly separate on first S5 handoff instead of inventing a formal source relation", async () => {
  old5.sourceStageRevisions = [];
  const result = await loadAidtDesignHandoff(input);
  expect(result.offer.text).toContain("如何帮助赶课者判断？");
  expect(result.warnings.join("\n")).toContain("尚未绑定为第5步正式来源");
  expect(old5.sourceStageRevisions).toEqual([]);
});
it("refuses excessive context without silently truncating the original question, and cancels old consumers", async () => {
  old5.content.draft = StageDraft.parse(confirmAidtVerificationQuestion({ ...old5.content.draft, fields: { ...old5.content.draft.fields, verificationQuestion: "很长的问题".repeat(850) } }));
  await expect(loadAidtDesignHandoff(input)).rejects.toThrow("AIDT_DESIGN_CONTEXT_TOO_LONG");
  const cancellation = new AbortController(); cancellation.abort();
  await expect(loadAidtDesignHandoff({ ...input, signal: cancellation.signal })).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  mock.enabled = false; await expect(loadAidtDesignHandoff(input)).rejects.toThrow("AIDT_CONTEXT_CHANGED");
});

it("requires confirmed formal text for the selected Design after pinning multiple exact historical ideas", async () => {
  const selected = records[4]!;
  const formal = reviewedFormalRoundFixture({ projectId: "class", sessionId: "brainstorm-handoff-source", source: { id: "hmw-stable", text: "如何帮助赶课者判断？", revision: 2 }, selectedIndices: [0, 1], ideas: [
    { title: "排队提示", description: "展示预计排队位置。让学生比较等待区域。" },
    { title: "新品对比卡", description: "让学生看到差别。并排列出两款口味。" },
    { title: "路线图", description: "用图标解释领取路线。学生依顺序领取食品。" },
  ] });
  selected.content.draft = formal.draft;
  records[5] = stage(5, 7);
  const prepare = (id: string) => {
    records[5]!.content.draft = StageDraft.parse(updateAidtPrototypeEntityDraft(records[5]!.content.draft, id, draft => {
      const pinned = pinAidtPrototypeInputs({ ...draft, fields: { ...old5.content.draft.fields, verificationQuestion: `问题 ${id}？`, situation: "午休点单" } }, selected, formal.selectedIds, formal.sessionId);
      return confirmAidtVerificationQuestion(pinned)!;
    }));
  };
  prepare("design-A");
  prepare("design-B");
  const prepared = JSON.parse(records[5]!.content.draft.fields["prototypeEntity:design-A"]!);
  expect(readAidtPrototypeInputSelection({ fields: prepared, ideas: [], selectedIdeaId: "" })).toEqual({ revision: selected.revision, brainstormId: formal.sessionId, ideaIds: formal.selectedIds });
  records[3]!.content.draft.fields.definitionHmwId = "hmw-stable";
  records[4] = stage(4, 19, { ideaHandoffIds: '["new"]' });
  mock.history.mockImplementation(async (_project: string, id: number, _token: string, options: { beforeRevision: number }) => ({ items: id === 4 && options.beforeRevision === 5 ? [selected] : id === 3 && options.beforeRevision === 3 ? [records[3]] : [] }));
  await expect(loadAidtDesignHandoff({ ...input, prototypeEntityId: "design-A" })).rejects.toThrow("AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED");
  expect(mock.confirmedText).toHaveBeenCalledWith({ projectId: "class", designId: "design-A", sessionToken: "captured-token", signal: undefined });
  expect(mock.confirmedText.mock.calls.some(([value]) => value.designId === "design-B")).toBe(false);
  await expect(loadAidtDesignHandoff({ ...input, prototypeEntityId: "unrelated" })).rejects.toThrow("AIDT_DESIGN_SAVED_QUESTION_REQUIRED");
});

it("confirms only the selected Design's real version and invalidates handoff if a brief changes", () => {
  const selected = records[4]!;
  const formal = reviewedFormalRoundFixture({ projectId: "class", sessionId: "brainstorm-confirm-source", source: { id: "hmw-stable", text: "如何帮助赶课者判断？", revision: 2 }, selectedIndices: [0], ideas: [
    { title: "排队提示", description: "展示预计排队位置。让学生比较等待区域。" },
    { title: "新品对比卡", description: "让学生看到差别。并排列出两款口味。" },
    { title: "路线图", description: "用图标解释领取路线。学生依顺序领取食品。" },
  ] });
  selected.content.draft = formal.draft;
  const formalLineage = JSON.stringify({ schemaVersion: 1, projectId: "class", stage4Revision: selected.revision, brainstormId: formal.sessionId,
    ideas: formal.selectedIds.map(ideaId => ({ ideaId, references: [{ stageId: 4, revision: selected.revision, entityId: formal.sessionId, role: "brainstorm" }], missing: ["合成夹具未关联实地材料"] })) });
  const designText = "两款并排比较的文字方案";
  const empty = emptyAidtUiDrafts()[5]!;
  const savedText = updateAidtPrototypeEntityDraft(empty, "design-A", draft => {
    const pinned = pinAidtPrototypeInputs({ ...draft, fields: { ...old5.content.draft.fields, situation: "午休点单" } }, selected, formal.selectedIds, formal.sessionId);
    const textDraft = { ...pinned, fields: { ...pinned.fields, prototypeTextDesign: designText, prototypeTextVersion: "text-v1", prototypeTextLineage: formalLineage } };
    return textDraft;
  });
  const base = updateAidtPrototypeEntityDraft(savedText, "design-A", draft => {
    const textConfirmed = confirmAidtPrototypeText(draft, "class", "design-A", 9)!;
    const question = confirmAidtVerificationQuestion(textConfirmed)!;
    const withPrototype = updateAidtPrototypeReference(question, { designId: "design-A", versionId: "v1", designName: "原型A", createdAt: "2026-11-16T00:00:00Z", seq: 1, summary: "两款并排比较", frameCount: 2, generatedFrameCount: 2, source: "model" });
    const bound = bindAidtPrototypeTextOutput(withPrototype, "class", "design-A", "v1", readAidtPrototypeTextConfirmation(textConfirmed)!, { kind: "native", bindingMethod: "student-selected-native-version", boundBy: "student", boundAt: "2026-11-16T00:00:00Z", textSha256: createHash("sha256").update(designText).digest("hex"), lineageSha256: createHash("sha256").update(formalLineage).digest("hex") });
    return confirmAidtPrototypeHandoff(bound)!;
  });
  expect(listAidtConfirmedPrototypeEntities(base).map(value => value.id)).toEqual(["design-A"]);
  expect(listAidtConfirmedPrototypeEntities(updateAidtPrototypeEntityDraft(base, "design-B", draft => ({ ...draft, fields: { task: "另一个实体" } }))).map(value => value.id)).toEqual(["design-A"]);
  const edited = updateAidtPrototypeEntityDraft(base, "design-A", draft => ({ ...draft, fields: { ...draft.fields, task: "修改测试任务" } }));
  expect(listAidtConfirmedPrototypeEntities(edited)).toEqual([]);
});

it("preserves an entity-only draft's unconfirmed status in its saved stage summary", () => {
  const draft = updateAidtPrototypeEntityDraft(emptyAidtUiDrafts()[5]!, "new-design", previous => ({
    ...previous,
    fields: { verificationQuestion: "尚未公开的验证问题" },
  }));
  const before = JSON.stringify(draft);
  const summary = aidtUiStageSummary(5, draft);
  expect(summary).toContain("1 个");
  expect(summary).toContain("new-design");
  expect(summary).toContain("尚未公开的验证问题");
  expect(summary).toContain("草稿或已修改，尚未确认交接");
  expect(summary).not.toContain("本轮已确认交接记录");
  expect(listAidtConfirmedPrototypeEntities(draft)).toEqual([]);
  expect(readAidtConfirmedPrototypeHandoff(draft)).toBeNull();
  expect(JSON.stringify(draft)).toBe(before);
});
