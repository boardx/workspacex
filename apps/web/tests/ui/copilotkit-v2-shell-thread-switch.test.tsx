import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * issue #2259 —— rev-e2e 真栈实测过一次：点击侧栏已有对话，`router.push()` 发出的
 * 软导航预取请求确实打了出去，但 `location.href` 之后仍停在旧路由，主面板不切换。
 *
 * ## 为什么这条用例故意让 `router.push` 变成一个"什么都不做"的桩
 *
 * 反复用真栈 e2e（`copilotkit-v2-thread-persistence.spec.ts` 的「裸路由 /chat 落地」
 * 用例）与浏览器工具原样复刻 rev-e2e 的 read_page+left_click 路径，均未能复现软导航
 * 本身失灵——当前代码路径下 `router.push` 工作正常。这条单元测试因此**不是**去复现
 * 那次真栈失败本身（做不到：失败原因是一次性的软导航卡顿，不是确定性代码路径），
 * 而是反证 `copilotkit-v2-shell.tsx` 新增的兜底逻辑——「万一 `router.push` 再卡一次，
 * 用户点了确实还是会有反应」——是否真的按预期工作。`push` 这里刻意 mock 成
 * `vi.fn()`（不触碰 `location`），逼真地模拟"发出了但没生效"这种此前无法被任何
 * 断言捕捉的失败模式。
 *
 * ⚠ issue #2402 —— 兜底动作本身从"整页硬导航 `window.location.assign`"改成
 * "重试一次软导航 `router.push`"：#2259 当时的兜底会把 `app/chat/(v2)/layout.tsx`
 * 挂的整棵树（含左栏会话列表）一起卸载重装，人类实测确认这正是"点会话就整栏
 * 刷新"的根因（`selectedThreadIdRef`/`location.pathname` 判据再准，只要软导航真的
 * 慢过 4 秒，兜底依然会触发）。改成重试软导航后，`assign` 断言全部替换成"`push`
 * 被再次调用"——兜底不再触碰 `window.location`，左栏因此不会重新挂载。
 */
const { push, listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments, listCapabilities, sessionState } = vi.hoisted(() => ({
  push: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  listThreadArtifacts: vi.fn(),
  listThreadAttachments: vi.fn(),
  listCapabilities: vi.fn(),
  sessionState: {
    sessionToken: "provider-bearer",
    currentOrgId: "org-current",
    userId: "user-current",
    orgIds: ["org-current"],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", session: sessionState, identity: null, error: null }),
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments,
}));
vi.mock("@/lib/live-capabilities", () => ({ listCapabilities }));
vi.mock("@/lib/chat-pinned-threads", () => ({ readPinnedThreadIds: () => [], togglePinnedThreadId: vi.fn() }));
vi.mock("@/components/chat/copilotkit-v2-panel", () => ({
  CopilotKitV2Panel: () => <div data-testid="stub-copilotkit-v2-panel" />,
}));
vi.mock("@/components/chat/chat-roster-panel", () => ({ RosterPanel: () => null }));
vi.mock("@/components/chat/chat-task-inspector", () => ({ ChatTaskInspector: () => null }));
vi.mock("@/components/chat/chat-artifact-preview-dialog", () => ({ ChatArtifactPreviewDialog: () => null }));

import { CopilotKitV2Shell } from "@/components/chat/copilotkit-v2-shell";

const THREAD_A = { id: "thr-a", title: "对话 A", subtitle: "", badges: [], status: "done" as const, artifactCount: 0, lastActivityAt: "2026-08-27T00:00:00.000Z", visibilityScope: "private" as const };
const THREAD_B = { id: "thr-b", title: "对话 B", subtitle: "", badges: [], status: "done" as const, artifactCount: 0, lastActivityAt: "2026-08-27T00:00:00.000Z", visibilityScope: "private" as const };
const TWO_THREADS = { groups: [{ label: "今天", cards: [THREAD_A, THREAD_B] }], capabilities: ["thread.mutate"] };

beforeEach(() => {
  push.mockReset();
  listCapabilities.mockReset();
  listCapabilities.mockResolvedValue([]);
  listThreadArtifacts.mockReset();
  listThreadArtifacts.mockResolvedValue({ items: [] });
  listThreadAttachments.mockReset();
  listThreadAttachments.mockResolvedValue({ items: [] });
  getThread.mockReset();
  getThread.mockResolvedValue({
    thread: { id: "thr-a", projectId: null, groupId: null, visibilityScope: "private", phase: "onsite", archived: false, createdBy: "user-current", lastActivityAt: "2026-08-27T00:00:00.000Z", version: 0 },
    messages: [], rightTabs: [], capabilities: ["composer.send", "thread.mutate"],
  });
  listPersonalThreads.mockReset();
  listPersonalThreads.mockResolvedValue(TWO_THREADS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CopilotKitV2Shell — issue #2259 侧栏点击线程切换兜底", () => {
  it("裸路由（未选中任何线程）落地时点击侧栏已有对话 ⇒ 正常情形只走软导航，不触发硬导航兜底", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);

    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/chat", assign: assignSpy },
      writable: true,
    });

    vi.useFakeTimers();
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_A.id}`));

    expect(push).toHaveBeenCalledWith(`/chat/${THREAD_A.id}`);

    // 软导航"正常"生效：兜底窗口到点前把 `location.pathname` 改成目标路径
    // （模拟 App Router 完成导航后地址栏会变成什么）。
    window.location.pathname = `/chat/${THREAD_A.id}`;
    await vi.advanceTimersByTimeAsync(4_100);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("router.push 发出后 location 迟迟不变（真栈实测过的失败模式）⇒ 兜底窗口到点后重试软导航，不触碰 location", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_B.id}`);

    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/chat", assign: assignSpy },
      writable: true,
    });

    vi.useFakeTimers();
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_B.id}`));

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(`/chat/${THREAD_B.id}`);
    // `push` 是一个什么都不做的桩——软导航"发出了但没生效"，`location.pathname`
    // 原地不动，正是 rev-e2e 网络面板抓到的那种失败模式。
    expect(assignSpy).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(4_100);
    // 兜底重试软导航（再一次 `push`），而不是 `window.location.assign` 整页硬刷新——
    // 硬导航会把左栏会话列表一起打掉重挂载，这正是 issue #2402 要堵住的洞。
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith(`/chat/${THREAD_B.id}`);
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("兜底窗口到点前用户又点了另一条线程 ⇒ 不会被上一次点击的检查错误地打断", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    await screen.findByTestId(`chat-thread-${THREAD_B.id}`);

    const assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/chat", assign: assignSpy },
      writable: true,
    });

    vi.useFakeTimers();
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_A.id}`));
    await vi.advanceTimersByTimeAsync(1_000);
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_B.id}`));

    expect(push).toHaveBeenCalledTimes(2); // A 一次 + B 一次
    // 第一次点击（A）的 4s 窗口到点：不该因为 A 还没导航成功就强制重试导航去 A——
    // 用户此刻真正想去的是 B，B 自己的窗口还没到点。
    await vi.advanceTimersByTimeAsync(3_100);
    expect(push).toHaveBeenCalledTimes(2); // A 那次已过期的兜底不该再补一次调用

    // B 自己的窗口到点，才轮到 B 的兜底生效——重试一次软导航去 B。
    await vi.advanceTimersByTimeAsync(1_000);
    expect(push).toHaveBeenCalledTimes(3);
    expect(push).toHaveBeenLastCalledWith(`/chat/${THREAD_B.id}`);
    expect(assignSpy).not.toHaveBeenCalled();
  });
});
