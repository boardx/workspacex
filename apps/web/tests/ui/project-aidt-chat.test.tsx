import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidtChat } from "@/features/aidt/components/project-aidt-chat";
import type { AidtStepChat } from "@/features/aidt/lib/live-aidt-step-chat";
import { useChatHostReturnHref } from "@/lib/chat/chat-host-navigation";
import { AIDT_STEPS } from "@/lib/project-aidt";
const mocks = vi.hoisted(() => ({ enabled: true, resolve: vi.fn(), createLatest: vi.fn(), loadContext: vi.fn(), loadSharedContext: vi.fn(), loadReturnContext: vi.fn(), shell: vi.fn(), returnHref: vi.fn(), context: vi.fn(), session: { currentOrgId: "o", userId: "u", sessionToken: "token" } }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/features/aidt/lib/live-aidt-step-chat", () => ({ resolveAidtStepChat: mocks.resolve, createAidtStepChatWithLatest: mocks.createLatest, AidtStepChatChoiceError: class extends Error {} }));
vi.mock("@/features/aidt/lib/aidt-chat-saved-context", async (original) => ({ ...await original<typeof import("@/features/aidt/lib/aidt-chat-saved-context")>(), loadAidtSavedChatContext: mocks.loadContext }));
vi.mock("@/features/aidt/lib/aidt-chat-shared-context", async (original) => ({ ...await original<typeof import("@/features/aidt/lib/aidt-chat-shared-context")>(), loadAidtSharedChatContext: mocks.loadSharedContext }));
vi.mock("@/features/aidt/lib/aidt-chat-return-context", async (original) => ({ ...await original<typeof import("@/features/aidt/lib/aidt-chat-return-context")>(), loadAidtReturnChatContext: mocks.loadReturnContext }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: mocks.session }) }));
vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: mocks.context }));
vi.mock("@/components/chat/copilotkit-v2-shell", () => ({ CopilotKitV2Shell: function NativeShellStub(props: Record<string, unknown>) { mocks.shell(props); mocks.returnHref(useChatHostReturnHref(props.projectId as string)); return <div data-testid="chat-shell"><textarea aria-label="native-unsent-input" defaultValue="" /></div>; } }));
vi.mock("@/app/chat/copilotkit-v2/copilotkit-v2-providers", () => ({ CopilotKitV2Providers: ({ children }: React.PropsWithChildren) => children }));
vi.mock("@/lib/copilotkit-v2-agent-selection", () => ({ CopilotKitV2AgentSelectionProvider: ({ children }: React.PropsWithChildren) => children }));
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; mocks.session = { currentOrgId: "o", userId: "u", sessionToken: "token" }; mocks.loadReturnContext.mockResolvedValue({ status: "ready", items: [], issues: [] }); mocks.loadSharedContext.mockResolvedValue({ status: "ready", items: [], issues: [] }); mocks.loadContext.mockResolvedValue({ status: "ready", items: [], issues: [] }); window.history.replaceState(null, "", "/aidt/p?step=1"); });
it("mounts native chat only after real skill readiness and preserves stage URL", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "t1", skillName: "理解问题", versionId: "v1" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} />);
  await screen.findByTestId("chat-shell");
  expect(mocks.shell).toHaveBeenLastCalledWith(expect.objectContaining({ initialThreadId: "t1", projectId: "p", singleConversation: true }));
  expect(new URLSearchParams(window.location.search).get("thread")).toBe("t1");
  expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ value: expect.objectContaining({ skillStableName: "aidt-understand", step: 1 }) }));
});
it("shows a recoverable failure and does not offer an unconfigured composer", async () => {
  mocks.resolve.mockRejectedValueOnce(new Error("Skill unavailable"));
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Skill unavailable");
  expect(mocks.shell).not.toHaveBeenCalled();
  mocks.resolve.mockResolvedValue({ threadId: "t1", skillName: "理解问题", versionId: "v1" });
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByTestId("chat-shell");
});
it("ignores a late response from the previous stage", async () => {
  let first!: (v: AidtStepChat) => void;
  mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { first = resolve; })).mockResolvedValue({ threadId: "t2", skillName: "共情用户", versionId: "v2" });
  const { rerender } = render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} />);
  rerender(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} />);
  await screen.findByTestId("chat-shell");
  await act(async () => { first({ threadId: "t1", skillName: "理解问题", versionId: "v1" }); });
  await waitFor(() => expect(mocks.shell).toHaveBeenLastCalledWith(expect.objectContaining({ initialThreadId: "t2" })));
  expect(new URLSearchParams(window.location.search).get("step")).toBe("2");
  expect(new URLSearchParams(window.location.search).get("thread")).toBe("t2");
});

