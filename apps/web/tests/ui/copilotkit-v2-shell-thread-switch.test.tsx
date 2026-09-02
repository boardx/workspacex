import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
const { push, replace, listPersonalThreads, getThread, deleteThread, listThreadArtifacts, listThreadAttachments, listCapabilities, createPersonalThread, sessionState } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  listPersonalThreads: vi.fn(),
  getThread: vi.fn(),
  deleteThread: vi.fn(),
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

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }) }));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ status: "authenticated", session: sessionState, identity: null, error: null }),
}));
vi.mock("@/lib/live-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/live-chat")>()),
  listPersonalThreads, getThread, deleteThread, listThreadArtifacts, listThreadAttachments, createPersonalThread,
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
  replace.mockReset();
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
  deleteThread.mockReset();
  deleteThread.mockResolvedValue(undefined);
  listPersonalThreads.mockReset();
  listPersonalThreads.mockResolvedValue(TWO_THREADS);
  createPersonalThread.mockReset();
  sessionState.sessionToken = "provider-bearer";
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CopilotKitV2Shell — issue #2402 重新挂载时线程列表的模块级缓存", () => {
  /**
   * issue #2402 —— #2403 只堵住了"软导航超过 4 秒退化成整页硬导航"这一条路径，
   * 但真栈浏览器验证（`asideSameNode` 断言：切换前后 `<aside
   * data-testid="copilotkit-v2-thread-sidebar">` 是两个不同的 DOM 节点）确认了
   * 更根本的一层：Next App Router 在 `/chat/[threadId]` 的两个不同 `threadId`
   * 之间导航时，`ChatThreadPage` 直接渲染的这个 page 级组件本身就会被整体卸载
   * 重装——即使软导航全程正常、从未触发 `window.location.assign`。`threads`
   * state 因此每次都从 `null` 重新开始，侧栏骨架屏随之重新出现。
   *
   * 这条用例反证 `copilotkit-v2-shell.tsx` 顶部的模块级 `threadListCache`：
   * 重新挂载时用它做 `threads` 的**初始值**，不必等一次新的网络往返。用"这次挂载的
   * `listPersonalThreads` 永远不 resolve"来确保断言的是"初始渲染就已经有数据"，
   * 不是"最终等到了数据"——如果初始值真的用上了缓存，卡片必须在第一帧就在 DOM
   * 里，不需要 `findBy` 那种带重试轮询的异步等待。
   */
  it("上一次挂载已经拿到线程列表 ⇒ 重新挂载时用缓存初始化，不经过骨架帧", async () => {
    const { unmount } = render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    unmount();

    listPersonalThreads.mockReset();
    listPersonalThreads.mockImplementation(() => new Promise(() => {})); // 永远不 resolve

    render(<CopilotKitV2Shell initialThreadId={THREAD_A.id} />);
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`chat-thread-${THREAD_B.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();
  });

  /**
   * 独立 review（exact-SHA，PR #2419）阻断项 ①——`handleDelete` 此前绕开
   * `reloadThreads` 自己调 `listPersonalThreads`，只 `setThreads`，没有回写
   * `threadListCache`。删除**当前选中**的线程会紧跟着 `router.replace` 到下一条
   * ——正是会触发本组件重挂载的那条路径（见上一条用例的头注）——新实例若用没更新
   * 过的旧缓存初始化，被删的卡片会"复活"。这条用例反证已经修好：删除后重新挂载，
   * 逼初始渲染只能靠缓存（`listPersonalThreads` 换成永不 resolve），断言被删的卡片
   * 不会出现。
   */
  it("删除线程后重新挂载 ⇒ 缓存已经同步，被删的卡片不会复活", async () => {
    const { unmount } = render(<CopilotKitV2Shell initialThreadId={THREAD_A.id} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    await screen.findByTestId(`chat-thread-${THREAD_B.id}`);

    const AFTER_DELETE = { groups: [{ label: "今天", cards: [THREAD_A] }], capabilities: ["thread.mutate"] };
    listPersonalThreads.mockResolvedValueOnce(AFTER_DELETE);

    const cardBWrapper = screen.getByTestId(`chat-thread-${THREAD_B.id}`).closest('[data-testid="chat-thread-selection-actions"]');
    if (!cardBWrapper) throw new Error("thread B card wrapper not found");
    fireEvent.pointerDown(within(cardBWrapper as HTMLElement).getByTestId("chat-thread-card-menu-trigger"), { button: 0 });
    fireEvent.click(screen.getByTestId("chat-thread-delete"));
    fireEvent.change(screen.getByTestId("chat-thread-delete-reason"), { target: { value: "测试删除" } });
    fireEvent.click(screen.getByTestId("chat-thread-delete-submit"));

    await waitFor(() => expect(deleteThread).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId(`chat-thread-${THREAD_B.id}`)).not.toBeInTheDocument());
    unmount();

    listPersonalThreads.mockReset();
    listPersonalThreads.mockImplementation(() => new Promise(() => {})); // 逼初始渲染只能靠缓存

    render(<CopilotKitV2Shell initialThreadId={THREAD_A.id} />);
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`chat-thread-${THREAD_B.id}`)).not.toBeInTheDocument();
  });

  /**
   * 独立 review 阻断项 ②——缓存是模块级的，但 `listGeneration` 是每个组件实例
   * 自己的 `useRef`，重新挂载会清零重数。旧实例发出的请求晚于新实例发出的请求
   * resolve 时，旧实例的"实例内 generation 判据"挡不住它覆盖新实例已经写好的
   * 共享缓存——除非缓存写入按"谁发出得更晚"（跨实例的模块级单调序号）排序，而不是
   * 按"谁先 resolve"。这条用例直接构造这个交错：先挂载一个实例发出请求 A（挂起，
   * 不立即 resolve），卸载后挂载第二个实例发出请求 B（同样挂起），B 先 resolve、
   * A 后 resolve——断言 A 的（更早发出、更晚 resolve 的）陈旧数据不会覆盖 B 已经
   * 写好的缓存：卸载第二个实例、逼第三次挂载只能读缓存，看到的必须是 B 的数据。
   */
  it("旧实例的请求比新实例的请求更晚 resolve ⇒ 陈旧响应不会覆盖缓存里更新的数据", async () => {
    let resolveA!: (value: typeof TWO_THREADS) => void;
    let resolveB!: (value: typeof TWO_THREADS) => void;
    const AFTER_DELETE = { groups: [{ label: "今天", cards: [THREAD_A] }], capabilities: ["thread.mutate"] };

    listPersonalThreads.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    const { unmount: unmountA } = render(<CopilotKitV2Shell initialThreadId={null} />);
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledTimes(1)); // 请求 A 已发出（挂起）
    unmountA();

    listPersonalThreads.mockImplementationOnce(() => new Promise((resolve) => { resolveB = resolve; }));
    const { unmount: unmountB } = render(<CopilotKitV2Shell initialThreadId={null} />);
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledTimes(2)); // 请求 B 已发出（挂起）

    // B（更晚发出）先 resolve，写进缓存；A（更早发出）后 resolve，理应被丢弃。
    resolveB(AFTER_DELETE);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    resolveA(TWO_THREADS);
    await new Promise((resolve) => setTimeout(resolve, 0)); // 让 A 的 resolve 有机会（错误地）跑一轮
    unmountB();

    listPersonalThreads.mockReset();
    listPersonalThreads.mockImplementation(() => new Promise(() => {})); // 逼第三次挂载只能读缓存
    render(<CopilotKitV2Shell initialThreadId={null} />);
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toBeInTheDocument();
    // 缓存必须停在 B 的数据（只有 A）——如果 A 的陈旧响应覆盖了它，B 会重新出现。
    expect(screen.queryByTestId(`chat-thread-${THREAD_B.id}`)).not.toBeInTheDocument();
  });

  /** 独立 review 阻断项 ③（数据隔离）——换一个人登录（不同 `bearer`）不得看见
   *  上一位用户缓存的线程列表；`threadListCache` 按 `bearer` 分 key 的判据要有
   *  一条测试钉住，不能只停在头注里说说。 */
  it("bearer 换了人 ⇒ 不使用上一个 bearer 缓存的线程列表，退回骨架帧", async () => {
    const { unmount } = render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    unmount();

    sessionState.sessionToken = "another-bearer"; // 换了个人登录
    listPersonalThreads.mockReset();
    listPersonalThreads.mockImplementation(() => new Promise(() => {})); // 永远不 resolve

    render(<CopilotKitV2Shell initialThreadId={null} />);
    // 上一个 bearer 缓存的卡片不该出现；只能停在骨架帧,因为这个 bearer 还没有缓存。
    expect(screen.queryByTestId(`chat-thread-${THREAD_A.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId("loading")).toBeInTheDocument();
  });

  /**
   * 独立 review 第二轮阻断项 ③——`handleDelete` 提交成功后此前唯一的收尾动作是
   * 再发一次网络请求拿最新列表；那次请求失败不该让"已经在服务端生效的删除"在
   * 本地看起来像没发生过。这条用例让删除本身成功、但删除之后的**所有**
   * `listPersonalThreads` 调用（含后台补的那一次）都失败，断言：① UI 立刻摘掉
   * 被删的卡片（乐观修补，不等网络）；② 不会把"后台刷新失败"误当成"删除失败"
   * 显示出来；③ 卸载重新挂载后，缓存里已经不再有这张卡片。
   */
  it("删除成功但后台刷新失败 ⇒ 乐观修补仍然生效，重新挂载不会复活", async () => {
    const { unmount } = render(<CopilotKitV2Shell initialThreadId={THREAD_A.id} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    await screen.findByTestId(`chat-thread-${THREAD_B.id}`);

    listPersonalThreads.mockReset();
    listPersonalThreads.mockRejectedValue(new Error("网络抖动"));

    const cardBWrapper = screen.getByTestId(`chat-thread-${THREAD_B.id}`).closest('[data-testid="chat-thread-selection-actions"]');
    if (!cardBWrapper) throw new Error("thread B card wrapper not found");
    fireEvent.pointerDown(within(cardBWrapper as HTMLElement).getByTestId("chat-thread-card-menu-trigger"), { button: 0 });
    fireEvent.click(screen.getByTestId("chat-thread-delete"));
    fireEvent.change(screen.getByTestId("chat-thread-delete-reason"), { target: { value: "测试删除" } });
    fireEvent.click(screen.getByTestId("chat-thread-delete-submit"));

    await waitFor(() => expect(deleteThread).toHaveBeenCalledTimes(1));
    // 乐观修补同步生效：即使后台刷新注定失败，UI 也已经把 B 摘掉了。
    await waitFor(() => expect(screen.queryByTestId(`chat-thread-${THREAD_B.id}`)).not.toBeInTheDocument());
    expect(screen.queryByTestId("chat-thread-mutate-error")).not.toBeInTheDocument(); // 后台刷新失败不该冒充"删除失败"

    unmount();
    listPersonalThreads.mockImplementation(() => new Promise(() => {})); // 逼第二次挂载只能读缓存
    render(<CopilotKitV2Shell initialThreadId={THREAD_A.id} />);
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`chat-thread-${THREAD_B.id}`)).not.toBeInTheDocument();
  });

  /**
   * 独立 review 第二轮阻断项 ②——`threadListCache` 是模块级的，模块级单调序号只
   * 保证"更晚发出的请求赢"，不保证"发出请求的那个实例还活着"。一个已经卸载的
   * 实例发出的请求，如果在卸载**之后**才 resolve，此前会照样把结果写进共享缓存
   * （对下一次全新挂载而言，那是一份不该存在的"幽灵"数据）。这条用例直接构造
   * 这个时序：挂载 → 请求发出（挂起）→ 卸载 → 请求才 resolve——断言这份迟到的
   * 响应没有写进缓存：紧接着第一次全新挂载理应还是空缓存，只能停在骨架帧。
   */
  it("卸载后才 resolve 的请求 ⇒ 不写共享缓存", async () => {
    // 用独立 bearer——`threadListCache` 是模块级变量，同一个 bearer 可能已经被
    // 本文件前面的用例写过缓存；换一个没人用过的 bearer 才能保证"这是从零开始的
    // 第一次挂载，缓存本该仍是空的"这个前提成立。
    sessionState.sessionToken = "stale-resolve-bearer";
    let resolveStale!: (value: typeof TWO_THREADS) => void;
    listPersonalThreads.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    const { unmount } = render(<CopilotKitV2Shell initialThreadId={null} />);
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledTimes(1));
    unmount();

    resolveStale(TWO_THREADS); // 卸载之后才 resolve
    await new Promise((resolve) => setTimeout(resolve, 0)); // 给它一个机会（错误地）写缓存

    listPersonalThreads.mockReset();
    listPersonalThreads.mockImplementation(() => new Promise(() => {})); // 逼这次挂载只能读缓存
    render(<CopilotKitV2Shell initialThreadId={null} />);
    // 这是从零开始的第一次挂载，缓存本该仍是空的——如果卸载后的迟到响应写进去了，
    // 这里就会（错误地）直接看到 A/B 两张卡片，而不是骨架帧。
    expect(screen.queryByTestId(`chat-thread-${THREAD_A.id}`)).not.toBeInTheDocument();
    expect(screen.getByTestId("loading")).toBeInTheDocument();
  });

  /**
   * 独立 review 第三轮阻断项——`mountedRef` 只挡了"卸载后的响应能不能写缓存"，
   * 没有证明请求本身真的被取消了（而不是"结果被忽略，网络仍在后台跑完"）。这条
   * 用例直接抓 `listPersonalThreads` 收到的 `AbortSignal`，断言组件卸载时它
   * 真的被 `abort()`——不是间接推断，是读这个信号自己的 `aborted` 属性。
   */
  it("组件卸载 ⇒ 仍在飞的列表请求收到真实的 AbortSignal（不只是结果被忽略）", async () => {
    sessionState.sessionToken = "abort-signal-bearer"; // 独立 bearer，避免读到别的用例留下的缓存
    let capturedSignal: AbortSignal | undefined;
    listPersonalThreads.mockImplementationOnce((_opts, _token, signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // 挂起——只有真的被 abort，这个 promise 才会有动静
    });

    const { unmount } = render(<CopilotKitV2Shell initialThreadId={null} />);
    await waitFor(() => expect(listPersonalThreads).toHaveBeenCalledTimes(1));
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });
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
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_A.id}`));
    // 2026-09-03（round 4）—— `selectThread` 不再防抖，点击立刻真发 `pushThreadRoute`。
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
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_A.id}`)); // 立刻真发一次导航
    await vi.advanceTimersByTimeAsync(1_000); // A 还没结算，用户已经又点了 B
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_B.id}`)); // 同样立刻真发一次导航

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
 * 2026-09-03 人类实测反馈第三、四轮——round 2（150ms 防抖）、round 3
 * （`latestIntentRef` + `popstate` 时间窗）都是在"显示状态要等 Next Router
 * 软导航结算"这个前提下打补丁，独立 review（PR #2494、#2501 两次 exact-SHA
 * BLOCK）持续指出这个前提本身就是漏洞的来源。人类原话给了最终判据——"去掉
 * 任何的 timeout 等操作，点击 session 进入 session 的 route，不可以再有跳动"。
 * round 4 把显示状态（`selectedThreadId`/`panelMountKey`）改成完全不读
 * `initialThreadId` 的后续变化（只在挂载时当初始值），真正的切换只来自组件
 * 自己同步发起的动作——点击、新建/复用、删除后跳转、`popstate`。下面两条用例
 * 直接反证这一点：① 快速连续点击不再有任何防抖，每次点击立刻真发一次导航、
 * 立刻更新高亮，且此后 `initialThreadId` prop 无论怎么变化（模拟软导航乱序
 * 结算）都不会覆盖已经生效的选择——不是"猜得更准的纠错"，是压根不读，没有
 * "过期回声"这个概念；② 浏览器前进/后退直接从 `popstate` 触发时刻的
 * `window.location.pathname` 同步取值更新，不经过任何计时器。
 */
describe("CopilotKitV2Shell — round 4：显示状态不再读 initialThreadId 的后续变化", () => {
  it("快速连续点击 A→B ⇒ 每次点击立刻真发导航、立刻更新高亮，此后 initialThreadId 的任何变化都不会覆盖已经生效的选择", async () => {
    const { rerender } = render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    await screen.findByTestId(`chat-thread-${THREAD_B.id}`);

    // 点 A：没有防抖窗口要等，立刻真发一次导航、立刻高亮。
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_A.id}`));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenLastCalledWith(`/chat/${THREAD_A.id}`);
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toHaveAttribute("data-selected", "true");

    // 紧接着点 B（模拟"A 的软导航还没结算，用户已经又点了别的"）：同样立刻
    // 真发导航、立刻高亮，不必等待、不必合并。
    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_B.id}`));
    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith(`/chat/${THREAD_B.id}`);
    expect(screen.getByTestId(`chat-thread-${THREAD_B.id}`)).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toHaveAttribute("data-selected", "false");

    // A 那次更早点击对应的软导航，无论以什么顺序/什么时候结算（这里模拟
    // Next Router 把 initialThreadId prop 改成 A——一次姗姗来迟的、已经被
    // 超越的结算），都不该影响已经生效的选择：不产生任何新的 push（没有
    // "纠正"这回事，因为压根不读这次变化）。
    rerender(<CopilotKitV2Shell initialThreadId={THREAD_A.id} />);
    expect(screen.getByTestId(`chat-thread-${THREAD_B.id}`)).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toHaveAttribute("data-selected", "false");
    expect(push).toHaveBeenCalledTimes(2);

    // B 自己的结算随后抵达，同样不改变任何东西（已经在正确的状态上）。
    rerender(<CopilotKitV2Shell initialThreadId={THREAD_B.id} />);
    expect(screen.getByTestId(`chat-thread-${THREAD_B.id}`)).toHaveAttribute("data-selected", "true");
    expect(push).toHaveBeenCalledTimes(2);
  });

  it("浏览器前进/后退 ⇒ popstate 触发的同一刻直接从 location.pathname 同步取值切换，不经过任何计时器", async () => {
    render(<CopilotKitV2Shell initialThreadId={null} />);
    await screen.findByTestId(`chat-thread-${THREAD_A.id}`);
    await screen.findByTestId(`chat-thread-${THREAD_B.id}`);

    fireEvent.click(screen.getByTestId(`chat-thread-${THREAD_A.id}`));
    expect(push).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toHaveAttribute("data-selected", "true");

    // 真实浏览器的前进/后退会先把 `window.location` 换成目标路径，再派发
    // `popstate`；这里手动模拟这个顺序——落到 B，一个跟"刚点击的 A"不同的值，
    // 确保确实是这次外部导航在生效，不是巧合碰上了原来就相等的旧值。
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: `/chat/${THREAD_B.id}` },
      writable: true,
    });
    // `window.dispatchEvent` 不像 `fireEvent` 那样被 RTL 自动包进 `act()`——
    // 我们的 `popstate` 监听器同步调用 `setState`，不手动包一层，React 更新
    // 可能还没在下面的断言之前刷新完。
    act(() => { window.dispatchEvent(new Event("popstate")); });

    // 不等待任何 timer——`popstate` 的处理是同步的，事件一分发完，DOM 立刻
    // 反映新的选择。
    expect(screen.getByTestId(`chat-thread-${THREAD_B.id}`)).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId(`chat-thread-${THREAD_A.id}`)).toHaveAttribute("data-selected", "false");
    // popstate 本身不该触发新的 `push`——浏览器自己已经在管这条历史记录了，
    // 再 push 一次等于把同一条记录重复写两遍。
    expect(push).toHaveBeenCalledTimes(1);
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
    // 独立 bearer：`threadListCache`（issue #2402）是模块级、按 bearer 分 key 的——
    // 用默认 `provider-bearer` 会读到本文件前面用例留下的缓存，`threads` 不再是
    // `null`，骨架帧断言就假阳性通过了。换一个没人用过的 bearer 才能保证这次挂载
    // 真的从零开始、`loading` 骨架帧真实出现。
    sessionState.sessionToken = "create-while-loading-bearer";
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
