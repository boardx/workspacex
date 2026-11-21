import { expect, it } from "vitest";
import { readAidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { addAidtBrainstormCandidates, confirmAidtBrainstormSelection, createAidtBrainstorm, readAidtBrainstormProposals, readAidtBrainstormSelection } from "@/features/aidt/lib/aidt-brainstorm";
import { archiveAidtIdea, readAidtIdeaHandoff } from "@/features/aidt/lib/aidt-idea-handoff";
import { aidtChosenPrototypeIdeas } from "@/features/aidt/lib/aidt-prototype-handoff";
import { aidtReportSourceLinks } from "@/features/aidt/lib/aidt-report-source-links";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";

const id = "brainstorm-one";
const source = { id: "hmw-two", text: "如何帮助学生快速比较食品？", revision: 4 };
const empty: AidtUiStageDraft = { fields: {}, ideas: [], selectedIdeaId: "" };
const feedback = "用纸卡列出每道菜的配料。学生可以在排队前比较。";
const ideas = ["菜单卡", "入口牌", "颜色表", "纸质清单", "自取卡片"].map(title => ({ title, description: feedback }));
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

it("deduplicates five candidates across retries and feeds only the two saved selections to stage five", () => {
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
  expect(readAidtIdeaHandoff(saved, "p")?.hmw).toEqual(source);
  const stage = { projectId: "p", stageId: 4, revision: 9, content: { schemaVersion: 1, draft: saved } } as AidtSharedStage;
  expect(aidtChosenPrototypeIdeas(stage).map(idea => idea.title)).toEqual(["纸质清单", "菜单卡"]);
  expect(aidtReportSourceLinks(stage)).toContainEqual({ id, title: "头脑风暴 · 逆向思考", href: "/aidt/p?step=4&entity=brainstorm-one&entityRevision=9" });
  expect(readAidtBrainstormSelection(archiveAidtIdea(saved, chosen[0]!))).toBeNull();
});

it("keeps distinct method sessions separate and rejects duplicate normalized candidate names", () => {
  const another = "brainstorm-two";
  let draft = createAidtBrainstorm(empty, { id, source, method: "free", count: 5, candidates: [] });
  draft = createAidtBrainstorm(draft, { id: another, source: { ...source, id: "hmw-three" }, method: "scamper", count: 5, candidates: [] });
  const duplicates = [{ messageId: "first", items: [ideas[0]!, { ...ideas[0]!, title: "菜 单 卡！" }] }];
  draft = addAidtBrainstormCandidates(draft, id, duplicates);
  draft = addAidtBrainstormCandidates(draft, another, duplicates);
  expect(draft.ideas).toHaveLength(2);
  expect(readAidtBrainstorm(draft.fields, id)?.candidates).not.toEqual(readAidtBrainstorm(draft.fields, another)?.candidates);
});