it("initializing a direct native resource URL preserves its tool and resource context", async () => {
  window.history.replaceState(null, "", "/aidt/p?step=2&tool=transcript&resource=s1");
  mocks.resolve.mockResolvedValue({ threadId: "t2", skillName: "共情", versionId: "v1" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} />);
  await screen.findByTestId("chat-shell");
  expect(new URLSearchParams(window.location.search).get("resource")).toBe("s1");
  expect(new URLSearchParams(window.location.search).get("tool")).toBe("transcript");
});


it("does not initialize providers, teaching context or native Chat when the module is disabled", () => {
  mocks.enabled = false;
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} />);
  expect(screen.getByTestId("aidt-chat-disabled")).toBeVisible();
  expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.shell).not.toHaveBeenCalled();
});
it("cancels the former group consumer and the final consumer on unmount", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "authorized", skillName: "理解", versionId: "v1" });
  const { rerender, unmount } = render(<ProjectAidtChat projectId="first-group" step={AIDT_STEPS[0]} thread={null} />);
  await screen.findByTestId("chat-shell");
  const first = mocks.resolve.mock.calls[0]![0].signal as AbortSignal;
  expect(first.aborted).toBe(false);
  rerender(<ProjectAidtChat projectId="next-group" step={AIDT_STEPS[0]} thread={null} />);
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2));
  expect(first.aborted).toBe(true);
  const current = mocks.resolve.mock.calls[1]![0].signal as AbortSignal;
  expect(current.aborted).toBe(false); unmount(); expect(current.aborted).toBe(true);
});


it("reports the actual resolved thread without sending student text or creating a second chat UI", async () => {
  const resolved = vi.fn(); mocks.resolve.mockResolvedValue({ threadId: "saved-thread", skillName: "理解", versionId: "v1" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} onResolvedThread={resolved} />);
  await screen.findByTestId("chat-shell"); expect(resolved).toHaveBeenCalledWith("saved-thread");
  expect(mocks.loadContext).not.toHaveBeenCalled();
  expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ savedContext: { status: "not-selected", items: [], issues: [] } }) }));
});
it("exposes only successful saved-source readback and leaves pinning distinct from group confirmation", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "t1", skillName: "理解", versionId: "v1" });
  const savedContext = { status: "ready", items: [{ stageNumber: 1, threadId: "t1", artifactId: "a1", title: "学生已保存主题", mode: "pinned", reviewStatus: "not-confirmed", markdown: "基于学生自己的输入" }], issues: [] };
  mocks.loadContext.mockResolvedValue(savedContext);
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} savedContextRefs={[{ stageNumber: 1, threadId: "t1", artifactId: "a1", expectedImmutableRevision: "artifact-v1:1" }]} />);
  await waitFor(() => expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ savedContext }) })));
  expect(mocks.loadContext).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", sessionToken: "token", references: [{ stageNumber: 1, threadId: "t1", artifactId: "a1", expectedImmutableRevision: "artifact-v1:1" }] }));
  expect(screen.getByTestId("aidt-chat-saved-context")).toHaveTextContent("不代表全组确认或真实证据");
});
it("never carries a previous group's late saved context into the new group's native agent", async () => {
  let finish!: (value: { status: string; items: readonly object[]; issues: readonly object[] }) => void;
  mocks.resolve.mockResolvedValue({ threadId: "current-thread", skillName: "理解", versionId: "v1" });
  mocks.loadContext.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue({ status: "ready", items: [], issues: [] });
  const reference = [{ stageNumber: 1, threadId: "t1", artifactId: "a1" }];
  const { rerender } = render(<ProjectAidtChat projectId="previous" step={AIDT_STEPS[0]} thread={null} savedContextRefs={reference} />);
  rerender(<ProjectAidtChat projectId="current" step={AIDT_STEPS[0]} thread={null} savedContextRefs={reference} />);
  await screen.findByTestId("chat-shell");
  await act(async () => { finish({ status: "ready", items: [{ markdown: "前组私有材料，不应泄漏" }], issues: [] }); });
  expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ projectId: "current", savedContext: { status: "ready", items: [], issues: [] } }) }));
  expect(JSON.stringify(mocks.context.mock.calls.at(-1))).not.toContain("前组私有材料");
});

