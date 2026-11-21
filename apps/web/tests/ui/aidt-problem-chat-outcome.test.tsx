import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AidtProblemWorkspace } from "@/features/aidt/components/aidt-problem-workspace";
import { AidtProblemChatReview } from "@/features/aidt/components/aidt-problem-chat-review";
import { addAidtProblem, readAidtProblemEntityDraft, updateAidtProblemEntity } from "@/features/aidt/lib/aidt-problem-entities";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { saveAidtStage, type AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";

vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ saveAidtStage: vi.fn(), reconcileAidtEntity: vi.fn().mockResolvedValue({ updated: false }) }));
const entity = "acbda8a8-9fd3-41eb-b2fe-d68ea51f8100";
const other = "acbda8a8-9fd3-41eb-b2fe-d68ea51f8101";
const formed = { initial: "为什么学生离开队伍？", whyWorthStudying: "影响午休", problemSources: '["observation"]',
  sourceDetails: "我们看到两人离开", sourceUncertainty: "离开的原因", rewrittenTheme: "午休时如何决定排队？", known: "两位学生离开", nextAction: "询问离队时的经历" };
function stage(): AidtSharedStage {
  const empty = emptyAidtUiDrafts()[1]!;
  const directory = addAidtProblem(addAidtProblem(empty, entity, "午休"), other, "其他研究");
  const draft = updateAidtProblemEntity(directory, entity, () => ({ ...empty, fields: formed }));
  return { projectId: "p1", stageId: 1, revision: 5, sourceStageRevisions: [], content: { schemaVersion: 1, draft } } as AidtSharedStage;
}
const props = { projectId: "p1", entityId: entity, stage: stage(), sessionToken: "qa", threadId: "thr_a", loading: false, running: false, messages: [], onRefresh: vi.fn() };
beforeEach(() => vi.clearAllMocks());

it("presents only formed results in Output and keeps chat input and operations out of the inspector", () => {
  const result = readAidtProblemEntityDraft(stage().content.draft, entity);
  const { rerender } = render(<AidtProblemWorkspace draft={result} confirmed={false} revision={5} />);
  const panel = within(screen.getByRole("region", { name: "工作坊问题产物" }));
  expect(panel.getByText(formed.known)).toBeVisible();
  expect(panel.getByText(formed.nextAction)).toBeVisible();
  expect(panel.queryByRole("textbox")).toBeNull();
  expect(panel.queryByRole("button")).toBeNull();
  expect(panel.queryByRole("checkbox")).toBeNull();
  rerender(<AidtProblemWorkspace draft={readAidtProblemEntityDraft(stage().content.draft, other)} confirmed={false} revision={5} />);
  expect(panel.getByText("尚无工作坊问题草稿。")).toBeVisible();
  expect(panel.queryByText(formed.rewrittenTheme)).toBeNull();
});

it("refreshes the durable stage at each settled assistant turn, without persisting human greetings or duplicating assistant messages", () => {
  const { rerender } = render(<AidtProblemChatReview {...props} entityId={undefined} stage={undefined} messages={[{ id: "h1", role: "user", content: "你好" }]} />);
  expect(props.onRefresh).not.toHaveBeenCalled();
  const turns = [{ id: "h1", role: "user", content: "你好" }, { id: "a1", role: "assistant", content: "你们想了解什么？" }];
  rerender(<AidtProblemChatReview {...props} entityId={undefined} stage={undefined} messages={turns} running />);
  expect(props.onRefresh).not.toHaveBeenCalled();
  rerender(<AidtProblemChatReview {...props} entityId={undefined} stage={undefined} messages={turns} />);
  rerender(<AidtProblemChatReview {...props} entityId={undefined} stage={undefined} messages={[...turns]} />);
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
  expect(saveAidtStage).not.toHaveBeenCalled();
  expect(screen.queryByText("你好")).toBeNull();
});

it("confirms explicitly in Chat using the displayed revision and the selected entity without changing its neighbour", async () => {
  render(<AidtProblemChatReview {...props} />);
  expect(saveAidtStage).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "确认本轮成果并保存" }));
  await waitFor(() => expect(saveAidtStage).toHaveBeenCalledTimes(1));
  const saved = vi.mocked(saveAidtStage).mock.calls[0]![0];
  expect(saved.expectedRevision).toBe(5);
  expect(saved.content.draft.fields.problemHandoffEntity).toBe(entity);
  expect(readAidtProblemEntityDraft(saved.content.draft, entity).fields).toMatchObject({ ...formed, problemReflectionConfirmed: "true" });
  expect(readAidtProblemEntityDraft(saved.content.draft, entity).fields.roundCompletion).toBeTruthy();
  expect(readAidtProblemEntityDraft(saved.content.draft, other).fields).toEqual({});
  expect(props.onRefresh).toHaveBeenCalledTimes(2);
});
