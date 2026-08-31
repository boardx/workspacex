import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
const { push, listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments, listCapabilities, createPersonalThread, sessionState } = vi.hoisted(() => ({
  push: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  listThreadArtifacts: vi.fn(),
  listThreadAttachments: vi.fn(),
  listCapabilities: vi.fn(),
  createPersonalThread: vi.fn(),
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
  listPersonalThreads, getThread, listThreadArtifacts, listThreadAttachments, createPersonalThread,
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

/**
 * 用于 `handleCreate` 复用/新建分支的空线程夹具——`EMPTY_TOP` 模拟"分组最上面
 * 那张卡片本身就是空线程"（复用应该命中的目标），`EMPTY_OLD` 模拟"沉在分组
 * 中部/下面的陈旧空线程"（BLOCK 审查要求反证的、不该被复用的目标）。两者
 * `status` 都是 `not-started`，唯一区别是它们在 `cards` 数组里的位置。
 */
const EMPTY_TOP = { id: "thr-empty-top", title: "新对话", subtitle: "", badges: [], status: "not-started" as const, artifactCount: 0, lastActivityAt: "2026-08-30T12:00:00.000Z", visibilityScope: "private" as const };
const EMPTY_OLD = { id: "thr-empty-old", title: "新对话", subtitle: "", badges: [], status: "not-started" as const, artifactCount: 0, lastActivityAt: "2026-08-20T00:00:00.000Z", visibilityScope: "private" as const };

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
  createPersonalThread.mockReset();
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

/**
 * PR #2422 独立审查（BLOCK，评论 5472084365）第 2/3 点——`handleCreate` 的
 * "只在分组最上面那张卡片是空线程时才复用"规则此前**没有任何测试实际执行过**：
 * 旧的 `copilotkit-v2-shell-thread-switch.test.tsx` 三个用例全部只覆盖"点击已有
 * 线程后的软导航兜底"，从未点击过 `chat-thread-create`、从未 mock/断言
 * `createPersonalThread`、也从未断言新的 `groups[0].cards[0]` 判据——那 3/3 通过
 * 是假阳性证据，改动前后都会通过。
 *
 * 下面五条补审查要求的边界/反例覆盖：
 *   (a) 最上面的卡片是空线程 ⇒ 复用它，零次 create 调用；
 *   (b) 最上面的卡片是活跃线程、下面才有空线程 ⇒ 老实建一条新的，再刷新，导航到新 id；
 *   (c) "今天"为空、"本周"里有旧空线程 ⇒ 不跨组复用，建新的；
 *   (d) 列表仍在读（`threads === null`）时连续点两次「新建」⇒ 不产生两条空线程、
 *       不会误判命中陈旧目标（第二次点击被 `createPending` 挡在按钮 `disabled` 上）；
 *   (e) create 失败 ⇒ 不导航、不产生假成功——顺带发现并修好了一个真实缺口：
 *       `handleCreate` 原来没有 catch，失败会从 `void handleCreate()` 逃逸成一个
 *       未处理的 promise rejection，界面上什么反馈都没有。现在补齐 `createFailure`
 *       状态与 `copilotkit-v2-create-thread-error` 呈现，和 `handleRename`/
 *       `handleDelete` 同一套"捕获失败 → 显式落一个失败态"纪律。
 */
describe("CopilotKitV2Shell — issue #2422 handleCreate 复用/新建判据", () => {
  it("(a) 分组最上面那张卡片本身是 not-started 空线程 ⇒ 直接复用，零次 createPersonalThread 调用", async () => {
    listPersonalThreads.mockResolvedValue({
      groups: [{ label: "今天", cards: [EMPTY_TOP, THREAD_A] }],
      capabilities: ["thread.mutate"],
    });

    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${EMPTY_TOP.id}`);

    fireEvent.click(screen.getByTestId("chat-thread-create"));

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/chat/${EMPTY_TOP.id}`));
    expect(createPersonalThread).not.toHaveBeenCalled();
  });

  it("(b) 最上面的卡片是活跃线程、下面才有 not-started 空线程 ⇒ 不跨过去复用，建一条新的、刷新列表、导航到新 id", async () => {
    listPersonalThreads.mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [THREAD_A, EMPTY_OLD] }],
      capabilities: ["thread.mutate"],
    });
    createPersonalThread.mockResolvedValue({ threadId: "thr-new-b", version: 0, auditEventId: "ae-b", impactScope: null });

    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${EMPTY_OLD.id}`);

    fireEvent.click(screen.getByTestId("chat-thread-create"));

    await waitFor(() => expect(createPersonalThread).toHaveBeenCalledTimes(1));
    // 建完之后从服务端重读列表（不是本地乐观拼一条）——第 2 次调用是 `reloadThreads`。
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat/thr-new-b"));
    // 绝不会导航去那条沉在下面的陈旧空线程。
    expect(push).not.toHaveBeenCalledWith(`/chat/${EMPTY_OLD.id}`);
  });

  it("(c) “今天”分组为空、“本周”里有旧空线程 ⇒ 不跨组复用，老实建一条新的", async () => {
    listPersonalThreads.mockResolvedValueOnce({
      groups: [{ label: "今天", cards: [] }, { label: "本周", cards: [EMPTY_OLD] }],
      capabilities: ["thread.mutate"],
    });
    createPersonalThread.mockResolvedValue({ threadId: "thr-new-c", version: 0, auditEventId: "ae-c", impactScope: null });

    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${EMPTY_OLD.id}`);

    fireEvent.click(screen.getByTestId("chat-thread-create"));

    await waitFor(() => expect(createPersonalThread).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat/thr-new-c"));
    expect(push).not.toHaveBeenCalledWith(`/chat/${EMPTY_OLD.id}`);
  });

  it("(d) 列表仍在读（threads 为 null）时连续点两次「新建」⇒ 只建一条，第二次点击被 pending 挡住", async () => {
    let resolveList: (value: typeof TWO_THREADS) => void = () => {};
    listPersonalThreads.mockImplementationOnce(() => new Promise((resolve) => { resolveList = resolve; }));
    let resolveCreate: (value: { threadId: string; version: number; auditEventId: string; impactScope: string | null }) => void = () => {};
    createPersonalThread.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve; }));

    render(<CopilotKitV2Shell initialThreadId={null} />);
    // 列表还没回来：骨架态，不是"零对话"假空态（issue #2039 第 3 轮 gap #3）。
    await screen.findByTestId("loading");

    const button = screen.getByTestId("chat-thread-create");
    fireEvent.click(button);
    fireEvent.click(button); // 紧接着再点一次——按钮此刻应已因 `createPending` 变 disabled

    expect(createPersonalThread).toHaveBeenCalledTimes(1);

    // 让首次列表读取回来，再让 create 回来，全程只应该有一次 create + 一次导航。
    resolveList(TWO_THREADS);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    resolveCreate({ threadId: "thr-new-d", version: 0, auditEventId: "ae-d", impactScope: null });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/chat/thr-new-d"));
    expect(push).toHaveBeenCalledTimes(1);
    expect(createPersonalThread).toHaveBeenCalledTimes(1);
  });

  it("(e) createPersonalThread 失败 ⇒ 不导航、不产生假成功，失败落地为可见错误", async () => {
    createPersonalThread.mockRejectedValue(new Error("网络错误"));

    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`); // TWO_THREADS 顶卡是 THREAD_A（done），走 create 分支

    fireEvent.click(screen.getByTestId("chat-thread-create"));

    await screen.findByTestId("copilotkit-v2-create-thread-error");
    expect(push).not.toHaveBeenCalled();
  });
});
