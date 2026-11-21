import { describe, expect, it } from "vitest";
import { aidtTestGroupsComplete, isAidtTestGroupConfirmed, aidtTestGroupDirectory, aidtTestGroupHasEvidence, createAidtTestGroup, readAidtTestGroups, resetAidtTestRound, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { confirmAidtTestProposal, readAidtTestProposal } from "@/features/aidt/lib/aidt-test-proposal";
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

  it("ignores malformed or differently keyed values and never equates source text with evidence", () => {
    const group = createAidtTestGroup(snapshot, one)!;
    expect(readAidtTestGroups({ ["testGroup:" + two]: JSON.stringify(group), ["testGroup:" + one]: "invalid" })).toEqual([]);
    expect(aidtTestGroupHasEvidence({ ...group, said: "一句原话", sourceLocation: "01:42" }, "group", false)).toBe(false);
    const linked = { ...group, source: { kind: "interview" as const, id: "source" }, said: "一句原话", sourceLocation: "01:42" };
    expect(aidtTestGroupHasEvidence(linked, "group", false)).toBe(false);
    expect(aidtTestGroupHasEvidence(linked, "group", true)).toBe(true);
  });
});
