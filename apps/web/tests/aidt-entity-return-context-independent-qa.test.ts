import { beforeEach, expect, it, vi } from "vitest";
import { loadAidtReturnChatContext } from "@/features/aidt/lib/aidt-chat-return-context";
import { writeAidtTestGroupRound } from "@/features/aidt/lib/aidt-test-group-round";
import { createAidtTestGroup, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtHref } from "@/features/aidt/lib/project-aidt";
const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ listAidtStageHistory: mocks.history }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
const idA = "de20a00b-f962-43de-972f-99fcb89a0141", idB = "de20a00b-f962-43de-972f-99fcb89a0142";
function fixture() {
  const question = { schemaVersion: 1 as const, question: "合成QA原验证问题", beforeTestBelief: "预期", verificationBasis: "合成测试", verificationLimits: "待真实验证", prototypeRef: "旧版V2", sourceStageRevision: 4, prototypeDesignId: "design-qa", prototypeVersionId: "native-old-v2" };
  const reflection = (label: string) => ({ fields: { questionSnapshot: JSON.stringify(question), version: question.prototypeRef,
    understandingChangeStatus: "insufficient", unresolvedQuestions: `${label}材料不足`, returnStep: "2", returnReason: `${label}补访理由`, nextAction: `${label}下一行动`, reflectionConfirmed: "true" }, ideas: [], selectedIdeaId: "" });
  const a = createAidtTestGroup(question, idA)!, b = createAidtTestGroup(question, idB)!;
  let draft = updateAidtTestGroup(updateAidtTestGroup(emptyAidtUiDrafts()[6]!, a), b);
  draft = writeAidtTestGroupRound(draft, a, reflection("A"), true, 7);
  const whenA = structuredClone(draft);
  draft = writeAidtTestGroupRound(draft, b, reflection("B"), true, 8);
  const stage = (content: typeof draft, revision: number) => ({ projectId: "p", stageId: 6, revision, sourceStageRevisions: [], updatedBy: "qa", updatedAt: "2026-11-22T08:00:00Z", content: { schemaVersion: 1, draft: content } });
  return { whenA: stage(whenA, 7), whenB: stage(draft, 8) };
}
const input = { projectId: "p", currentStage: 2, sessionToken: "isolated-qa-token", returnRevision: "7", returnEntity: idA };
beforeEach(() => { vi.resetAllMocks(); mocks.history.mockResolvedValue({ items: [fixture().whenA], nextBeforeRevision: null }); });
it("preserves route-only returnEntity and uses exactly the approved immutable owner revision", async () => {
  expect(aidtHref("p", 2, { returnEntity: idA, returnRevision: "7" })).toContain(`returnEntity=${idA}`);
  const value = await loadAidtReturnChatContext(input);
  expect(value.status).toBe("ready"); expect(value.items[0]?.fields.returnReason).toBe("A补访理由");
  expect(JSON.stringify(value)).not.toContain("B补访理由");
  expect(mocks.history).toHaveBeenCalledWith("p", 6, input.sessionToken, { beforeRevision: 8, limit: 1 }, undefined);
});
it("refuses another group's later publication rather than silently projecting its global reflection", async () => {
  mocks.history.mockResolvedValue({ items: [fixture().whenB], nextBeforeRevision: null });
  expect((await loadAidtReturnChatContext({ ...input, returnRevision: "8" })).status).toBe("failed");
  const ownB = await loadAidtReturnChatContext({ ...input, returnRevision: "8", returnEntity: idB });
  expect(ownB.status).toBe("ready"); expect(ownB.items[0]?.fields.returnReason).toBe("B补访理由");
});
it.each(["", " ", idB, "unknown-entity"])("refuses absent or mismatched exact namespace %j", async returnEntity => {
  expect((await loadAidtReturnChatContext({ ...input, returnEntity })).status).toBe("failed");
});
it("rejects namespace/global divergence, unconfirmed publication and a wrong return target", async () => {
  for (const mutate of [
    (fields: Record<string, string>) => { fields[`testRound:${idA}:returnReason`] = "different"; },
    (fields: Record<string, string>) => { fields.reflectionConfirmed = ""; },
    (fields: Record<string, string>) => { fields.returnStep = "5"; },
    (fields: Record<string, string>) => { delete fields[`testRound:${idA}:testSourceSignature`]; },
  ]) {
    const stage = fixture().whenA; mutate(stage.content.draft.fields);
    mocks.history.mockResolvedValueOnce({ items: [stage], nextBeforeRevision: null });
    expect((await loadAidtReturnChatContext(input)).status).toBe("failed");
  }
});
it("does not accept cross-project or substituted version bodies and retains legacy behavior without entity", async () => {
  for (const stage of [{ ...fixture().whenA, projectId: "other" }, { ...fixture().whenA, revision: 8 }]) {
    mocks.history.mockResolvedValueOnce({ items: [stage], nextBeforeRevision: null });
    expect((await loadAidtReturnChatContext(input)).status).toBe("failed");
  }
  expect((await loadAidtReturnChatContext({ ...input, returnEntity: undefined })).status).toBe("ready");
});
