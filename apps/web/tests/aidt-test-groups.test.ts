import { describe, expect, it } from "vitest";
import { aidtTestGroupsComplete, isAidtTestGroupConfirmed, aidtTestGroupDirectory, aidtTestGroupHasEvidence, createAidtTestGroup, readAidtTestGroups, resetAidtTestRound, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { applyAidtTestPlan, confirmAidtTestProposal, readAidtTestPlan, readAidtTestProposal } from "@/features/aidt/lib/aidt-test-proposal";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtQuestionSnapshot } from "@/features/aidt/lib/aidt-verification-loop";

const one = "8d806f0e-516e-4a40-97f9-fcd3991df967";
const two = "2bd72401-e9ca-4dc2-ae30-e82498bced7a";
const snapshot: AidtQuestionSnapshot = {
  schemaVersion: 1, question: "学生能否区分两种口味？", beforeTestBelief: "并排更清楚",
  verificationBasis: "", verificationLimits: "", prototypeRef: "菜单 · V1",
  prototypeDesignId: "design", prototypeVersionId: "v1", sourceStageRevision: 3,
};

describe("AIDT grouped test records", () => {
  it("requires a saved native version and keeps independent groups pinned through round reset", () => {
    const source = emptyAidtUiDrafts()[6]!;
    expect(createAidtTestGroup({ ...snapshot, sourceStageRevision: null }, one)).toBeNull();
    expect(createAidtTestGroup({ ...snapshot, prototypeDesignId: undefined }, one)).toBeNull();
    const a = createAidtTestGroup(snapshot, one, "design")!;
    const b = createAidtTestGroup({ ...snapshot, prototypeVersionId: "v2", sourceStageRevision: 5 }, two)!;
    const initial = updateAidtTestGroup(updateAidtTestGroup(source, { ...a, name: "赶课", said: "没看懂" }), { ...b, name: "闲时" });
    expect(updateAidtTestGroup(initial, { ...a, versionId: "v2" })).toBe(initial);
    const edited = updateAidtTestGroup(initial, { ...a, name: "赶课", archived: true });
    const round = resetAidtTestRound({ ...edited, fields: { ...edited.fields, questionSnapshot: "old", afterTestBelief: "仍需追问" } });
    expect(round.fields.questionSnapshot).toBeUndefined();
    expect(readAidtTestGroups(round.fields)).toMatchObject([
      { id: one, name: "赶课", versionId: "v1", stage5Revision: 3, archived: true },
      { id: two, name: "闲时", versionId: "v2", stage5Revision: 5, archived: false },
    ]);
    expect(aidtTestGroupDirectory(round.fields)).toEqual([
      { id: one, title: "赶课", archived: true },
      { id: two, title: "闲时", archived: false },
    ]);
  });

  it("requires all active cards to be confirmed and invalidates edits to the teaching record", () => {
    const a = createAidtTestGroup(snapshot, one)!;
    const b = createAidtTestGroup(snapshot, two)!;
    const initial = updateAidtTestGroup(updateAidtTestGroup(emptyAidtUiDrafts()[6]!, a), b);
    const proposal = { messageId: "turn-a", result: { entityId: one, task: "读标签", reflection: "尚需复测", evidenceGap: "没观察到行为" } };
    const confirmed = confirmAidtTestProposal(initial, proposal, false);
    const first = readAidtTestGroups(confirmed.fields).find(group => group.id === one)!;
    expect(isAidtTestGroupConfirmed(first)).toBe(true);
    expect(aidtTestGroupsComplete(confirmed)).toBe(false);
    expect(aidtTestGroupsComplete(updateAidtTestGroup(confirmed, { ...b, archived: true }))).toBe(true);
    expect(aidtTestGroupsComplete(confirmAidtTestProposal(confirmed, { ...proposal, messageId: "turn-b", result: { ...proposal.result, entityId: two } }, false))).toBe(true);
    const renamed = updateAidtTestGroup(confirmed, { ...first, name: "午休分组" });
    expect(readAidtTestGroups(renamed.fields)[0]?.confirmedFromMessageId).toBe("turn-a");
    const changed = updateAidtTestGroup(renamed, { ...first, task: "比较标签" });
    expect(isAidtTestGroupConfirmed(readAidtTestGroups(changed.fields)[0]!)).toBe(false);
    expect(updateAidtTestGroup(changed, { ...first, versionId: "later-version" })).toBe(changed);
    expect(aidtTestGroupsComplete({ ...confirmed, fields: { ...confirmed.fields, "testGroup:broken": "invalid" } })).toBe(false);
  });

  it("rejects sibling, student-authored and stale payloads and checks access before accepting evidence", () => {
    const group = createAidtTestGroup(snapshot, one)!;
    const initial = updateAidtTestGroup(emptyAidtUiDrafts()[6]!, group);
    const wire = { entityId: one, task: "读标签", reflection: "继续观察", sourceLocation: "01:42", said: "看懂了", evidenceGap: "行为未观察" };
    const assistant = { id: "assistant", role: "assistant", content: ["```aidt-test-result", JSON.stringify(wire), "```"].join("\n") };
    expect(readAidtTestProposal([assistant], two)).toBeNull();
    expect(readAidtTestProposal([{ ...assistant, role: "user" }], one)).toBeNull();
    expect(readAidtTestProposal([assistant, { id: "new-question", role: "user" }], one)).toBeNull();
    const parsed = readAidtTestProposal([assistant], one)!;
    expect(parsed).toMatchObject({ result: wire });
    expect(confirmAidtTestProposal(initial, parsed, false)).toBe(initial);
  });

  it("reads the existing no-change result without weakening card or field validation", () => {
    const wire = {
      entityId: one, task: "比较销路", reflection: "没有观察到真实用户行为",
      round: { understandingChangeStatus: "no-change", returnStep: "undecided", returnReason: "需要更多材料" },
    };
    const reply = (data: typeof wire) => ({
      id: "assistant", role: "assistant", content: ["```aidt-test-result", JSON.stringify(data), "```"].join("\n"),
    });
    expect(readAidtTestProposal([reply(wire)], one)?.result.round?.understandingChangeStatus).toBe("unchanged");
    expect(readAidtTestProposal([reply(wire)], two)).toBeNull();
    expect(readAidtTestProposal([reply({ ...wire, round: { ...wire.round, understandingChangeStatus: "invalid" } })], one)).toBeNull();
  });

  it("ignores malformed or differently keyed values and never equates source text with evidence", () => {
    const group = createAidtTestGroup(snapshot, one)!;
    expect(readAidtTestGroups({ ["testGroup:" + two]: JSON.stringify(group), ["testGroup:" + one]: "invalid" })).toEqual([]);
    expect(aidtTestGroupHasEvidence({ ...group, said: "一句原话", sourceLocation: "01:42" }, "group", false)).toBe(false);
    const linked = { ...group, source: { kind: "interview" as const, id: "source" }, said: "一句原话", sourceLocation: "01:42" };
    expect(aidtTestGroupHasEvidence(linked, "group", false)).toBe(false);
    expect(aidtTestGroupHasEvidence(linked, "group", true)).toBe(true);
  });
});