it("uses the current callback without restarting thread initialization when only callback identity changes", async () => {
  let finish!: (value: AidtStepChat) => void;
  const first = vi.fn(), current = vi.fn();
  mocks.resolve.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} onResolvedThread={first} />);
  rerender(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} onResolvedThread={current} />);
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ threadId: "resolved-once", skillName: "理解", versionId: "v1" }); });
  await screen.findByTestId("chat-shell");
  expect(first).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledTimes(1); expect(current).toHaveBeenCalledWith("resolved-once");
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
});

it("passes authorized shared stage readback separately from explicitly disclosed private drafts", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "t2", skillName: "共情", versionId: "v1" });
  const item = { kind: "aidt-stage", projectId: "p", stageNumber: 1, revision: 4, updatedBy: "student", updatedAt: "2026-11-15T01:00:00Z", sourceStageRevisions: [], draftText: '{"fields":{"topic":"学生保存的主题"}}', truncated: false, reviewStatus: "not-confirmed", evidenceStatus: "not-verified", visibility: "group-shared" };
  const sharedStageContext = { status: "ready", items: [item], issues: [] };
  mocks.loadSharedContext.mockResolvedValue(sharedStageContext);
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} sharedContextRefs={[{ stageNumber: 1, revision: 4 }]} />);
  await waitFor(() => expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ sharedStageContext, savedContext: { status: "not-selected", items: [], issues: [] } }) })));
  expect(mocks.loadSharedContext).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", currentStage: 2, sessionToken: "token", references: [{ stageNumber: 1, revision: 4 }] }));
  expect(mocks.loadContext).not.toHaveBeenCalled();
  expect(screen.getByTestId("aidt-chat-shared-context")).toHaveTextContent("尚未保存的修改不会自动传入");
});
it("does not reactivate old shared context after selection A to B to A while new reads are pending", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "t1", skillName: "理解", versionId: "v1" });
  mocks.loadSharedContext.mockResolvedValueOnce({ status: "ready", items: [{ stageNumber: 1, revision: 1, sourceStageRevisions: [], draftText: "旧授权材料" }], issues: [] }).mockImplementation(() => new Promise(() => {}));
  const first = [{ stageNumber: 1, revision: 1 }], next = [{ stageNumber: 1, revision: 2 }];
  const { rerender } = render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} sharedContextRefs={first} />);
  await waitFor(() => expect(screen.getByTestId("aidt-chat-shared-context")).toHaveTextContent("V1"));
  rerender(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} sharedContextRefs={next} />);
  rerender(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread={null} sharedContextRefs={first} />);
  await waitFor(() => expect(mocks.loadSharedContext).toHaveBeenCalledTimes(3));
  expect(screen.getByTestId("aidt-chat-shared-context")).toHaveTextContent("读取中");
  expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ sharedStageContext: { status: "loading", items: [], issues: [] } }) }));
});
it("keeps the active native resource in the canonical Shell's subsequent thread navigation", async () => {
  window.history.replaceState(null, "", "/aidt/p?step=2&tool=transcript&resource=session-1");
  mocks.resolve.mockResolvedValue({ threadId: "t2", skillName: "共情", versionId: "v1" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} />); await screen.findByTestId("chat-shell");
  const path = mocks.shell.mock.calls.at(-1)![0].threadPath as (threadId: string | null) => string;
  const next = new URL(path("t2"), "https://workspace.invalid");
  expect(next.searchParams.get("step")).toBe("2"); expect(next.searchParams.get("thread")).toBe("t2");
  expect(next.searchParams.get("tool")).toBe("transcript"); expect(next.searchParams.get("resource")).toBe("session-1");
});
it("lets students inspect the actual saved shared text referenced by the agent", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "t2", skillName: "共情", versionId: "v1" });
  mocks.loadSharedContext.mockResolvedValue({ status: "ready", items: [{ kind: "aidt-stage", projectId: "p", stageNumber: 1, revision: 2, sourceStageRevisions: [], draftText: JSON.stringify({ schemaVersion: 1, draft: { fields: { rewrittenTheme: "学生重写并保存的主题" }, ideas: [], selectedIdeaId: "" } }), truncated: false }], issues: [] });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} sharedContextRefs={[{ stageNumber: 1, revision: 2 }]} />);
  const source = await screen.findByLabelText("第1步已保存内容摘要"); expect(source).toHaveTextContent("学生重写并保存的主题");
});

