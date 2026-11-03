/** Canonical shell locale regressions; API fixture wiring reused from the pagination suite. */
import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { push, replace, listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments, listCapabilities, createPersonalThread, sessionState } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  listThreadArtifacts: vi.fn(),
  listThreadAttachments: vi.fn(),
  listCapabilities: vi.fn(),
  createPersonalThread: vi.fn(),
  sessionState: {
    sessionToken: "pager-bearer",
    currentOrgId: "org-current",
    userId: "user-current",
    orgIds: ["org-current"],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/components/session/session-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/session/session-provider")>()),
  useSession: () => ({ status: "authenticated", session: sessionState, identity: null, error: null }),
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments, createPersonalThread,
}));
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities }));
vi.mock("@/components/chat/copilotkit-v2-panel", () => ({
  CopilotKitV2Panel: () => <div data-testid="stub-copilotkit-v2-panel" />,
}));
vi.mock("@/components/chat/chat-roster-panel", () => ({ RosterPanel: () => null }));
vi.mock("@/components/chat/chat-task-inspector", () => ({ ChatTaskInspector: () => null }));
vi.mock("@/components/chat/chat-artifact-preview-dialog", () => ({ ChatArtifactPreviewDialog: () => null }));

import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { THREAD_PAGE_SIZE } from "@/lib/chat-workbench/thread-pages";

const card = (id: string, title = id) => ({
  id, title, subtitle: "", badges: [], status: "done" as const, artifactCount: 0,
  lastActivityAt: "2026-09-01T00:00:00.000Z", visibilityScope: "private" as const, pinned: false,
});

const page = (label: string, ids: string[], nextCursor: string | null) => ({
  groups: [{ label, cards: ids.map((id) => card(id)) }],
  capabilities: ["thread.mutate"],
  nextCursor,
});

const PAGE_1_IDS = Array.from({ length: THREAD_PAGE_SIZE }, (_, i) => `t-${String(i).padStart(2, "0")}`);


beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  listCapabilities.mockReset();
  listCapabilities.mockResolvedValue([]);
  listThreadArtifacts.mockReset();
  listThreadArtifacts.mockResolvedValue({ items: [] });
  listThreadAttachments.mockReset();
  listThreadAttachments.mockResolvedValue({ items: [] });
  getThread.mockReset();
  getThread.mockResolvedValue({
    thread: { id: "t-00", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-09-01T00:00:00.000Z", version: 0 },
    messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
  });
  createPersonalThread.mockReset();
  listPersonalThreads.mockReset();
  listPersonalThreads.mockResolvedValue(page("今天", PAGE_1_IDS, "cursor-after-page-1"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function SwitchLanguage() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>switch language</button>;
}
it("shows canonical English shell chrome and retains search value/node without refetching on locale change", async () => {
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><CopilotKitV2Shell initialThreadId={null} /></I18nProvider>);
  const search = await screen.findByRole("searchbox", { name: "Search conversations" });
  expect(screen.getByTestId("copilotkit-v2-thread-topbar-title").textContent).toBe("Personal conversation");
  expect(screen.getByTestId("copilotkit-v2-thread-topbar-visibility").textContent).toBe("Visible only to you");
  expect(screen.getByRole("button", { name: "New conversation" })).toBeTruthy();
  fireEvent.change(search, { target: { value: "原文 search 🌍" } });
  await waitFor(() => expect(listPersonalThreads.mock.lastCall?.[0].q).toBe("原文 search 🌍"));
  const calls = listPersonalThreads.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("searchbox", { name: "搜索对话" })).toBe(search);
  expect((search as HTMLInputElement).value).toBe("原文 search 🌍");
  expect(listPersonalThreads).toHaveBeenCalledTimes(calls);
});

it("re-renders an existing owned load error in the new language without retrying its request", async () => {
  listPersonalThreads.mockRejectedValueOnce(null);
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><CopilotKitV2Shell initialThreadId={null} /></I18nProvider>);
  const error = await screen.findByTestId("copilotkit-v2-thread-list-error");
  expect(error.textContent).toBe("Could not load conversations.");
  const count = listPersonalThreads.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(error.textContent).toBe("线程列表读取失败");
  expect(listPersonalThreads).toHaveBeenCalledTimes(count);
});