it("pins the selected native answer and rejects self-report as observed behavior", () => {
  const group = createAidtTestGroup(snapshot, one)!;
  const draft = updateAidtTestGroup(emptyAidtUiDrafts()[6]!, { ...group, method: "survey",
    source: { kind: "survey", id: "survey-1" }, surveyResponseId: "answer-1", sourceLocation: "答卷 answer-1" });
  const result = { entityId: group.id, task: "对照标签", reflection: "只看到了自报", said: "我会试着买", did: "完成支付",
    sourceLocation: "模型猜测位置" };
  expect(confirmAidtTestProposal(draft, { messageId: "test-turn", result }, true)).toBe(draft);
  const { did: _unsupported, ...statement } = result;
  expect(confirmAidtTestProposal(draft, { messageId: "test-turn", result: statement }, false)).toBe(draft);
  const confirmed = confirmAidtTestProposal(draft, { messageId: "test-turn", result: statement }, true);
  expect(readAidtTestGroups(confirmed.fields)[0]).toMatchObject({ sourceLocation: "答卷 answer-1", surveyResponseId: "answer-1", said: "我会试着买", did: "" });
});

it("autofills a scoped plan from settled Chat without confirming any outcome", () => {
  const a = createAidtTestGroup(snapshot, one)!;
  const b = createAidtTestGroup(snapshot, two)!;
  const draft = updateAidtTestGroup(updateAidtTestGroup(emptyAidtUiDrafts()[6]!, a), b);
  const turn = { id: "plan", role: "assistant", content: ["```aidt-test-plan", JSON.stringify({ entityId: one, task: "让同学指出两种口味" }), "```"].join("\n") };
  expect(readAidtTestPlan([{ id: "hello", role: "user", content: "你好" }, turn], one)).toBeNull();
  const messages = [{ id: "prompt", role: "user", content: "想让同学辨认口味" }, turn];
  expect(readAidtTestPlan(messages, two)).toBeNull();
  const plan = readAidtTestPlan(messages, one)!;
  const updated = applyAidtTestPlan(draft, plan);
  expect(readAidtTestGroups(updated.fields)).toEqual([{ ...a, task: "让同学指出两种口味", planFromMessageId: "plan" }, b]);
  expect(aidtTestGroupsComplete(updated)).toBe(false);
  expect(applyAidtTestPlan(updated, plan)).toBe(updated);
});

it("requires authorized, located evidence before confirming a change in understanding", () => {
  const draft = updateAidtTestGroup(emptyAidtUiDrafts()[6]!, createAidtTestGroup(snapshot, one)!);
  const proposal = { messageId: "test", result: { entityId: one, task: "比较卡片", reflection: "材料还不完整",
    evidenceGap: "尚无实际行为记录", round: { understandingChangeStatus: "changed" as const,
      returnStep: "undecided" as const, returnReason: "还需补访" } } };
  expect(confirmAidtTestProposal(draft, proposal, false)).toBe(draft);
  expect(confirmAidtTestProposal(draft, proposal, true)).toBe(draft);
});