it("labels the readable summary and keeps the exact loaded report and selection fields inspectable", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "t6", skillName: "测试迭代", versionId: "v1" });
  const draftText = JSON.stringify({ schemaVersion: 1, draft: { fields: { reflection: "本组反思" }, ideas: [], selectedIdeaId: "", selectionReasons: { idea1: "学生保留的选择理由" } }, summaryReport: { markdown: "实际已保存的报告原文 <script>仅文本</script>", sourceStageRevisions: [] } });
  mocks.loadSharedContext.mockResolvedValue({ status: "ready", items: [{ kind: "aidt-stage", projectId: "p", stageNumber: 6, revision: 2, sourceStageRevisions: [], draftText, truncated: false }], issues: [] });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[5]} thread={null} sharedContextRefs={[{ stageNumber: 6, revision: 2 }]} />);
  const exact = await screen.findByLabelText("第6步AI引用的已保存文本");
  expect(exact.textContent).toBe(draftText); expect(screen.getByLabelText("第6步已保存内容摘要")).toHaveTextContent("本组反思");
  expect(screen.getByLabelText("第6步已保存内容摘要")).not.toHaveTextContent("实际已保存的报告原文");
  expect(screen.getByText("以上是已保存内容摘要，可能省略选择理由、报告等字段。AI实际参考的已保存字段见下方文本；引用材料与学生解释仍需核对。")).toBeInTheDocument();
  expect(exact.querySelector("script")).toBeNull();
});


