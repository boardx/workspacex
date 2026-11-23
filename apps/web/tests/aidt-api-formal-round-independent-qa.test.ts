import { expect, it, vi } from "vitest";
import { StageDraft, type SharedStageValue } from "@repo/contracts/aidt-stages";
import { aidtBrainstormRoundCompletionKey } from "@repo/contracts/aidt-brainstorm";
import { entityLineage } from "../../api/src/application/aidt-run-context/entity-lineage";
import { aidtSavedEntityContext } from "../../api/src/application/aidt-stages/entity-thread";
import { aidtEntityArtifactInstructions } from "../../api/src/application/aidt-run-context/entity-artifact-instructions";
import { editAidtPrototypeText, confirmAidtPrototypeText } from "@/features/aidt/lib/aidt-prototype-text-state";
import { updateAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { completed, empty, projectId, source } from "./aidt-round-fixture-independent-qa";
const make = (step: number, revision: number, draft = empty()): SharedStageValue => ({ projectId, stageId: step, revision, content: { schemaVersion: 1, draft: StageDraft.parse(draft) }, sourceStageRevisions: [], updatedBy: "qa-student", updatedAt: "2026-11-22T06:20:00Z" });
function fixture() {
  const a = completed(empty(), "a"), b = completed(a.draft, "b");
  const four = make(4, 12, b.draft);
  four.content.draft.ideas = four.content.draft.ideas.map(idea => a.ids.includes(idea.id) ? { ...idea, title: "全局新草稿标题", description: "这是编辑中的全局文字。不能替换正式图文。" } : idea);
  four.content.draft.fields.ideaHmwSource = JSON.stringify(source("b"));
  four.content.draft.fields.ideaClassificationTags = "{}"; four.content.draft.fields.ideaClassificationConfirmed = "";
  const three = make(3, 4, { ...empty(), fields: { "definitionHmw:hmw-a": JSON.stringify({ id: "hmw-a", text: source("a").text, confirmed: true, archived: false, cardIds: [], personaIds: [], rationale: "合成研究输入" }) } });
  const five = make(5, 20, { ...empty(), fields: { "prototypeEntity:qa-design": JSON.stringify({ prototypeIdeaSource: JSON.stringify({ revision: 12, brainstormId: a.sessionId, ideaIds: a.ids }) }) } });
  const exact = vi.fn(async (step: number, revision: number): Promise<SharedStageValue> => {
    if (step === 4 && revision === 12) return four;
    if (step === 3 && revision === 4) return three;
    throw new Error(`UNEXPECTED_EXACT_SOURCE_${step}_${revision}`);
  });
  return { a, b, three, four, five, exact };
}

it("projects only the exact pinned formal round's sheets and classification while global drafts differ", async () => {
  const { a, four, five, exact } = fixture();
  const refs = await entityLineage(five, "qa-design", exact, undefined, { orgId: "qa-org" });
  const sheets = refs.filter(ref => ref.step === 4 && a.ids.includes(ref.entityId));
  expect(sheets).toHaveLength(3);
  const encoded = JSON.stringify(sheets);
  expect(encoded).toContain("a 比较卡"); expect(encoded).toContain("把两款口味分列展示。"); expect(encoded).toContain("easy");
  expect(encoded).not.toMatch(/全局新草稿标题|编辑中的全局文字|b 比较卡|hmw-b/);
  expect(sheets.every(ref => ref.revision === 12 && ref.href === `/aidt/${projectId}?step=4&entity=${a.sessionId}&entityRevision=12`)).toBe(true);
  expect(refs).toContainEqual(expect.objectContaining({ step: 4, entityId: a.sessionId, revision: 12 }));
  // In its own S4 discussion, saved draft content intentionally remains the current discussion.
  expect(JSON.stringify(aidtSavedEntityContext(four, a.sessionId))).toContain("全局新草稿标题");
});

it.each(["missing-round", "broken-round", "foreign-round-project", "foreign-stage-project", "wrong-version", "wrong-hmw-text", "unconfirmed-hmw"] as const)("refuses %s without substituting the valid global B list", async fault => {
  const { a, three, four, five, exact } = fixture();
  const key = aidtBrainstormRoundCompletionKey(a.sessionId);
  if (fault === "missing-round") delete four.content.draft.fields[key];
  if (fault === "broken-round") four.content.draft.fields[key] = "{broken";
  if (fault === "foreign-round-project") four.content.draft.fields[key] = JSON.stringify({ ...JSON.parse(four.content.draft.fields[key]!), projectId: "foreign-project" });
  if (fault === "foreign-stage-project") four.projectId = "foreign-project";
  if (fault === "wrong-version") four.revision = 13;
  if (fault === "wrong-hmw-text" || fault === "unconfirmed-hmw") {
    const hmw = JSON.parse(three.content.draft.fields["definitionHmw:hmw-a"]!);
    three.content.draft.fields["definitionHmw:hmw-a"] = JSON.stringify({ ...hmw, ...(fault === "wrong-hmw-text" ? { text: "另一道未绑定问题" } : { confirmed: false }) });
  }
  const refs = await entityLineage(five, "qa-design", exact, undefined, { orgId: "qa-org" });
  const encoded = JSON.stringify(refs);
  expect(encoded).not.toMatch(/a 比较卡|b 比较卡|全局新草稿标题|编辑中的全局文字/);
  if (!["foreign-stage-project", "wrong-version"].includes(fault)) expect(encoded).toContain("missing");
});

it("propagates an unavailable exact revision instead of reading a newer one", async () => {
  const { five } = fixture();
  const exact = vi.fn(async () => { throw new Error("SOURCE_REVISION_UNAVAILABLE"); });
  await expect(entityLineage(five, "qa-design", exact)).rejects.toThrow("SOURCE_REVISION_UNAVAILABLE");
  expect(exact).toHaveBeenCalledOnce(); expect(exact).toHaveBeenCalledWith(4, 12);
});

it("keeps S5 auto-context metadata-only and includes the confirmed round identity without copying private text", () => {
  const { a } = fixture();
  const selection = JSON.stringify({ revision: 12, brainstormId: a.sessionId, ideaIds: a.ids });
  const lineage = JSON.stringify({ schemaVersion: 1, projectId, stage4Revision: 12, brainstormId: a.sessionId, ideas: a.ids.map(ideaId => ({ ideaId, references: [{ stageId: 4, revision: 12, entityId: ideaId, role: "idea" }], missing: ["不应自动注入的私密补充"] })) });
  const text = editAidtPrototypeText({ ...empty(), fields: { prototypeIdeaSource: selection, prototypeTextLineage: lineage } }, "需要再次授权的私密访谈正文", "text-v2");
  const confirmed = confirmAidtPrototypeText(text, projectId, "qa-design", 19)!;
  const document = updateAidtPrototypeEntityDraft(updateAidtPrototypeEntityDraft(empty(), "qa-design", () => text), "qa-design", () => confirmed);
  const context = aidtSavedEntityContext(make(5, 20, document), "qa-design", false, { orgId: "qa-org" });
  const encoded = JSON.stringify(context);
  expect(encoded).toContain(a.sessionId); expect(encoded).toContain("student-confirmed-current-text");
  expect(encoded).not.toMatch(/需要再次授权的私密访谈正文|不应自动注入的私密补充/);
  expect(encoded).toContain("未重核原件许可");
});

it("retains prototype instruction output that distinguishes formal frozen sources from global drafts and unverified imagery", () => {
  const instructions = aidtEntityArtifactInstructions("aidt-prototype");
  expect(instructions).toContain("brainstormId"); expect(instructions).toContain("固定版本中的正式描述单");
  expect(instructions).toContain("未加载图片时不描述其内容"); expect(instructions).toContain("不以当前全局点子草稿");
});
