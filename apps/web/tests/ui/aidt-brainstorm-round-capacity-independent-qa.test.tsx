import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtBrainstormConversation } from "@/features/aidt/components/aidt-brainstorm";
import type { AidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
vi.mock("@/features/aidt/components/aidt-brainstorm-candidates", () => ({ AidtBrainstormCandidates: () => null }));
afterEach(cleanup);

it("does not claim a saved shortlist when the actual capacity-bounded mutation is a no-op, even if the transport returns true", async () => {
  const session: AidtBrainstorm = { id: "brainstorm-capacity", source: { id: "hmw-capacity", text: "如何帮助学生比较口味？", revision: 4 }, method: "scamper", count: 3, candidates: ["qa-idea-a", "qa-idea-b", "qa-idea-c"] };
  const fields: Record<string, string> = { [`ideaBrainstorm:${session.id}`]: JSON.stringify(session) };
  for (let n = 0; Object.keys(fields).length < 100; n++) fields[`qa-filler-${n}`] = "synthetic capacity fixture";
  const draft: AidtUiStageDraft = StageDraft.parse({ fields, ideas: session.candidates.map((id, index) => ({ id, title: `合成点子${index + 1}`, description: "用纸卡说明一个选择。学生自己决定是否采用。" })), selectedIdeaId: "" });
  const saveDraft = vi.fn(async (mutate: (old: AidtUiStageDraft) => AidtUiStageDraft) => {
    expect(mutate(draft)).toBe(draft); return true;
  });
  render(<AidtBrainstormConversation projectId="qa-project" session={session} draft={draft} messages={[]} loading={false} running={false} readOnly={false} saveDraft={saveDraft} nextHref="/aidt/qa-project?step=5" />);
  fireEvent.click(screen.getByText("筛选点子 · 已选 0"));
  fireEvent.click(screen.getByRole("checkbox", { name: /合成点子1/ }));
  fireEvent.click(screen.getByRole("button", { name: "确认入选点子" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("保存未完成"));
  expect(saveDraft).toHaveBeenCalledOnce();
  expect(screen.getByRole("checkbox", { name: /合成点子1/ })).toBeChecked();
  expect(screen.queryByLabelText("本轮已确认结果")).toBeNull();
  expect(screen.queryByRole("link", { name: /进入原型制作/ })).toBeNull();
  expect(Object.keys(draft.fields)).toHaveLength(100);
});
