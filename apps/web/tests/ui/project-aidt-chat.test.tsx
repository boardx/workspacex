import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ProjectAidtChat } from "@/features/aidt/components/project-aidt-chat";
import type { AidtStepChat } from "@/features/aidt/lib/live-aidt-step-chat";
import { AIDT_STEPS } from "@/lib/project-aidt";
const mocks = vi.hoisted(() => ({ enabled: true, resolve: vi.fn(), shell: vi.fn(), context: vi.fn(), session: { currentOrgId: "o", userId: "u", sessionToken: "token" } }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/features/aidt/lib/live-aidt-step-chat", () => ({ resolveAidtStepChat: mocks.resolve, AidtStepChatChoiceError: class extends Error {} }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: mocks.session }) }));
vi.mock("@copilotkit/react-core/v2", () => ({ useAgentContext: mocks.context }));
vi.mock("@/components/chat/copilotkit-v2-shell", () => ({ CopilotKitV2Shell: (props: Record<string, unknown>) => { mocks.shell(props); return <div data-testid="chat-shell" />; } }));
vi.mock("@/app/chat/copilotkit-v2/copilotkit-v2-providers", () => ({ CopilotKitV2Providers: ({ children }: React.PropsWithChildren) => children }));
vi.mock("@/lib/copilotkit-v2-agent-selection", () => ({ CopilotKitV2AgentSelectionProvider: ({ children }: React.PropsWithChildren) => children }));
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; window.history.replaceState(null, "", "/aidt/p?step=1"); });
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
