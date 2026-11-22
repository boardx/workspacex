import { expect, it } from "vitest";
import { readAidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { addAidtBrainstormCandidates, confirmAidtBrainstormCompletion, confirmAidtBrainstormSelection, createAidtBrainstorm, readAidtBrainstormProposals, readAidtBrainstormSelection } from "@/features/aidt/lib/aidt-brainstorm";
import { archiveAidtIdea, readAidtIdeaHandoff } from "@/features/aidt/lib/aidt-idea-handoff";
import { aidtChosenPrototypeIdeas, pinAidtPrototypeInputs, resolveAidtPrototypeInputIdeas } from "@/features/aidt/lib/aidt-prototype-handoff";
import { aidtReportSourceLinks } from "@/features/aidt/lib/aidt-report-source-links";
import { confirmAidtIdeaFromChat } from "@/features/aidt/lib/aidt-idea-chat";
import { confirmAidtIdeaClassification, setAidtIdeaCategory } from "@/features/aidt/lib/aidt-idea-classification";
import { aidtStageHasConfirmation } from "@/features/aidt/lib/use-aidt-confirmed-stages";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";

const id = "brainstorm-one";
const source = { id: "hmw-two", text: "如何帮助学生快速比较食品？", revision: 4 };
const empty: AidtUiStageDraft = { fields: {}, ideas: [], selectedIdeaId: "" };
const ideas = [
  { title: "菜单卡", description: "用纸卡列出每道菜的配料。学生先比较配料。" },
  { title: "入口牌", description: "入口牌展示预计等待。学生决定是否排队。" },
  { title: "颜色表", description: "把食品按口味标记。用颜色辨别类别。" },
  { title: "纸质清单", description: "打印一张领取顺序表。学生记录领取的时间。" },
  { title: "自取卡片", description: "自取盒里放预约卡。学生自行选择预约时段。" },
];
const fence = String.fromCharCode(96).repeat(3);
const response = (sessionId = id) => ({
  id: "assistant-run-a", role: "assistant", content: fence + "aidt-ideas\n" + JSON.stringify({ sessionId, candidates: ideas }) + "\n" + fence,
});
const student = { id: "student-start", role: "user", content: "我觉得可以在菜单旁设置不同的纸卡，帮我用逆向思考探索。" };

it("only reads bounded current-session drafts after a real student contribution", () => {
  expect(readAidtBrainstormProposals([{ ...student, content: "你好！" }, response()], id)).toEqual([]);
  expect(readAidtBrainstormProposals([student, response("brainstorm-other")], id)).toEqual([]);
  expect(readAidtBrainstormProposals([student, response()], id)).toEqual([{ messageId: "assistant-run-a", items: ideas }]);
});

it("deduplicates five candidates and saves two text selections without completing stage four", async () => {
  const created = createAidtBrainstorm(empty, { id, source, method: "reverse", count: 5, candidates: [] });
  const proposals = readAidtBrainstormProposals([student, response()], id);
  const added = addAidtBrainstormCandidates(created, id, proposals);
  expect(addAidtBrainstormCandidates(added, id, [...proposals, ...proposals])).toBe(added);
  expect(readAidtBrainstorm(added.fields, id)).toMatchObject({ source, method: "reverse" });
  expect(added.ideas.map(idea => idea.title)).toEqual(ideas.map(idea => idea.title));
  expect(readAidtIdeaHandoff(added, "p")).toBeNull();
  const chosen = [added.ideas[3]!.id, added.ideas[0]!.id];
  expect(confirmAidtBrainstormSelection(added, id, [chosen[0]!, "sibling-candidate"])).toBe(added);
  const saved = JSON.parse(JSON.stringify(confirmAidtBrainstormSelection(added, id, chosen))) as AidtUiStageDraft;
  expect(saved.ideas).toHaveLength(5);
  expect(readAidtBrainstormSelection(saved)?.selectedIds).toEqual(chosen);
  expect(readAidtIdeaHandoff(saved, "p")).toBeNull();
  const stage = { projectId: "p", stageId: 4, revision: 9, content: { schemaVersion: 1, draft: saved } } as AidtSharedStage;
  expect(await aidtStageHasConfirmation(stage)).toBe(false);
  expect(aidtChosenPrototypeIdeas(stage)).toEqual([]);
  expect(aidtReportSourceLinks(stage)).toContainEqual({ id, title: "头脑风暴 · 逆向思考", href: "/aidt/p?step=4&entity=brainstorm-one&entityRevision=9" });
  expect(readAidtBrainstormSelection(archiveAidtIdea(saved, chosen[0]!))).toBeNull();
});

function selectedFixture() {
  const created = createAidtBrainstorm(empty, { id, source, method: "reverse", count: 5, candidates: [] });
  const added = addAidtBrainstormCandidates(created, id, readAidtBrainstormProposals([student, response()], id));
  return confirmAidtBrainstormSelection(added, id, added.ideas.slice(0, 2).map(idea => idea.id));
}
function reviewedFixture(): AidtUiStageDraft {
  let draft = selectedFixture();
  const reviewedIds = draft.ideas.slice(0, 3).map(idea => idea.id);
  for (const ideaId of reviewedIds) {
    draft = { ...draft, fields: { ...draft.fields, ["ideaFile:" + ideaId]: JSON.stringify({
      projectId: "p", runId: "run", artifactId: "image-" + ideaId, versionId: "v1", name: "图.png",
      mime: "image/png", sha256: "a".repeat(64), bytes: 1,
    }) } };
    draft = confirmAidtIdeaFromChat(draft, ideaId, draft.ideas.find(idea => idea.id === ideaId)!.description);
  }
  draft = confirmAidtBrainstormSelection(draft, id, draft.ideas.slice(0, 2).map(idea => idea.id));
  draft = confirmAidtIdeaClassification(draft);
  // Existing field written by the explicit student description-sheet review action.
  return { ...draft, fields: { ...draft.fields, ideaSheetIds: JSON.stringify(reviewedIds) } };
}
const stageOf = (draft: AidtUiStageDraft): AidtSharedStage => ({ projectId: "p", stageId: 4, revision: 9, sourceStageRevisions: [], content: { schemaVersion: 1, draft: StageDraft.parse(draft) }, updatedBy: "student", updatedAt: "2026-11-22T00:00:00Z" });

it("completes three reviewed image sheets while retaining two unreviewed candidates and selecting only two prototypes", async () => {
  const draft = reviewedFixture();
  expect(draft.ideas).toHaveLength(5);
  expect(readAidtBrainstormSelection(draft)?.selectedIds).toHaveLength(2);
  expect(readAidtIdeaHandoff(draft, "p")).toMatchObject({ hmw: source, sheetIds: draft.ideas.slice(0, 3).map(idea => idea.id) });
  expect(await aidtStageHasConfirmation(stageOf(draft))).toBe(true);
  expect(aidtChosenPrototypeIdeas(stageOf(draft)).map(idea => idea.title)).toEqual(["菜单卡", "入口牌"]);
});

it.each(["two-sheets", "duplicate-id", "no-image", "unreviewed", "one-sentence", "duplicate-name", "unconfirmed-classification", "archived-session"])("rejects incomplete brainstorm completion: %s", async change => {
  let draft = reviewedFixture();
  const ids = draft.ideas.slice(0, 3).map(idea => idea.id);
  const fields = { ...draft.fields };
  if (change === "two-sheets") fields.ideaSheetIds = JSON.stringify(ids.slice(0, 2));
  if (change === "duplicate-id") fields.ideaSheetIds = JSON.stringify([ids[0], ids[0], ids[1]]);
  if (change === "no-image") delete fields["ideaFile:" + ids[2]];
  if (change === "unreviewed") delete fields["ideaChatConfirmation:" + ids[2]];
  if (change === "unconfirmed-classification") fields.ideaClassificationConfirmed = "";
  if (change === "archived-session") fields["ideaBrainstorm:" + id] = JSON.stringify({ ...readAidtBrainstorm(fields, id), archived: true });
  draft = { ...draft, fields };
  if (change === "one-sentence") draft = { ...draft, ideas: draft.ideas.map(idea => idea.id === ids[2] ? { ...idea, description: "只写了一句话。" } : idea) };
  if (change === "duplicate-name") draft = { ...draft, ideas: draft.ideas.map(idea => idea.id === ids[2] ? { ...idea, title: draft.ideas[0]!.title } : idea) };
  expect(readAidtIdeaHandoff(draft, "p")).toBeNull();
  expect(await aidtStageHasConfirmation(stageOf(draft))).toBe(false);
  expect(aidtChosenPrototypeIdeas(stageOf(draft))).toEqual([]);
});

it("requires explicit completion review after selecting a single prototype from three reviewed sheets", async () => {
  const complete = reviewedFixture();
  const sheets: string[] = JSON.parse(complete.fields.ideaSheetIds!);
  const chosen = confirmAidtBrainstormSelection(complete, id, [complete.ideas[0]!.id]);
  expect(readAidtBrainstormSelection(chosen)?.selectedIds).toHaveLength(1);
  expect(await aidtStageHasConfirmation(stageOf(chosen))).toBe(false);
  expect(confirmAidtBrainstormCompletion(chosen, "brainstorm-other", sheets, "p")).toBe(chosen);
  const confirmed = confirmAidtBrainstormCompletion(chosen, id, sheets, "p");
  expect(await aidtStageHasConfirmation(stageOf(confirmed))).toBe(true);
  expect(aidtChosenPrototypeIdeas(stageOf(confirmed))).toHaveLength(1);
});

it("invalidates completion after editing image, description, classification or selected subset without deleting old drafts", async () => {
  const old = reviewedFixture();
  const first = old.ideas[0]!;
  const changedImage = { ...old, fields: { ...old.fields, ["ideaFile:" + first.id]: old.fields["ideaFile:" + first.id]!.replace('"v1"', '"v2"') } };
  const changedDescription = { ...old, ideas: old.ideas.map(idea => idea.id === first.id ? { ...idea, description: "改变了方案。需要重新审阅。" } : idea) };
  const changedClassification = setAidtIdeaCategory(old, first.id, "fun", true);
  const changedSelection = confirmAidtBrainstormSelection(old, id, [first.id]);
  for (const changed of [changedImage, changedDescription, changedClassification, changedSelection]) {
    expect(readAidtIdeaHandoff(changed, "p")).toBeNull();
    expect(await aidtStageHasConfirmation(stageOf(changed))).toBe(false);
    expect(aidtChosenPrototypeIdeas(stageOf(changed))).toEqual([]);
    expect(changed.ideas).toHaveLength(5);
  }
  expect(readAidtIdeaHandoff(old, "p")).not.toBeNull();
});

it.each(["brainstorm", "legacy"])("keeps old incomplete %s selections readable for an already pinned prototype without admitting a new one", async format => {
  let draft = selectedFixture();
  if (format === "legacy") draft = { ...draft, fields: Object.fromEntries(Object.entries(draft.fields).filter(([key]) => !key.startsWith("ideaBrainstorm"))) };
  const stage = stageOf(draft);
  const ids: string[] = JSON.parse(draft.fields.ideaHandoffIds!);
  const oldBytes = JSON.stringify(draft);
  expect(aidtChosenPrototypeIdeas(stage)).toEqual([]);
  expect(pinAidtPrototypeInputs(empty, stage)).toBe(empty);
  expect(resolveAidtPrototypeInputIdeas({ revision: stage.revision, ideaIds: ids }, stage).map(idea => idea.id)).toEqual(ids);
  expect(resolveAidtPrototypeInputIdeas({ revision: stage.revision + 1, ideaIds: ids }, stage)).toEqual([]);
  expect(await aidtStageHasConfirmation(stage)).toBe(false);
  expect(JSON.stringify(draft)).toBe(oldBytes);
});

it.each(["same-hmw", "different-revision", "archived-other-session"])("checks the source of description sheets across methods: %s", async change => {
  let draft = selectedFixture();
  const otherId = "brainstorm-another-method";
  draft = createAidtBrainstorm(draft, { id: otherId, source: change === "different-revision" ? { ...source, revision: source.revision + 1 } : source, method: "scamper", count: 5, candidates: [] });
  draft = addAidtBrainstormCandidates(draft, otherId, readAidtBrainstormProposals([student, response(otherId)], otherId));
  const other = readAidtBrainstorm(draft.fields, otherId)!;
  const reviewedIds = [draft.ideas[0]!.id, draft.ideas[1]!.id, other.candidates[2]!];
  for (const ideaId of reviewedIds) {
    draft = { ...draft, fields: { ...draft.fields, ["ideaFile:" + ideaId]: JSON.stringify({ projectId: "p", runId: "r", artifactId: ideaId, versionId: "v1", name: "图.png", mime: "image/png", sha256: "a".repeat(64), bytes: 1 }) } };
    draft = confirmAidtIdeaFromChat(draft, ideaId, draft.ideas.find(idea => idea.id === ideaId)!.description);
  }
  draft = confirmAidtIdeaClassification(draft);
  draft = { ...draft, fields: { ...draft.fields, ideaSheetIds: JSON.stringify(reviewedIds) } };
  if (change === "archived-other-session") draft = { ...draft, fields: { ...draft.fields, ["ideaBrainstorm:" + otherId]: JSON.stringify({ ...other, archived: true }) } };
  expect(Boolean(readAidtIdeaHandoff(draft, "p"))).toBe(change === "same-hmw");
  expect(await aidtStageHasConfirmation(stageOf(draft))).toBe(change === "same-hmw");
});

it("keeps distinct method sessions separate and rejects duplicate normalized candidate names", () => {
  const another = "brainstorm-two";
  let draft = createAidtBrainstorm(empty, { id, source, method: "free", count: 5, candidates: [] });
  draft = createAidtBrainstorm(draft, { id: another, source: { ...source, id: "hmw-three" }, method: "scamper", count: 5, candidates: [] });
  const duplicates = [{ messageId: "first", items: [ideas[0]!, { ...ideas[0]!, title: "菜 单 卡！" }, { ...ideas[0]!, title: "重复内容" }] }];
  draft = addAidtBrainstormCandidates(draft, id, duplicates);
  draft = addAidtBrainstormCandidates(draft, another, duplicates);
  expect(draft.ideas).toHaveLength(2);
  expect(readAidtBrainstorm(draft.fields, id)?.candidates).not.toEqual(readAidtBrainstorm(draft.fields, another)?.candidates);
});
