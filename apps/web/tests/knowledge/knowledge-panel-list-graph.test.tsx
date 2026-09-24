/**
 * phase-18 F09 —— 会话「记忆」面板读取 + 列表/图视图接线（uc-18-3 读；U-1 / U-6；R5 用词）。
 *
 * 网络在 `fetch` 这一层打桩（不是替身掉 `lib/knowledge-graph-api.ts`）：请求路径、契约 `out`
 * schema 校验、失败信封 → 错误码映射，全是真代码在跑。`@xyflow/react` 用仓内既有替身
 * （jsdom 没有 ResizeObserver，见 `tests/support/xyflow-stub.tsx`）。
 *
 * 覆盖：
 *  · 列表按类型分组 + 三态徽标 + 来源计数
 *  · 列表 ↔ 图切换
 *  · 点一条打开来源抽屉，看到证据与溯源（`getClaimSources`）
 *  · 可见范围常驻（仅你可见 / 会话成员可见）
 *  · 只读（canEdit=false）不渲染任何编辑入口；空 / 加载 / 错误（含重试）态
 *  · > 200 节点折叠为簇
 *  · 回答下「已记下 N 条」：captured > 0 渲染、= 0 不渲染、整理中补读
 *  · 右栏「记忆」页签：角标 = claims.length；「查看」切到该页签
 *  · 渲染出的文字不含 R5 禁用词
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));
const planApi = vi.hoisted(() => ({ fetchPlanLedger: vi.fn() }));
vi.mock("@/lib/plan-control-api", () => planApi);

import {
  knowledgeGraph,
  KG_GRAPH_VIEW_MAX_NODES,
  type KgClaim,
  type KgObject,
} from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import {
  fetchThreadKnowledge,
  KnowledgeGraphError,
  type ClaimSources,
  type ThreadKnowledge,
  type TurnMemory,
} from "@/lib/knowledge-graph-api";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";
import { OPEN_KNOWLEDGE_PANEL_EVENT, requestOpenKnowledgePanel } from "@/lib/knowledge-graph-events";
import { ThreadKnowledgeTab, useThreadKnowledge } from "@/components/chat/knowledge/thread-knowledge-tab";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";
import { TurnMemoryLine, TURN_MEMORY_REPOLL_DELAYS_MS } from "@/components/chat/knowledge/turn-memory-line";
import { ChatTaskInspector } from "@/components/chat/chat-task-inspector";

/* ── 契约形状的 fixture（每一份都先过契约 schema，形状错了当场红） ───────────────── */

const THREAD = "thr-kg-1";
const SCOPE = { kind: "chat_session", id: THREAD } as const;

function claim(id: string, kind: KgClaim["kind"], statement: string, status: KgClaim["status"], supportingCount = 1): KgClaim {
  const tri = status === "accepted" ? "confirmed" : status === "contested" ? "conflict" : "pending";
  return {
    id, scope: SCOPE, kind, statement, status, triState: tri, confidence: 0.8, createdBy: "model",
    reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: ["obj-a"],
    supportingCount, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z",
  };
}

function object(id: string, kind: KgObject["kind"], name: string): KgObject {
  return { id, scope: SCOPE, kind, name, aliases: [], createdBy: "model", claimCount: 1 };
}

const CLAIMS: KgClaim[] = [
  claim("c-decide", "decision", "王五决定周五发版。", "accepted", 3),
  claim("c-fact", "fact", "客户 B 需要中文界面。", "proposed", 2),
  claim("c-risk", "risk", "周五发版可能赶不上测试。", "contested", 1),
  claim("c-todo", "todo", "赵六整理发版清单。", "reviewed", 1),
];

function knowledge(overrides: Partial<ThreadKnowledge> = {}): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: SCOPE,
    revision: 7,
    objects: [object("obj-a", "person", "王五"), object("obj-b", "organization", "客户 B")],
    claims: CLAIMS,
    edges: [{ id: "e1", src: { kind: "claim", id: "c-decide" }, dst: { kind: "object", id: "obj-a" }, relation: "decided_by", createdBy: "model" }],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    canEdit: true,
    canPromote: false,
    visibility: "owner_only",
    ...overrides,
  });
}

