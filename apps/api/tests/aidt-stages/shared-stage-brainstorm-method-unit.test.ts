import { expect, it } from "vitest";
import { AIDT_BRAINSTORM_METHOD_GUIDES, AIDT_BRAINSTORM_METHODS, AidtBrainstorm, type AidtBrainstormMethod } from "@repo/contracts/aidt-brainstorm";
import { AIDT_CONTEXT_LIMITS, aidtContextCanonicalJson, type AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { SharedStage, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { aidtSavedEntityContext } from "../../src/application/aidt-stages/entity-thread";
import { prepareAidtContext } from "../../src/application/aidt-run-context/prepare";

const methods = Object.keys(AIDT_BRAINSTORM_METHODS) as AidtBrainstormMethod[];
const id = "brainstorm-selected";
const source = { id: "hmw-frozen", revision: 4, text: "我们如何帮助赶课的学生理解等待信息？" };
const focus = { skillId: "skill-ideate", skillVersionId: "skill-v1", skillStableName: "aidt-ideate", title: "创意发散" };
const selector: AidtContextSelector = { schemaVersion: 1, projectId: "project-owned", purpose: "stage", stageId: 4, stageRevisions: [{ stageId: 4, revision: 7 }] };
function scene(method: AidtBrainstormMethod, long = false): SharedStageValue {
  const candidates = Array.from({ length: long ? 24 : 1 }, (_, index) => `idea-${index}`);
  const hmw = long ? { ...source, text: ("如何理解学生的等待情境\\\"？").repeat(150).slice(0, 2000) } : source;
  const selected = AidtBrainstorm.parse({ id, source: hmw, method, count: long ? 24 : 5, candidates });
  const sibling = AidtBrainstorm.parse({ id: "brainstorm-other", source: { ...source, id: "hmw-other", revision: 2, text: "其他场次的问题" }, method: method === "free" ? "reverse" : "free", count: 1, candidates: ["other-idea"] });
  return SharedStage.parse({ projectId: selector.projectId, stageId: 4, revision: 7, updatedBy: "student-owned", updatedAt: "2026-11-22T03:00:00.000Z",
    sourceStageRevisions: [{ stageId: 3, revision: source.revision }], content: { schemaVersion: 1, draft: {
      fields: { ["ideaBrainstorm:" + id]: JSON.stringify(selected), "ideaBrainstorm:brainstorm-other": JSON.stringify(sibling) },
      ideas: [...candidates.map((candidate, index) => ({ id: candidate, title: long ? `学生点子${index}：` + "学生自己提出的长标题".repeat(90) : "学生先提出的点子", description: "学生自己的说明，仍待讨论。" })), { id: "other-idea", title: "别的场次点子", description: "不能串入。" }], selectedIdeaId: "",
    } } });
}
function prepared(stage: SharedStageValue) {
  const payload = aidtSavedEntityContext(stage, id);
  const result = prepareAidtContext(selector, focus, [{ kind: "stage", stage, payload }], new Map([[4, 99]]));
  const frame = JSON.parse(result.snapshot.modelReferenceBlock.split("\n")[2]!);
  return { payload, result, excerpt: frame.materials[0].excerpt as string };
}

it.each(methods)("injects only the saved %s guide through the actual canonical prepared model message", method => {
  const stage = scene(method), before = aidtContextCanonicalJson(stage);
  const { payload, result, excerpt } = prepared(stage);
  const projected = JSON.parse(excerpt);
  expect(projected.brainstorm.activity).toEqual({ methodKey: method, methodGuide: AIDT_BRAINSTORM_METHOD_GUIDES[method] });
  expect(projected.brainstorm).toMatchObject({ method: AIDT_BRAINSTORM_METHODS[method], hmw: source });
  expect(projected.existingCandidateTitles).toEqual(["学生先提出的点子"]);
  expect(payload).toMatchObject({ entityId: id, brainstorm: { hmw: source } });
  for (const other of methods.filter(key => key !== method)) expect(excerpt).not.toContain(AIDT_BRAINSTORM_METHOD_GUIDES[other].description);
  expect(excerpt).not.toContain("别的场次点子");
  expect(result.snapshot.sources).toEqual([expect.objectContaining({ stageId: 4, revision: 7, truncated: false })]);
  expect(aidtContextCanonicalJson(stage)).toBe(before);
});

it.each(methods)("preserves the complete %s activity ahead of long HMW/candidate text under unchanged limits", method => {
  const stage = scene(method, true), before = aidtContextCanonicalJson(stage);
  const { result, excerpt } = prepared(stage);
  const activity = aidtContextCanonicalJson({ methodKey: method, methodGuide: AIDT_BRAINSTORM_METHOD_GUIDES[method] });
  expect(excerpt.startsWith('{"brainstorm":{"activity":' + activity)).toBe(true);
  expect(excerpt.length).toBeLessThanOrEqual(AIDT_CONTEXT_LIMITS.currentExcerptChars);
  expect(result.snapshot.truncated).toBe(true);
  expect(result.snapshot.sources[0]?.truncated).toBe(true);
  expect(result.snapshot.omissions).toContainEqual({ kind: "truncated", stageId: 4, revision: 7 });
  expect(Buffer.byteLength(JSON.stringify({ role: "user", content: result.snapshot.modelReferenceBlock }))).toBeLessThanOrEqual(AIDT_CONTEXT_LIMITS.referenceMessageBytes - AIDT_CONTEXT_LIMITS.referenceEnvelopeReserveBytes);
  for (const other of methods.filter(key => key !== method)) expect(excerpt).not.toContain(AIDT_BRAINSTORM_METHOD_GUIDES[other].description);
  expect(aidtContextCanonicalJson(stage)).toBe(before);
});

it("does not invent a method guide for a missing scene or silently replace an invalid method", () => {
  const stage = scene("free");
  expect(aidtSavedEntityContext(stage, "brainstorm-missing")).not.toHaveProperty("brainstorm");
  const raw = JSON.parse(stage.content.draft.fields["ideaBrainstorm:" + id]!);
  stage.content.draft.fields["ideaBrainstorm:" + id] = JSON.stringify({ ...raw, method: "auto-best" });
  expect(aidtSavedEntityContext(stage, id)).not.toHaveProperty("brainstorm");
});
