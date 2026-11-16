import { describe, expect, it } from "vitest";
import { AidtContextSelector, type AidtContextReceipt } from "@repo/contracts/aidt-run-context";
import { aidtV2WireMetadata, expectedAidtV2StageSelector, validateAidtV2Receipt } from "../e2e/support/aidt-v2-wire-metadata";

const source = { stageId: 1, field: "initial", marker: "UNIQUE_DB_MATERIAL_NOT_STUDENT_PROMPT" };
const selector = { schemaVersion: 1, purpose: "stage", projectId: "synthetic-project", stageId: 2, stageRevisions: [{ stageId: 1, revision: 2 }] };
const body = () => ({ messages: [{ role: "user", content: "学生自己的问题，逐字保留。" }], forwardedProps: { aidtContext: selector }, context: [] });

describe("real-model QA wire: coordinates only, never material consumption proof", () => {
  it("expects S2's actual saved S1 V1 reference even when S1 head is V3", () => {
    const saved = [{ projectId: "p", stageId: 1, revision: 3, sourceStageRevisions: [] }, { projectId: "p", stageId: 2, revision: 2, sourceStageRevisions: [{ stageId: 1, revision: 1 }] }];
    expect(expectedAidtV2StageSelector("p", 2, saved).stageRevisions).toEqual([{ stageId: 1, revision: 1 }, { stageId: 2, revision: 2 }]);
    expect(saved[0]?.revision).toBe(3);
  });
  it("only falls back to heads when the current step has no saved references", () => {
    expect(expectedAidtV2StageSelector("p", 2, [{ projectId: "p", stageId: 1, revision: 3, sourceStageRevisions: [] }, null]).stageRevisions).toEqual([{ stageId: 1, revision: 3 }]);
  });
  it("does not derive a plausible selector from a cross-project server row", () => {
    expect(() => expectedAidtV2StageSelector("p", 2, [{ projectId: "other", stageId: 1, revision: 3, sourceStageRevisions: [] }])).toThrow(/SCOPE_MISMATCH/);
  });
  it("accepts a strict stage selector without saved material in the browser body", () => {
    expect(aidtV2WireMetadata(body(), [source], "aidt-empathize")).toMatchObject({ selectorCoordinates: selector, coordinatesOnly: true, rawValuesRetained: false });
  });
  it("rejects the old TeachingContext material payload instead of demanding its marker", () => {
    expect(() => aidtV2WireMetadata({ ...body(), context: [{ value: { sharedStageContext: { text: source.marker } } }] }, [source], "aidt-empathize")).toThrow();
  });
  it("rejects saved bytes leaked through another field or serialized JSON string", () => {
    expect(() => aidtV2WireMetadata({ ...body(), state: JSON.stringify({ hidden: source.marker }) }, [source], "aidt-empathize")).toThrow();
  });
  it("uses strict contract parsing so forged material/teacher fields cannot ride inside selector", () => {
    expect(() => aidtV2WireMetadata({ ...body(), forwardedProps: { aidtContext: { ...selector, teacherComments: "invented", text: "forged" } } }, [], "aidt-empathize")).toThrow();
  });
  it("rejects missing selector and wrong stage Skill before claiming a valid QA wire", () => {
    expect(() => aidtV2WireMetadata({ messages: [] }, [], "aidt-empathize")).toThrow();
    expect(() => aidtV2WireMetadata(body(), [], "aidt-understand")).toThrow();
  });
  it("requires the independent summary task, not stage six with a generic Skill", () => {
    expect(() => aidtV2WireMetadata(body(), [], "dt-summarize-project")).toThrow();
    const summary = { schemaVersion: 1, purpose: "summary", projectId: "synthetic-project", stageRevisions: [{ stageId: 1, revision: 2 }], historyRevisions: [{ stageId: 1, revision: 1 }] };
    expect(aidtV2WireMetadata({ ...body(), forwardedProps: { aidtContext: summary } }, [source], "dt-summarize-project")).toMatchObject({ selectorCoordinates: summary, coordinatesOnly: true });
  });
  it("keeps source marker text, user input and bearer values out of the safe metadata", () => {
    const record = JSON.stringify(aidtV2WireMetadata({ ...body(), accessToken: "private-test-token" }, [source], "aidt-empathize"));
    expect(record).not.toContain(source.marker); expect(record).not.toContain("学生自己的问题"); expect(record).not.toContain("private-test-token");
  });
  it("preserves an actual student's deliberate quotation but rejects its duplicate automatic carrier", () => {
    const text = `学生主动引用：${source.marker}，请核对。`;
    const quoted = { ...body(), messages: [{ role: "user", content: text }] };
    expect(aidtV2WireMetadata(quoted, [source], "aidt-empathize", undefined, [text]).messages[0]?.hasSavedMarker).toBe(true);
    expect(quoted.messages[0]?.content).toBe(text);
    expect(() => aidtV2WireMetadata({ ...quoted, context: [{ value: text }] }, [source], "aidt-empathize", undefined, [text])).toThrow();
    expect(() => aidtV2WireMetadata(quoted, [source], "aidt-empathize", undefined, ["different actual student text"])).toThrow();
  });
  it("allows only exact GET-verified canonical history, never an assistant-shaped material carrier", () => {
    const text = `旧助手草稿引用：${source.marker}`;
    const canonical = [{ id: "stored-agent-message", role: "assistant" as const, text }];
    const old = { ...body(), messages: [{ id: canonical[0]!.id, role: "assistant", content: text }] };
    expect(aidtV2WireMetadata(old, [source], "aidt-empathize", undefined, [], canonical).messages[0]?.hasSavedMarker).toBe(true);
    for (const changed of [{ ...old.messages[0], content: `${text}改字` }, { ...old.messages[0], id: "new-fake-id" }, { ...old.messages[0], role: "user" }, { ...old.messages[0], role: "system" }]) {
      expect(() => aidtV2WireMetadata({ ...old, messages: [changed] }, [source], "aidt-empathize", undefined, [], canonical)).toThrow(/MATERIAL_BODY_LEAK/);
    }
    expect(() => aidtV2WireMetadata({ ...old, context: [{ value: text }] }, [source], "aidt-empathize", undefined, [], canonical)).toThrow(/MATERIAL_BODY_LEAK/);
    expect(() => aidtV2WireMetadata({ ...old, forwardedProps: { aidtContext: selector, hidden: text } }, [source], "aidt-empathize", undefined, [], canonical)).toThrow(/MATERIAL_BODY_LEAK/);
  });
  it("also binds historical human quotes to verified ids and role, while the current authored input remains literal", () => {
    const text = `学生上轮主动引用：${source.marker}`;
    const history = [{ id: "stored-human", role: "user" as const, text }];
    const valid = { ...body(), messages: [{ id: "stored-human", role: "user", content: [{ type: "text", text }] }] };
    expect(aidtV2WireMetadata(valid, [source], "aidt-empathize", undefined, [], history).messages[0]?.hasSavedMarker).toBe(true);
    expect(() => aidtV2WireMetadata({ ...valid, messages: [{ ...valid.messages[0], id: "fake-human" }] }, [source], "aidt-empathize", undefined, [], history)).toThrow(/MATERIAL_BODY_LEAK/);
    expect(() => aidtV2WireMetadata({ ...valid, messages: [{ ...valid.messages[0], role: "assistant" }] }, [source], "aidt-empathize", undefined, [], history)).toThrow(/MATERIAL_BODY_LEAK/);
  });
  it("compares exact independently selected historical coordinates, not whichever head is latest", () => {
    const expected = AidtContextSelector.parse({ ...selector, stageRevisions: [{ stageId: 1, revision: 1 }] });
    expect(() => aidtV2WireMetadata(body(), [], "aidt-empathize", expected)).toThrow(/COORDINATES_MISMATCH/);
    expect(aidtV2WireMetadata(body(), [], "aidt-empathize", AidtContextSelector.parse(selector)).coordinatesOnly).toBe(true);
  });
});