it("preserves an old-version native chat until students explicitly prepare a new conversation", async () => {
  window.history.replaceState(null, "", "/aidt/p?step=1&returnRevision=3");
  mocks.resolve.mockResolvedValue({ threadId: "old", skillName: "理解", versionId: "old-pin", latestVersionId: "current-pin" });
  mocks.createLatest.mockResolvedValue({ threadId: "new", skillName: "理解", versionId: "current-pin", latestVersionId: "current-pin" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread="old" />);
  await screen.findByTestId("chat-shell");
  expect(mocks.createLatest).not.toHaveBeenCalled();
  const composer = screen.getByLabelText("native-unsent-input"); fireEvent.change(composer, { target: { value: "学生尚未发送的想法" } });
  expect(screen.getByTestId("aidt-skill-update")).toHaveTextContent("原消息和本页未发送输入保留");
  fireEvent.click(screen.getByRole("button", { name: "使用新版另开本步对话" }));
  const link = await screen.findByRole("link", { name: "打开新版对话（新标签页）" });
  expect(mocks.createLatest).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", thread: "old", expectedPinnedVersionId: "old-pin", expectedLatestVersionId: "current-pin", sessionToken: "token" }));
  expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("href", "/aidt/p?step=1&thread=new&returnRevision=3");
  expect(mocks.shell).toHaveBeenLastCalledWith(expect.objectContaining({ initialThreadId: "old" }));
  expect(new URLSearchParams(window.location.search).get("thread")).toBe("old");
  expect(screen.getByLabelText("native-unsent-input")).toBe(composer); expect(composer).toHaveValue("学生尚未发送的想法");
});
it("does not advertise another conversation when the current mount already matches the visible catalog", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "current", skillName: "理解", versionId: "pin", latestVersionId: "pin" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread="current" />);
  await screen.findByTestId("chat-shell"); expect(screen.queryByTestId("aidt-skill-update")).toBeNull();
  expect(mocks.createLatest).not.toHaveBeenCalled();
});
it("keeps the old native conversation available when latest-version preparation fails", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "old", skillName: "理解", versionId: "old-pin", latestVersionId: "current-pin" });
  mocks.createLatest.mockRejectedValue(new Error("SKILL_VERSION_CHANGED"));
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[0]} thread="old" />);
  await screen.findByTestId("chat-shell"); fireEvent.click(screen.getByRole("button", { name: "使用新版另开本步对话" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("SKILL_VERSION_CHANGED");
  expect(mocks.shell).toHaveBeenLastCalledWith(expect.objectContaining({ initialThreadId: "old" }));
  expect(screen.queryByRole("link", { name: "打开新版对话（新标签页）" })).toBeNull();
});
it("ignores a late upgrade response after moving to another group", async () => {
  let finish!: (value: AidtStepChat) => void;
  mocks.resolve.mockImplementation(({ projectId }: { projectId: string }) => Promise.resolve({ threadId: projectId, skillName: "理解", versionId: "old-pin", latestVersionId: "current-pin" }));
  mocks.createLatest.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { rerender } = render(<ProjectAidtChat projectId="first" step={AIDT_STEPS[0]} thread="first" />);
  await screen.findByTestId("chat-shell"); fireEvent.click(screen.getByRole("button", { name: "使用新版另开本步对话" }));
  rerender(<ProjectAidtChat projectId="second" step={AIDT_STEPS[0]} thread="second" />);
  await waitFor(() => expect(mocks.shell).toHaveBeenLastCalledWith(expect.objectContaining({ initialThreadId: "second" })));
  expect(mocks.createLatest.mock.calls[0]![0].signal.aborted).toBe(true);
  await act(async () => finish({ threadId: "foreign-upgrade", skillName: "理解", versionId: "current-pin" }));
  expect(screen.queryByRole("link", { name: "打开新版对话（新标签页）" })).toBeNull();
  expect(new URLSearchParams(window.location.search).get("thread")).toBe("second");
});

it("preserves the saved learning round after the native thread resolves and switches thread", async () => {
  window.history.replaceState(null, "", "/aidt/p?step=2&tool=context&resource=saved-material&returnRevision=3");
  mocks.resolve.mockResolvedValue({ threadId: "resolved-step-two", skillName: "共情", versionId: "v1" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} />);
  await screen.findByTestId("chat-shell");
  const current = new URL(window.location.href);
  expect(current.searchParams.get("returnRevision")).toBe("3");
  const boardReturn = new URL(mocks.returnHref.mock.calls.at(-1)![0], "https://workspace.invalid");
  expect(boardReturn.searchParams.get("returnRevision")).toBe("3");
  expect(boardReturn.searchParams.get("thread")).toBe("resolved-step-two");
  const path = mocks.shell.mock.calls.at(-1)![0].threadPath as (id: string | null) => string;
  const next = new URL(path("new-native-thread"), "https://workspace.invalid");
  expect(next.searchParams.get("returnRevision")).toBe("3");
  expect(next.searchParams.get("thread")).toBe("new-native-thread");
  expect(next.searchParams.get("resource")).toBe("saved-material");
});

it.each(["/aidt/other?step=2&returnRevision=3", "/aidt/p?step=3&returnRevision=3"])("does not carry a learning round from a foreign project or stage: %s", async (location) => {
  window.history.replaceState(null, "", location);
  mocks.resolve.mockResolvedValue({ threadId: "stage-two", skillName: "共情", versionId: "v1" });
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} />);
  await screen.findByTestId("chat-shell");
  expect(new URL(window.location.href).searchParams.has("returnRevision")).toBe(false);
  window.history.replaceState(null, "", location);
  const path = mocks.shell.mock.calls.at(-1)![0].threadPath as (id: string | null) => string;
  expect(new URL(path("new-thread"), "https://workspace.invalid").searchParams.has("returnRevision")).toBe(false);
});
it("retains the learning round on recoverable native Chat errors", async () => {
  window.history.replaceState(null, "", "/aidt/p?step=2&returnRevision=3");
  mocks.resolve.mockRejectedValue(new Error("暂不可用"));
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} />);
  await screen.findByRole("alert");
  expect(screen.getByRole("link", { name: "返回本步对话" })).toHaveAttribute("href", "/aidt/p?step=2&returnRevision=3");
});

