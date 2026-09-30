import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * issue #4744 —— 项目对话（`/chat/<id>?projectId=`）与个人对话的区分 + 返回项目。
 * ① 项目对话顶部有上下文条：「返回项目」链接 + 项目名；读不到项目名只显示「项目对话」，不崩；
 * ② 个人对话没有这条；③ 项目对话不再挂独立的「会话录音」面板。
 */
const { getProjectOverview, listWorkbenchThreads, getThread, sessionState } = vi.hoisted(() => ({
  getProjectOverview: vi.fn(),
  listWorkbenchThreads: vi.fn(),
  getThread: vi.fn(),
  sessionState: {
    sessionToken: "bearer", currentOrgId: "org-1", userId: "u1", orgIds: ["org-1"], expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", session: sessionState, identity: null, error: null }),
}));
vi.mock("@/lib/live-projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-projects")>()),
  getProjectOverview,
}));
vi.mock("@/lib/chat-workbench/project-scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chat-workbench/project-scope")>()),
  listWorkbenchThreads,
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  getThread, listThreadArtifacts: vi.fn(async () => ({ items: [] })), listThreadAttachments: vi.fn(async () => ({ items: [] })),
}));
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities: vi.fn(async () => []) }));
vi.mock("@/components/chat/copilotkit-v2-panel", () => ({ CopilotKitV2Panel: () => <div data-testid="stub-panel" /> }));
vi.mock("@/components/chat/chat-roster-panel", () => ({ RosterPanel: () => null }));
vi.mock("@/components/chat/chat-task-inspector", () => ({ ChatTaskInspector: () => null }));
vi.mock("@/components/chat/chat-artifact-preview-dialog", () => ({ ChatArtifactPreviewDialog: () => null }));

import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";
import { ProjectChatContextBar, projectBackHref } from "@/components/chat/project-chat-context-bar";

beforeEach(() => {
  getProjectOverview.mockReset();
  listWorkbenchThreads.mockReset();
  listWorkbenchThreads.mockResolvedValue({ groups: [], capabilities: ["thread.mutate"] });
  getThread.mockReset();
});

describe("projectBackHref", () => {
  it("通用项目回「内容」tab，带 org；工作坊回默认页", () => {
    expect(projectBackHref("p 1", "general", "org-1")).toBe("/projects/p%201?org=org-1&tab=content");
    expect(projectBackHref("p1", "workshop", "org-1")).toBe("/projects/p1?org=org-1");
    expect(projectBackHref("p1", null, null)).toBe("/projects/p1?tab=content");
  });
});

describe("ProjectChatContextBar", () => {
  it("显示返回项目链接与项目名", async () => {
    getProjectOverview.mockResolvedValue({ name: "增长项目", kind: "general" });
    render(<ProjectChatContextBar projectId="p1" orgId="org-1" bearer="b" />);
    await waitFor(() => expect(screen.getByTestId("project-chat-name")).toHaveTextContent("增长项目"));
    expect(screen.getByTestId("project-chat-back")).toHaveAttribute("href", "/projects/p1?org=org-1&tab=content");
    expect(screen.getByTestId("project-chat-back")).toHaveTextContent("返回项目");
  });

  it("读不到项目（无权限）不崩，仍有返回链接，名称回落「项目对话」", async () => {
    getProjectOverview.mockRejectedValue(new Error("403"));
    render(<ProjectChatContextBar projectId="p1" orgId={null} bearer="b" />);
    await waitFor(() => expect(getProjectOverview).toHaveBeenCalled());
    expect(screen.getByTestId("project-chat-name")).toHaveTextContent("项目对话");
    expect(screen.getByTestId("project-chat-back")).toHaveAttribute("href", "/projects/p1?tab=content");
  });
});

describe("CopilotKitV2Shell 项目对话 vs 个人对话", () => {
  it("带 projectId：上下文条 + 「本项目的对话」，且没有「会话录音」面板", async () => {
    getProjectOverview.mockResolvedValue({ name: "增长项目", kind: "general" });
    render(<CopilotKitV2Shell initialThreadId={null} projectId="p1" />);
    expect(screen.getByTestId("project-chat-context-bar")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("project-chat-name")).toHaveTextContent("增长项目"));
    expect(screen.getByTestId("copilotkit-v2-thread-sidebar")).toHaveTextContent("本项目的对话");
    expect(screen.queryByTestId("chat-recording-panel")).toBeNull();
    expect(screen.queryByText("会话录音")).toBeNull();
  });

  it("个人对话没有上下文条，文案不变", () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    expect(screen.queryByTestId("project-chat-context-bar")).toBeNull();
    expect(getProjectOverview).not.toHaveBeenCalled();
    expect(screen.getByTestId("copilotkit-v2-thread-sidebar")).toHaveTextContent("不挂靠任何项目，仅自己可见");
  });
});
