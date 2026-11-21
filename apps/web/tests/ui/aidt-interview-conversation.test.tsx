import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AidtInterviewConversation } from "@/features/aidt/components/aidt-interview-conversation";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { AidtInterviewOutput } from "@/features/aidt/components/aidt-interview-output";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { writeAidtInterview, readAidtInterviews, aidtInterviewMaterialKey, type AidtInterview } from "@/features/aidt/lib/aidt-interviews";

const interview: AidtInterview = { id: "15c7b5e2-9d0e-4b10-bc47-000000000001", version: 1, code: "U01", original: "", adopted: "", guideConfirmed: false, consent: null, topicRevision: 1, topic: "午休", goal: "" };
const messages = [{ id: "1", role: "user", content: "你喜欢新品吗？" }, { id: "2", role: "assistant", content: "可以用具体经历来问。\n### 访谈问题清单（草稿）\n- 上次是怎样选择的？\n- 有哪些信息？" }];

it("uses a short entity starter and the shell's only composer", () => {
  render(<AidtChatEmptyState step={AIDT_STEPS[1]} interviewPhase="initial" />);
  expect(screen.getByText(/你准备问这位受访者哪些问题/)).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText("先说说你们的想法")).toBeNull();
});

it("projects one settled entity draft, then lets the student select, edit and confirm inside chat", () => {
  const initial = writeAidtInterview(emptyAidtUiDrafts()[2]!, interview);
  const refresh = vi.fn();
  function Host({ running }: { running: boolean }) {
    const [draft, update] = React.useState(() => running ? initial : writeAidtInterview(initial, { ...interview, original: messages[0]!.content, adopted: "上次是怎样选择的？\n有哪些信息？" }));
    return <><AidtInterviewConversation projectId="qa" interview={readAidtInterviews(draft.fields)[0]!} draft={draft} messages={messages} running={running} loading={false} update={update} onSettled={refresh} />
      <AidtInterviewOutput projectId="qa" entityId={interview.id} draft={draft} /></>;
  }
  const view = render(<Host running />);
  const output = () => within(screen.getByTestId("aidt-interview-output"));
  expect(output().queryByRole("textbox")).toBeNull();
  expect(output().getByText("尚无问题清单。")).toBeVisible();
  expect(refresh).not.toHaveBeenCalled();
  view.rerender(<Host key="server-readback" running={false} />);
  expect(refresh).toHaveBeenCalledWith("2");
  expect(output().getByText("有哪些信息？")).toBeVisible();
  const controls = within(screen.getByTestId("aidt-interview-chat-actions"));
  fireEvent.click(controls.getAllByRole("checkbox")[1]!);
  fireEvent.click(controls.getAllByRole("button", { name: "编辑这道问题" })[0]!);
  fireEvent.change(controls.getByRole("textbox", { name: "修改问题" }), { target: { value: "最近一次你看菜单时做了什么？" } });
  fireEvent.click(controls.getByRole("button", { name: "确认这份问题清单" }));
  expect(output().getByText("最近一次你看菜单时做了什么？")).toBeVisible();
  expect(output().queryByText("有哪些信息？")).toBeNull();
  expect(output().getByText("学生已确认")).toBeVisible();
  expect(output().queryByRole("textbox")).toBeNull();
  expect(output().queryByRole("checkbox")).toBeNull();
});

vi.mock("@/features/aidt/components/aidt-research-material", () => ({
  AidtResearchMaterialControl: () => null,
  AidtResearchMaterialPreview: ({ reference }: { reference: { name: string } }) => <span>{reference.name}</span>,
}));

it("resolves only the cited interview's original file from its frozen revision", () => {
  const draft = writeAidtInterview(emptyAidtUiDrafts()[2]!, { ...interview, consent: { notes: true, photos: false, audio: false, observedAt: "2026-11-20T04:12:00Z" } });
  const sourceKey = aidtInterviewMaterialKey(interview.id, "raw-transcript");
  draft.fields[sourceKey] = JSON.stringify({ projectId: "qa", runId: "run", artifactId: "source-u01", versionId: "v1", name: "U01原件.txt", mime: "text/plain", sha256: "a".repeat(64), bytes: 42 });
  draft.fields["interviewTranscript:" + interview.id] = JSON.stringify({ sourceKey, checked: true, locator: "01:42", text: "先看菜单" });
  const output = (sourceId?: string) => <AidtInterviewOutput projectId="qa" entityId={interview.id} draft={draft} frozenSourceId={sourceId} />;
  const view = render(output());
  expect(screen.queryByText("U01原件.txt")).toBeNull();
  view.rerender(output("source-u01"));
  expect(screen.getByText("U01原件.txt")).toBeVisible();
  view.rerender(output("source-u02"));
  expect(screen.queryByText("U01原件.txt")).toBeNull();
  expect(screen.getByRole("alert")).toHaveTextContent("无法查看该原件");
});