const returnedLearning = { status: "ready", items: [{ kind: "aidt-return-reflection", projectId: "p", stageNumber: 6, revision: 3, targetStage: 2, questionSourceStageRevision: 2, fields: { originalQuestion: "原问题", beforeTestBelief: "前认识", afterTestBelief: "后认识", returnReason: "补访谈", nextAction: "询问学生" }, truncated: true, reviewStatus: "editor-confirmed", evidenceStatus: "not-verified", trust: "untrusted-student-material" }], issues: [] };
it("mounts selected historical reflection into native TeachingContext and shows exactly the bounded student fields", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "native", skillName: "共情", versionId: "v1" }); mocks.loadReturnContext.mockResolvedValue(returnedLearning);
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} returnRevision="3" />);
  await waitFor(() => expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ returnReflectionContext: returnedLearning }) })));
  expect(mocks.loadReturnContext).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", currentStage: 2, sessionToken: "token", returnRevision: "3", signal: expect.any(AbortSignal) }));
  expect(screen.getByTestId("aidt-chat-return-context")).toHaveTextContent("内容已截断");
  expect(screen.getByLabelText("AI参考的历史返工反思").textContent).toBe(JSON.stringify(returnedLearning.items[0]!.fields, null, 2));
  expect(screen.getByTestId("chat-shell")).toBeInTheDocument();
});
it("keeps native Chat usable and retries a failed historical read without remounting its composer", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "native", skillName: "共情", versionId: "v1" });
  mocks.loadReturnContext.mockResolvedValueOnce({ status: "failed", items: [], issues: [{ stageNumber: 6, reason: "unavailable" }] }).mockResolvedValue(returnedLearning);
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} returnRevision="3" />);
  await screen.findByRole("button", { name: "重新读取返工反思" }); const composer = screen.getByLabelText("native-unsent-input");
  fireEvent.change(composer, { target: { value: "继续讨论" } }); fireEvent.click(screen.getByRole("button", { name: "重新读取返工反思" }));
  await waitFor(() => expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ returnReflectionContext: returnedLearning }) })));
  expect(screen.getByLabelText("native-unsent-input")).toBe(composer); expect(composer).toHaveValue("继续讨论");
});
it.each(["token", "user", "org", "project", "stage", "revision", "aba"])("drops a late historical response on %s scope change", async (change) => {
  let finish!: (value: unknown) => void;
  mocks.resolve.mockResolvedValue({ threadId: "native", skillName: "教学", versionId: "v1" });
  mocks.loadReturnContext.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ status: "failed", items: [], issues: [{ stageNumber: 6, reason: "unavailable" }] });
  const initial = <ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} returnRevision="3" />;
  const { rerender } = render(initial); await screen.findByTestId("chat-shell");
  const signal = mocks.loadReturnContext.mock.calls[0]![0].signal as AbortSignal;
  if (change === "token") mocks.session = { ...mocks.session, sessionToken: "new-token" };
  if (change === "user") mocks.session = { ...mocks.session, userId: "other-student" };
  if (change === "org") mocks.session = { ...mocks.session, currentOrgId: "other-org" };
  rerender(<ProjectAidtChat projectId={change === "project" ? "other" : "p"} step={AIDT_STEPS[change === "stage" ? 0 : 1]} thread={null} returnRevision={change === "revision" || change === "aba" ? "4" : "3"} />);
  if (change === "aba") rerender(initial);
  await waitFor(() => expect(signal.aborted).toBe(true));
  await act(async () => finish(returnedLearning));
  expect(JSON.stringify(mocks.context.mock.calls.at(-1)![0].value.returnReflectionContext)).not.toContain("原问题");
});
it("does not load URL hints without an explicit return selection and cancels on unmount", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "native", skillName: "教学", versionId: "v1" }); window.history.replaceState(null, "", "/aidt/p?step=2&returnRevision=3");
  const { rerender, unmount } = render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} />); await screen.findByTestId("chat-shell"); expect(mocks.loadReturnContext).not.toHaveBeenCalled();
  rerender(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} returnRevision="3" />); await waitFor(() => expect(mocks.loadReturnContext).toHaveBeenCalledTimes(1));
  const signal = mocks.loadReturnContext.mock.calls[0]![0].signal as AbortSignal; unmount(); expect(signal.aborted).toBe(true);
});