const SOURCES: ClaimSources = knowledgeGraph.getClaimSources.out.parse({
  claim: CLAIMS[0],
  evidence: [
    {
      segmentId: "seg-1", stance: "supporting", sourceKind: "chat_message", sourceRef: "msg-1",
      excerpt: "那就定了，周五发版。", locator: null, revoked: false,
    },
  ],
  provenance: [
    { at: "2026-09-24T08:01:00Z", actor: { kind: "system", id: "extractor" }, action: "从对话中记下", pipelineVersion: "v3" },
  ],
});

function turn(overrides: Partial<TurnMemory> = {}): TurnMemory {
  return knowledgeGraph.getTurnMemory.out.parse({
    messageId: "msg-9", captured: [], pending: false, prompt: null, ...overrides,
  });
}

/* ── 网络桩 ───────────────────────────────────────────────────────── */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function failure(status: number, reasonCode: string): Response {
  return json({ error: "denied", traceId: "t-1", reasonCode }, status);
}

type Route = (url: string) => Response | Promise<Response> | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
function stubNetwork(route: Route): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = await route(new URL(url).pathname);
    if (!res) throw new Error(`unexpected fetch: ${url}`);
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
}
const calledPaths = (): string[] => fetchMock.mock.calls.map(([u]) => new URL(String(u)).pathname);

