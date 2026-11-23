import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { readAidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { AidtBrainstormConversation } from "@/features/aidt/components/aidt-brainstorm";
import { addAidtBrainstormCandidates, confirmAidtBrainstormSelection, createAidtBrainstorm, readAidtBrainstormProposals, readAidtBrainstormSelection } from "@/features/aidt/lib/aidt-brainstorm";
import { confirmAidtIdeaFromChat } from "@/features/aidt/lib/aidt-idea-chat";
import { readAidtIdeaHandoff } from "@/features/aidt/lib/aidt-idea-handoff";
import { readAidtIdeaClassification } from "@/features/aidt/lib/aidt-idea-classification";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

const sessionId = "brainstorm-ui-review";
let latest: AidtUiStageDraft;
let saves = 0;
const titles = ["菜单标签", "排队指示", "配料卡", "轮值助手", "预约清单"];
function fixture(withSheets = false) {
  const session = { id: sessionId, source: { id: "hmw-1", revision: 1, text: "怎样帮助学生比较菜单？" }, method: "reverse" as const, count: 5, candidates: [] };
  let draft = createAidtBrainstorm({ fields: {}, ideas: [], selectedIdeaId: "" }, session);
  const content = '```aidt-ideas\n' + JSON.stringify({ sessionId, candidates: titles.map(title => ({ title, description: `提供${title}。由学生自行比较。` })) }) + '\n```';
  draft = addAidtBrainstormCandidates(draft, sessionId, readAidtBrainstormProposals([
    { id: "student", role: "user", content: "我想到可以用纸卡表示菜单，想继续探索。" }, { id: "ai", role: "assistant", content },
  ], sessionId));
  if (!withSheets) return draft;
  draft = confirmAidtBrainstormSelection(draft, sessionId, draft.ideas.slice(0, 2).map(idea => idea.id));
  for (const idea of draft.ideas.slice(0, 3)) {
    draft = { ...draft, fields: { ...draft.fields, ["ideaFile:" + idea.id]: JSON.stringify({ projectId: "p", runId: "r", artifactId: idea.id, versionId: "v1", name: "图.png", mime: "image/png", sha256: "a".repeat(64), bytes: 1 }) } };
    draft = confirmAidtIdeaFromChat(draft, idea.id, idea.description);
  }
  return draft;
}
function Harness({ initial }: { initial: AidtUiStageDraft }) {
  const [draft, setDraft] = React.useState(initial); latest = draft;
  const save = async (change: (old: AidtUiStageDraft) => AidtUiStageDraft) => { saves++; setDraft(change); return true; };
  return <AidtBrainstormConversation projectId="p" session={readAidtBrainstorm(draft.fields, sessionId)!} draft={draft}
    messages={[]} loading={false} running={false} readOnly={false} saveDraft={save} nextHref="/aidt/p?step=5" />;
}
afterEach(() => { cleanup(); saves = 0; });

it("saves two of five text candidates as a shortlist without requiring pictures or completing the stage", async () => {
  render(<Harness initial={fixture()} />);
  fireEvent.click(screen.getByText("筛选点子 · 已选 0"));
  const selection = within(screen.getByRole("region", { name: "筛选点子" }));
  fireEvent.click(selection.getByRole("checkbox", { name: /菜单标签/ }));
  fireEvent.click(selection.getByRole("checkbox", { name: /排队指示/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认入选点子" }));
  await waitFor(() => expect(readAidtBrainstormSelection(latest)?.selectedIds).toHaveLength(2));
  expect(latest.ideas).toHaveLength(5);
  expect(readAidtIdeaHandoff(latest, "p")).toBeNull();
  expect(screen.queryByRole("link", { name: "使用已确认轮进入原型制作" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "确认完成本阶段" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请审阅至少三份描述单");
  expect(saves).toBe(1);
});

it("reviews three sheets and student classification explicitly without making the other two drafts complete", async () => {
  render(<Harness initial={fixture(true)} />);
  const completion = within(screen.getByRole("region", { name: "完成描述单与分类" }));
  for (const title of titles.slice(0, 3)) fireEvent.click(completion.getByRole("checkbox", { name: "已审阅描述单：" + title }));
  expect(completion.getByRole("checkbox", { name: "已审阅描述单：轮值助手" })).toBeDisabled();
  fireEvent.click(completion.getByRole("button", { name: "确认完成本阶段" }));
  expect(completion.getByRole("alert")).toHaveTextContent("请完成并确认点子分类");
  fireEvent.click(completion.getByRole("checkbox", { name: "菜单标签 · 最容易实现的" }));
  fireEvent.click(completion.getByRole("checkbox", { name: "菜单标签 · 最有趣的" }));
  fireEvent.change(completion.getByRole("textbox", { name: "菜单标签 · 分类理由" }), { target: { value: "纸卡成本低，也可尝试不同表达。" } });
  expect(saves).toBe(0);
  expect(completion.getByRole("textbox", { name: "菜单标签 · 分类理由" })).toBeEnabled();
  fireEvent.click(completion.getByRole("button", { name: "确认本组分类" }));
  await waitFor(() => expect(readAidtIdeaClassification(latest).confirmed).toBe(true));
  expect(readAidtIdeaHandoff(latest, "p")).toBeNull();
  fireEvent.click(completion.getByRole("button", { name: "确认完成本阶段" }));
  await waitFor(() => expect(readAidtIdeaHandoff(latest, "p")?.sheetIds).toHaveLength(3));
  expect(readAidtIdeaHandoff(latest, "p")?.selectedIds).toHaveLength(2);
  expect(screen.getByRole("link", { name: "使用已确认轮进入原型制作" })).toBeVisible();
  expect(latest.ideas).toHaveLength(5);
  expect(latest.fields["ideaChatConfirmation:" + latest.ideas[3]!.id]).toBeUndefined();
  fireEvent.change(completion.getByRole("textbox", { name: "菜单标签 · 分类理由" }), { target: { value: "改后重新核对。" } });
  expect(screen.getByRole("link", { name: "使用已确认轮进入原型制作" })).toBeVisible();
});