it("removes selected return material synchronously when it is no longer selected", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "native", skillName: "共情", versionId: "v1" }); mocks.loadReturnContext.mockResolvedValue(returnedLearning);
  const { rerender } = render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} returnRevision="3" />);
  await waitFor(() => expect(mocks.context.mock.calls.at(-1)![0].value.returnReflectionContext.items).toHaveLength(1));
  rerender(<ProjectAidtChat projectId="p" step={AIDT_STEPS[1]} thread={null} returnRevision={null} />);
  expect(mocks.context.mock.calls.at(-1)![0].value.returnReflectionContext).toEqual({ status: "not-selected", items: [], issues: [] });
  expect(screen.queryByTestId("aidt-chat-return-context")).toBeNull();
});

it("keeps the historical question source distinct from the current fifth-stage version", async () => {
  mocks.resolve.mockResolvedValue({ threadId: "native", skillName: "原型", versionId: "v1" });
  const historical = { ...returnedLearning, items: [{ ...returnedLearning.items[0]!, targetStage: 5 }] };
  mocks.loadReturnContext.mockResolvedValue(historical);
  const current = { status: "ready", items: [{ kind: "aidt-stage", projectId: "p", stageNumber: 5, revision: 99, sourceStageRevisions: [], draftText: "当前第5步新版本", truncated: false, reviewStatus: "not-confirmed", evidenceStatus: "not-verified", visibility: "group-shared" }], issues: [] };
  mocks.loadSharedContext.mockResolvedValue(current);
  render(<ProjectAidtChat projectId="p" step={AIDT_STEPS[4]} thread={null} returnRevision="3" sharedContextRefs={[{ stageNumber: 5, revision: 99 }]} />);
  await waitFor(() => expect(mocks.context).toHaveBeenLastCalledWith(expect.objectContaining({ value: expect.objectContaining({ returnReflectionContext: historical, sharedStageContext: current }) })));
  expect(screen.getByTestId("aidt-chat-return-context")).toHaveTextContent("原问题来源（学生记录，尚未核实）：第5步 V2");
  expect(screen.getByTestId("aidt-chat-return-context")).not.toHaveTextContent("第5步 V99");
  expect(mocks.context.mock.calls.at(-1)![0].value.returnReflectionRules).toContain("不与当前第5步版本互换");
});
