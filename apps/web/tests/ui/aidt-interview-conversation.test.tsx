import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AidtInterviewConversation } from "@/features/aidt/components/aidt-interview-conversation";
import { AidtChatEmptyState } from "@/features/aidt/components/aidt-chat-empty-state";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { AidtInterviewOutput } from "@/features/aidt/components/aidt-interview-output";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
import { writeAidtInterview, writeAidtInterviewFinding, readAidtInterviews, aidtInterviewMaterialKey, setAidtInterviewPhoto, type AidtInterview } from "@/features/aidt/lib/aidt-interviews";

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

it("illustrates only the authorized own-interview photo and uses a checked quote as the headline", () => {
  const consent = { notes: true, photos: true, audio: false, observedAt: "2026-11-20T04:12:00Z" };
  const owner = { ...interview, consent };
  const sibling = { ...owner, id: "15c7b5e2-9d0e-4b10-bc47-000000000002", code: "U02" };
  const initial = writeAidtInterview(writeAidtInterview(emptyAidtUiDrafts()[2]!, owner), sibling);
  const result = writeAidtInterviewFinding(initial, owner, {
    headline: "先看菜单对比", headlineKind: "student-summary", quote: "我会先看口味",
    context: "午休在菜单前比较两种口味。",
  });
  const common = { projectId: "qa", runId: "run", versionId: "v1", sha256: "a".repeat(64), bytes: 42 };
  const source = aidtInterviewMaterialKey(owner.id, "transcript");
  const photo = aidtInterviewMaterialKey(owner.id, "photo");
  const otherPhoto = aidtInterviewMaterialKey(sibling.id, "photo");
  result.fields[source] = JSON.stringify({ ...common, artifactId: "source-u01", name: "U01原件.txt", mime: "text/plain" });
  result.fields[photo] = JSON.stringify({ ...common, artifactId: "photo-u01", name: "U01现场.png", mime: "image/png" });
  result.fields[otherPhoto] = JSON.stringify({ ...common, artifactId: "photo-u02", name: "U02现场.png", mime: "image/png" });
  result.fields["interviewTranscript:" + owner.id] = JSON.stringify({ sourceKey: source, checked: true, locator: "01:42", text: "我会先看口味" });
  expect(setAidtInterviewPhoto(result, owner.id, otherPhoto, "qa")).toBe(result);
  const illustrated = setAidtInterviewPhoto(result, owner.id, photo, "qa");
  const view = render(<AidtInterviewOutput projectId="qa" entityId={owner.id} draft={illustrated} />);
  expect(screen.getByText("U01现场.png")).toBeVisible();
  expect(screen.queryByText("U02现场.png")).toBeNull();
  expect(screen.getByText("“我会先看口味”")).toBeVisible();
  expect(screen.getByText("午休在菜单前比较两种口味。")).toBeVisible();

  const unchecked = { ...illustrated, fields: { ...illustrated.fields, ["interviewTranscript:" + owner.id]:
    JSON.stringify({ sourceKey: source, checked: false, locator: "01:42", text: "我会先看口味" }) } };
  view.rerender(<AidtInterviewOutput projectId="qa" entityId={owner.id} draft={unchecked} photoAllowed={false} />);
  expect(screen.queryByText("U01现场.png")).toBeNull();
  expect(screen.getByText("暂无授权照片。")).toBeVisible();
  expect(screen.queryByText("“我会先看口味”")).toBeNull();
  expect(screen.getByText("学生概括")).toBeVisible();
  expect(screen.getByText("先看菜单对比")).toBeVisible();

  const revoked = writeAidtInterview(illustrated, { ...owner, consent: { ...consent, photos: false } });
  expect(setAidtInterviewPhoto(revoked, owner.id, photo, "qa")).toBe(revoked);
});