const time = "2026-11-16T00:00:00.000Z";
function dispatched(): AidtContextReceipt { return { runId: "actual-run", projectId: "synthetic-project", purpose: "stage", stageId: 2, skillVersionId: "exact-mounted-version", snapshotHash: "a".repeat(64), preparedAt: time, stageRevisions: [{ stageId: 1, revision: 2 }], historyRevisions: [], omissions: [], truncated: false,
  application: { state: "message-dispatch-observed", attemptId: "actual-run:0", assembledContextHash: "b".repeat(64), assembledAt: time, messageDispatchedAt: time, checkpointResumedAt: null, inheritedMessageDispatchAttemptId: null } }; }
const expected = () => ({ selector: AidtContextSelector.parse(selector), runId: "actual-run", skillVersionId: "exact-mounted-version", snapshotHash: "a".repeat(64) });

describe("real-model QA receipt: source coordinates and actual application proof", () => {
  it("accepts actual dispatch and keeps canonical source equality independent of list order", () => { expect(validateAidtV2Receipt(dispatched(), expected())).toEqual(dispatched()); });
  it.each(["runId", "projectId", "skillVersionId", "snapshotHash"] as const)("rejects changed %s instead of treating another receipt as this run", key => {
    const bad = { ...dispatched(), [key]: key === "snapshotHash" ? "c".repeat(64) : "wrong" };
    expect(() => validateAidtV2Receipt(bad, expected())).toThrow();
  });
  it("rejects a receipt that silently swapped the selected old revision for the head", () => {
    expect(() => validateAidtV2Receipt({ ...dispatched(), stageRevisions: [{ stageId: 1, revision: 3 }] }, expected())).toThrow();
  });
  it.each(["prepared", "assembled", "failed-before-dispatch", "unknown"] as const)("does not count %s as model dispatch", state => {
    expect(() => validateAidtV2Receipt({ ...dispatched(), application: { ...dispatched().application, state } }, expected())).toThrow(/DISPATCH_NOT_PROVEN/);
  });
  it("can freeze an initial prepared receipt while still requiring later dispatch proof", () => {
    const raw = { ...dispatched(), application: { state: "prepared", attemptId: null, assembledContextHash: null, assembledAt: null, messageDispatchedAt: null, checkpointResumedAt: null, inheritedMessageDispatchAttemptId: null } };
    expect(validateAidtV2Receipt(raw, { ...expected(), requireDispatch: false }).application.state).toBe("prepared");
    expect(() => validateAidtV2Receipt(raw, expected())).toThrow();
  });
  it("accepts only same-run resume inheriting an actual original message dispatch", () => {
    const resume = { ...dispatched(), application: { ...dispatched().application, state: "checkpoint-resume-observed", attemptId: "actual-run:9", assembledAt: null, messageDispatchedAt: null, checkpointResumedAt: time, inheritedMessageDispatchAttemptId: "actual-run:0" } };
    expect(validateAidtV2Receipt(resume, { ...expected(), originalDispatchAttemptId: "actual-run:0" }).application.state).toBe("checkpoint-resume-observed");
    expect(() => validateAidtV2Receipt({ ...resume, application: { ...resume.application, inheritedMessageDispatchAttemptId: null } }, expected())).toThrow();
    expect(() => validateAidtV2Receipt(resume, { ...expected(), originalDispatchAttemptId: "another-run:0" })).toThrow();
  });
  it("compares exact return revision and the independent SUM current/history coordinates", () => {
    const stage = { ...dispatched(), returnRevision: 4 };
    expect(() => validateAidtV2Receipt(stage, expected())).toThrow();
    expect(validateAidtV2Receipt(stage, { ...expected(), selector: AidtContextSelector.parse({ ...selector, returnRevision: 4 }) }).returnRevision).toBe(4);
    const summary = { ...dispatched(), purpose: "summary", stageId: undefined, historyRevisions: [{ stageId: 1, revision: 1 }] };
    const sumExpected = { ...expected(), selector: AidtContextSelector.parse({ schemaVersion: 1, purpose: "summary", projectId: "synthetic-project", stageRevisions: selector.stageRevisions, historyRevisions: [{ stageId: 1, revision: 1 }] }) };
    expect(validateAidtV2Receipt(summary, sumExpected).historyRevisions).toEqual([{ stageId: 1, revision: 1 }]);
    expect(() => validateAidtV2Receipt({ ...summary, historyRevisions: [] }, sumExpected)).toThrow();
  });
});
