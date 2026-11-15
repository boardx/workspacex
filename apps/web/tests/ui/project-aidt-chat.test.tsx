import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidtChat } from "@/features/aidt/components/project-aidt-chat";
import type { AidtStepChat } from "@/features/aidt/lib/live-aidt-step-chat";
import { AIDT_STEPS } from "@/lib/project-aidt";
const mocks = vi.hoisted(() => ({ enabled: true, resolve: vi.fn(), loadContext: vi.fn(), loadSharedContext: vi.fn(), shell: vi.fn(), context: vi.fn(), session: { currentOrgId: "o", userId: "u", sessionToken: "token" } }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/features/aidt/lib/live-aidt-step-chat", () => ({ resolveAidtStepChat: mocks.resolve, AidtStepChatChoiceError: class extends Error {} }));
vi.mock("@/features/aidt/lib/aidt-chat-saved-context", async (original) => ({ ...await original<typeof import("@/features/aidt/lib/aidt-chat-saved-context")>(), loadAidtSavedChatContext: mocks.loadContext }));
vi.mock("@/features/aidt/lib/aidt-chat-shared-context", async (original) => ({ ...await original<typeof import("@/features/aidt/lib/aidt-chat-shared-context")>(), loadAidtSharedChatContext: mocks.loadSharedContext }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: mocks.session }) }));
vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: mocks.context }));
vi.mock("@/components/chat/copilotkit-v2-shell", () => ({ CopilotKitV2Shell: (props: Record<string, unknown>) => { mocks.shell(props); return <div data-testid="chat-shell" />; } }));
vi.mock("@/app/chat/copilotkit-v2/copilotkit-v2-providers", () => ({ CopilotKitV2Providers: ({ children }: React.PropsWithChildren) => children }));
vi.mock("@/lib/copilotkit-v2-agent-selection", () => ({ CopilotKitV2AgentSelectionProvider: ({ children }: React.PropsWithChildren) => children }));
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; mocks.loadSharedContext.mockResolvedValue({ status: "ready", items: [], issues: [] }); mocks.loadContext.mockResolvedValue({ status: "ready", items: [], issues: [] }); window.history.replaceState(null, "", "/aidt/p?step=1"); });
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