function Harness({ threadId }: { threadId: string | null }) {
  const state = useThreadKnowledge(threadId);
  return <ThreadKnowledgeTab state={state} />;
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg");
  planApi.fetchPlanLedger.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 渲染出来的全部人看得到的文字（正文 + aria-label + title）。 */
function visibleCopy(root: HTMLElement): string {
  const attrs = [...root.querySelectorAll("[aria-label],[title]")]
    .map((el) => `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`);
  return `${root.textContent ?? ""} ${attrs.join(" ")}`;
}

/* ── 取数口 ───────────────────────────────────────────────────────── */

describe("lib/knowledge-graph-api", () => {
  it("GET /knowledge-graph/threads/:threadId，经契约 out 校验后返回", async () => {
    stubNetwork((p) => (p === `/knowledge-graph/threads/${THREAD}` ? json(knowledge()) : undefined));
    const out = await fetchThreadKnowledge(THREAD);
    expect(out.claims).toHaveLength(4);
    expect(calledPaths()).toEqual([`/knowledge-graph/threads/${THREAD}`]);
  });

  it("失败信封的 KG_NOT_VISIBLE / KG_THREAD_NOT_FOUND 映射成带码的 KnowledgeGraphError", async () => {
    stubNetwork(() => failure(403, "KG_NOT_VISIBLE"));
    await expect(fetchThreadKnowledge(THREAD)).rejects.toMatchObject({ name: "KnowledgeGraphError", code: "KG_NOT_VISIBLE", status: 403 });
    stubNetwork(() => failure(404, "KG_THREAD_NOT_FOUND"));
    await expect(fetchThreadKnowledge(THREAD)).rejects.toMatchObject({ code: "KG_THREAD_NOT_FOUND", status: 404 });
  });

  it("响应形状不符契约 / 非本束错误码 ⇒ code=null，不猜码、不当成空数据", async () => {
    stubNetwork(() => json({ claims: [] }));
    const shapeErr = await fetchThreadKnowledge(THREAD).catch((e: unknown) => e);
    expect(shapeErr).toBeInstanceOf(KnowledgeGraphError);
    expect((shapeErr as KnowledgeGraphError).code).toBeNull();
    stubNetwork(() => new Response("<html>not found</html>", { status: 404 }));
    await expect(fetchThreadKnowledge(THREAD)).rejects.toMatchObject({ code: null, status: 404 });
  });
});

/* ── 面板 ─────────────────────────────────────────────────────────── */

describe("记忆面板（真实数据）", () => {
  it("加载态 → 按类型分组，带三态徽标与来源计数；头部常驻可见范围「仅你可见」", async () => {
    let release: (r: Response) => void = () => {};
    stubNetwork((p) => (p.startsWith("/knowledge-graph/threads/") ? new Promise<Response>((r) => { release = r; }) : undefined));
    render(<Harness threadId={THREAD} />);
    expect(screen.getByTestId("loading")).toBeInTheDocument();

    await act(async () => { release(json(knowledge())); });
    const list = await screen.findByTestId("kg-list");
    expect(screen.queryByTestId("loading")).not.toBeInTheDocument();

    // 分组：决定 / 事实 / 待办 / 风险，各含对应条目
    expect(within(screen.getByTestId("kg-group-decision")).getByText("王五决定周五发版。")).toBeInTheDocument();
    expect(within(screen.getByTestId("kg-group-fact")).getByText("客户 B 需要中文界面。")).toBeInTheDocument();
    expect(within(screen.getByTestId("kg-group-todo")).getByText("赵六整理发版清单。")).toBeInTheDocument();
    expect(within(screen.getByTestId("kg-group-risk")).getByText("周五发版可能赶不上测试。")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-group-hypothesis")).not.toBeInTheDocument();

    // 三态徽标：文案来自契约单源
    const decide = screen.getByTestId("kg-claim-c-decide");
    expect(within(decide).getByTestId("kg-tri-state-confirmed")).toHaveTextContent("你确认过");
    expect(within(screen.getByTestId("kg-claim-c-fact")).getByTestId("kg-tri-state-pending")).toHaveTextContent("AI 记下的");
    expect(within(screen.getByTestId("kg-claim-c-risk")).getByTestId("kg-tri-state-conflict")).toHaveTextContent("有矛盾");
    // 来源计数
    expect(decide).toHaveTextContent("证据 3");
    expect(list).toBeInTheDocument();

    expect(screen.getByTestId("kg-panel-title")).toHaveTextContent("记忆（4）");
    expect(screen.getByTestId("kg-visibility")).toHaveTextContent("仅你可见");
  });

  it("会话成员可见的线程：头部写「会话成员可见」", async () => {
    stubNetwork(() => json(knowledge({ visibility: "thread_members" })));
    render(<Harness threadId={THREAD} />);
    expect(await screen.findByTestId("kg-visibility")).toHaveTextContent("会话成员可见");
  });

  it("列表 ↔ 图切换：图视图把节点交给 React Flow，列表消失；切回来列表还在", async () => {
    stubNetwork(() => json(knowledge()));
    render(<Harness threadId={THREAD} />);
    await screen.findByTestId("kg-list");

    fireEvent.click(screen.getByTestId("kg-view-graph"));
    expect(screen.queryByTestId("kg-list")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("xyflow-stub-canvas")).toBeInTheDocument());
    // 2 个人和事 + 4 条记下的
    expect(screen.getByTestId("xyflow-stub-node-count")).toHaveTextContent("6");
    expect(screen.getByTestId("xyflow-stub-edge-count")).toHaveTextContent("1");
    expect(screen.getByTestId("kg-view-graph")).toHaveAttribute("data-active", "true");

    fireEvent.click(screen.getByTestId("kg-view-list"));
    expect(screen.getByTestId("kg-list")).toBeInTheDocument();
    expect(screen.queryByTestId("xyflow-stub-canvas")).not.toBeInTheDocument();
  });

  it("点一条打开来源抽屉：经 getClaimSources 取证据摘录与溯源", async () => {
    stubNetwork((p) => {
      if (p === `/knowledge-graph/threads/${THREAD}`) return json(knowledge());
      if (p === "/knowledge-graph/claims/c-decide/sources") return json(SOURCES);
      return undefined;
    });
    render(<Harness threadId={THREAD} />);
    await screen.findByTestId("kg-list");
    expect(screen.queryByTestId("kg-source-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("kg-claim-open-c-decide"));
    const drawer = await screen.findByTestId("kg-source-drawer");
    await waitFor(() => expect(within(drawer).getByTestId("kg-evidence-seg-1")).toHaveTextContent("那就定了，周五发版。"));
    expect(within(drawer).getByTestId("kg-source-statement")).toHaveTextContent("王五决定周五发版。");
    expect(within(drawer).getByTestId("kg-source-provenance")).toHaveTextContent("从对话中记下");
    expect(calledPaths()).toContain("/knowledge-graph/claims/c-decide/sources");

    fireEvent.click(within(drawer).getByTestId("kg-source-drawer-close"));
    expect(screen.queryByTestId("kg-source-drawer")).not.toBeInTheDocument();
  });

  it("来源读取失败：抽屉显示人话错误，不显示空证据", async () => {
    stubNetwork((p) => (p.endsWith("/sources") ? failure(404, "KG_CLAIM_NOT_FOUND") : json(knowledge())));
    render(<Harness threadId={THREAD} />);
    await screen.findByTestId("kg-list");
    fireEvent.click(screen.getByTestId("kg-claim-open-c-fact"));
    expect(await screen.findByTestId("kg-source-drawer-error")).toHaveTextContent("这一条已经不在了");
    expect(screen.queryByTestId("kg-source-evidence-list")).not.toBeInTheDocument();
  });

  it("只读（canEdit=false）：显示「只读」，不渲染任何编辑入口——即便写动作可用", () => {
    const writeActions = { apply: vi.fn(async () => {}), onPromote: vi.fn(), onReindex: vi.fn() };
    const { unmount } = render(
      <KnowledgePanel status="ready" data={knowledge({ canEdit: false, visibility: "thread_members" })} writeActions={writeActions} />,
    );
    expect(screen.getByTestId("kg-readonly-badge")).toHaveTextContent("只读");
    expect(screen.getByTestId("kg-claim-c-fact")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-row-yes-c-fact")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-claim-edit-trigger-c-fact")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-confirm-all")).not.toBeInTheDocument();
    unmount();

    // 反证：同样的写动作、canEdit=true 时编辑入口确实会出现——上面的「没有」不是因为根本画不出来
    render(<KnowledgePanel status="ready" data={knowledge()} writeActions={writeActions} />);
    expect(screen.queryByTestId("kg-readonly-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-row-yes-c-fact")).toBeInTheDocument();
    expect(screen.getByTestId("kg-claim-edit-trigger-c-fact")).toBeInTheDocument();
  });

  it("真实 /chat：所有者有编辑入口（F10）与「记到长期记忆」（F11），「整理」还没有通路就不画", async () => {
    stubNetwork(() => json(knowledge({ canPromote: true, ingestion: { queued: 0, running: 0, failed: 1, failures: [] } })));
    render(<Harness threadId={THREAD} />);
    await screen.findByTestId("kg-list");
    expect(screen.queryByTestId("kg-readonly-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-row-yes-c-fact")).toBeInTheDocument();
    expect(screen.getByTestId("kg-promote-enter")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-ingestion-retry")).not.toBeInTheDocument();
  });

  it("空态：本会话还没记下任何东西", async () => {
    stubNetwork(() => json(knowledge({ claims: [], objects: [], edges: [] })));
    render(<Harness threadId={THREAD} />);
    expect(await screen.findByTestId("empty")).toHaveTextContent("现在还没有");
    expect(screen.queryByTestId("kg-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-panel-title")).toHaveTextContent("记忆（0）");
  });

  it("错误态：KG_NOT_VISIBLE 显示无权说明；「重试」重新读取并恢复", async () => {
    let calls = 0;
    stubNetwork(() => (++calls === 1 ? failure(403, "KG_NOT_VISIBLE") : json(knowledge())));
    render(<Harness threadId={THREAD} />);
    const err = await screen.findByTestId("err-panel");
    expect(err).toHaveTextContent("你没有这条对话的访问权限");
    expect(screen.queryByTestId("kg-list")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("kg-error-retry"));
    await screen.findByTestId("kg-list");
    expect(screen.queryByTestId("err-panel")).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("错误态：KG_THREAD_NOT_FOUND / 非本束失败各有各的说法", async () => {
    stubNetwork(() => failure(404, "KG_THREAD_NOT_FOUND"));
    const { unmount } = render(<Harness threadId={THREAD} />);
    expect(await screen.findByTestId("kg-error-reason")).toHaveTextContent("对话不存在或已被删除");
    unmount();
    stubNetwork(() => new Response("bad gateway", { status: 502 }));
    render(<Harness threadId={THREAD} />);
    expect(await screen.findByTestId("kg-error-reason")).toHaveTextContent("记忆服务暂时连不上");
  });

  it(`超过 ${String(KG_GRAPH_VIEW_MAX_NODES)} 个节点：图视图折叠为簇，不把几百个节点交给 React Flow`, async () => {
    const bulk: KgObject[] = Array.from({ length: 260 }, (_, i) =>
      object(`obj-bulk-${String(i)}`, i % 2 === 0 ? "person" : "concept", `节点 ${String(i + 1)}`),
    );
    stubNetwork(() => json(knowledge({ objects: bulk })));
    render(<Harness threadId={THREAD} />);
    await screen.findByTestId("kg-list");
    fireEvent.click(screen.getByTestId("kg-view-graph"));

    const oversize = screen.getByTestId("kg-graph-oversize");
    expect(oversize).toHaveAttribute("data-node-count", "264");
    expect(screen.queryByTestId("xyflow-stub-canvas")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-graph-cluster-object-person")).toHaveAttribute("data-count", "130");
    expect(screen.getByTestId("kg-graph-cluster-object-concept")).toHaveAttribute("data-count", "130");
    expect(screen.getByTestId("kg-graph-cluster-claim-confirmed")).toHaveTextContent("你确认过");
    expect(screen.getByTestId("kg-graph-cluster-claim-pending")).toHaveAttribute("data-count", "2");
    expect(screen.getByTestId("kg-graph-cluster-claim-conflict")).toHaveAttribute("data-count", "1");

    fireEvent.click(screen.getByTestId("kg-graph-force-expand"));
    await waitFor(() => expect(screen.getByTestId("xyflow-stub-node-count")).toHaveTextContent("264"));
  });

  it("没到上限（恰好 200 个）不折叠", async () => {
    const bulk = Array.from({ length: 196 }, (_, i) => object(`o-${String(i)}`, "term", `词 ${String(i)}`));
    stubNetwork(() => json(knowledge({ objects: bulk })));
    render(<Harness threadId={THREAD} />);
    await screen.findByTestId("kg-list");
    fireEvent.click(screen.getByTestId("kg-view-graph"));
    expect(screen.queryByTestId("kg-graph-oversize")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("xyflow-stub-node-count")).toHaveTextContent("200"));
  });
});

/* ── 回答下 U-1 ───────────────────────────────────────────────────── */

describe("回答下「已记下 N 条 · 查看 · 撤销」（getTurnMemory）", () => {
  const TURN_PATH = `/knowledge-graph/threads/${THREAD}/messages/msg-9/memory`;

  it("captured > 0：渲染一行；「查看」打开记忆面板；没有所有者快照时不画「撤销」", async () => {
    stubNetwork((p) => (p === TURN_PATH
      ? json(turn({ captured: [{ claimId: "c-decide", statement: "王五决定周五发版。" }, { claimId: "c-todo", statement: "赵六整理发版清单。" }] }))
      : undefined));
    const opened = vi.fn();
    window.addEventListener(OPEN_KNOWLEDGE_PANEL_EVENT, opened);
    try {
      render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
      const line = await screen.findByTestId("kg-turn-captured");
      expect(line).toHaveTextContent("已记下 2 条");
      expect(screen.queryByTestId("kg-turn-captured-undo")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("kg-turn-captured-view"));
      expect(opened).toHaveBeenCalledTimes(1);
      expect(calledPaths()).toEqual([TURN_PATH]);
    } finally {
      window.removeEventListener(OPEN_KNOWLEDGE_PANEL_EVENT, opened);
    }
  });

  it("captured = 0 且不在整理：什么都不渲染，也不补读", async () => {
    stubNetwork(() => json(turn()));
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("kg-turn-captured")).not.toBeInTheDocument();
  });

  it("读失败：不在回答下挂报错，整行不渲染", async () => {
    stubNetwork(() => failure(403, "KG_NOT_VISIBLE"));
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });
    expect(container).toBeEmptyDOMElement();
  });

  it("整理中：先显示「正在记…」，补读到结果后变成「已记下 N 条」；补读次数有上限", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let calls = 0;
    stubNetwork(() => {
      calls += 1;
      return calls === 1
        ? json(turn({ pending: true }))
        : json(turn({ captured: [{ claimId: "c-fact", statement: "客户 B 需要中文界面。" }] }));
    });
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    expect(await screen.findByTestId("kg-turn-pending")).toHaveTextContent("正在记");
    await act(async () => { await vi.advanceTimersByTimeAsync(TURN_MEMORY_REPOLL_DELAYS_MS[0] ?? 0); });
    expect(await screen.findByTestId("kg-turn-captured")).toHaveTextContent("已记下 1 条");
    expect(calls).toBe(2);
  });

  it("一直在整理：补读用完就停，不挂一个永远转圈的「正在记…」", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubNetwork(() => json(turn({ pending: true })));
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    await screen.findByTestId("kg-turn-pending");
    const total = TURN_MEMORY_REPOLL_DELAYS_MS.reduce((a, b) => a + b, 0);
    await act(async () => { await vi.advanceTimersByTimeAsync(total + 1_000); });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(fetchMock).toHaveBeenCalledTimes(TURN_MEMORY_REPOLL_DELAYS_MS.length + 1);
  });
});

/* ── 右栏「记忆」页签 ─────────────────────────────────────────────── */

describe("右栏「记忆」页签（web 侧页签，不改聊天契约的五标签）", () => {
  const inspectorProps = {
    hasSelection: true,
    threadId: THREAD,
    artifacts: null,
    materials: null,
    loading: false,
    artifactsError: null,
    materialsError: null,
    onRetry: () => {},
    pendingMaterialsCount: 0,
    planTodos: null,
    isRunning: false,
    runPhaseLabel: null,
    runStartedAt: null,
  } as const;

  it("开了记忆页签：角标 = claims.length；点开是真实面板；「查看」事件切到这个页签", async () => {
    stubNetwork((p) => (p.startsWith("/knowledge-graph/threads/") ? json(knowledge()) : undefined));
    render(<ChatTaskInspector {...inspectorProps} showKnowledge />);
    const tab = screen.getByTestId("chat-task-workbench-inspector-tab-memory");
    expect(tab).toHaveAttribute("role", "tab");
    expect(tab).toHaveAttribute("aria-label", "记忆");
    expect(await screen.findByTestId("chat-task-workbench-inspector-tab-memory-count")).toHaveTextContent("4");

    act(() => { requestOpenKnowledgePanel(); });
    expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-active-tab", "memory");
    expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-collapsed", "false");
    expect(await screen.findByTestId("kg-list")).toBeInTheDocument();
    expect(screen.getByTestId("kg-visibility")).toHaveTextContent("仅你可见");
  });

  it("没开（旧轨道 / 未选线程）：不渲染页签，也不发请求", () => {
    stubNetwork(() => undefined);
    render(<ChatTaskInspector {...inspectorProps} />);
    expect(screen.queryByTestId("chat-task-workbench-inspector-tab-memory")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* ── R5 用词 ──────────────────────────────────────────────────────── */

describe("界面文案不含 R5 禁用词（扫渲染出来的文字）", () => {
  it("列表 / 只读 / 错误 / 空 / 超限簇 / 来源抽屉 / 回答下一行", async () => {
    stubNetwork((p) => {
      if (p.endsWith("/sources")) return json(SOURCES);
      if (p.endsWith("/memory")) return json(turn({ captured: [{ claimId: "c-fact", statement: "客户 B 需要中文界面。" }] }));
      return json(knowledge());
    });
    const writeActions = { apply: vi.fn(async () => {}), onPromote: vi.fn(), onReindex: vi.fn() };
    const bulk = Array.from({ length: 230 }, (_, i) => object(`b-${String(i)}`, "metric", `指标 ${String(i)}`));
    const { container } = render(
      <div>
        <div data-testid="harness"><Harness threadId={THREAD} /></div>
        <KnowledgePanel status="ready" data={knowledge({ canEdit: false, canPromote: false })} />
        <KnowledgePanel status="ready" data={knowledge({ canPromote: true, ingestion: { queued: 1, running: 1, failed: 1, failures: [] } })} writeActions={writeActions} />
        <KnowledgePanel status="ready" data={knowledge({ claims: [], objects: [], edges: [] })} writeActions={writeActions} />
        <KnowledgePanel status="error" data={null} errorCode="KG_NOT_VISIBLE" onRetry={() => {}} />
        <KnowledgePanel status="error" data={null} errorCode="KG_THREAD_NOT_FOUND" onRetry={() => {}} />
        <KnowledgePanel status="error" data={null} errorCode={null} onRetry={() => {}} />
        <KnowledgePanel status="loading" data={null} />
        <KnowledgePanel status="ready" data={knowledge({ objects: bulk })} initialView="graph" />
        <TurnMemoryLine threadId={THREAD} messageId="msg-9" />
      </div>,
    );
    await screen.findByTestId("kg-turn-captured");
    const harness = screen.getByTestId("harness");
    await waitFor(() => expect(within(harness).getByTestId("kg-list")).toBeInTheDocument());
    fireEvent.click(within(harness).getByTestId("kg-claim-open-c-decide"));
    await within(harness).findByTestId("kg-evidence-seg-1");

    const copy = visibleCopy(container);
    expect(copy).toContain("记忆");
    for (const word of KG_BANNED_USER_FACING_WORDS) {
      expect(copy, `界面出现了禁用词「${word}」`).not.toContain(word);
    }
  });
});
