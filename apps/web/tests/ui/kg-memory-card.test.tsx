/**
 * phase-18 F17 —— 回答下的「记住 / 忘掉」确认卡（U-4，uc-18-6 A / B / E1 / E2；R5 只有所有者能点）。
 *
 * 两层：
 *  · `MemoryCard` 本身：记住卡可改字（改了才带 editedStatement）、忘掉卡默认全选 / 可取消勾选（全选时不带 claimIds）、
 *    「不用了」、失败给人话且按钮恢复、处理中不连发、非所有者只读、四种结局（已记住 · 撤销 / 已忘掉 / 不用了 / 过期）。
 *  · 经 `TurnMemoryLine` 的真实接线：数据来自 `getTurnMemory.prompt.memory_card`（契约 `out` 校验），点击发出的是
 *    **真实请求体** `actOnMemoryCard`（经契约 `in` 校验），成功后让记忆面板重读；过期 ⇒ 重读这一轮、卡片显示「内容已经变了」；
 *    撤销 = `applyHumanAction{revokeClaim}`（版本号点击时现取）。网络在 `fetch` 层打桩成一个有状态的小服务端。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { knowledgeGraph, type KgHumanAction, type KgMemoryCard } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { MemoryCard } from "@/components/chat/knowledge/memory-card";
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { onKnowledgeReload, publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";

const THREAD = "thr-kg-card";
const REMEMBER: KgMemoryCard = {
  cardId: "card-r1", kind: "remember", state: "open",
  items: [{ claimId: null, statement: "客户A的对接人是王经理" }],
};
const FORGET: KgMemoryCard = {
  cardId: "card-f1", kind: "forget", state: "open",
  items: [
    { claimId: "c-1", statement: "王经理负责审批合同" },
    { claimId: "c-2", statement: "客户A的对接人是王经理" },
    { claimId: "c-3", statement: "王经理下周休假" },
  ],
};

/* ── 卡片本身 ─────────────────────────────────────────────────────── */

describe("MemoryCard：记住卡", () => {
  it("不改字点「记住」⇒ 交出 accept、不带 editedStatement；成功后变「已记住 · 撤销」", async () => {
    const onAct = vi.fn(async () => ({ ...REMEMBER, state: "done" as const, items: [{ claimId: "c-new", statement: REMEMBER.items[0]!.statement }] }));
    render(<MemoryCard card={REMEMBER} canAct onAct={onAct} onUndo={vi.fn(async () => "undone" as const)} />);
    expect(screen.getByTestId("kg-card-remember")).toHaveTextContent("要记到你的长期记忆吗？");
    expect(screen.getByTestId("kg-card-remember-text")).toHaveValue("客户A的对接人是王经理");
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    const done = await screen.findByTestId("kg-card-done");
    expect(done).toHaveTextContent("已记住");
    expect(within(done).getByTestId("kg-card-undo")).toBeInTheDocument();
    expect(onAct).toHaveBeenCalledWith("accept", {});
  });

  it("改了字 ⇒ 交出修剪过的新文字；清空 ⇒「记住」不可点", async () => {
    const onAct = vi.fn(async () => ({ ...REMEMBER, state: "done" as const, items: [{ claimId: "c-new", statement: "x" }] }));
    render(<MemoryCard card={REMEMBER} canAct onAct={onAct} />);
    fireEvent.change(screen.getByTestId("kg-card-remember-text"), { target: { value: "   " } });
    expect(screen.getByTestId("kg-card-accept")).toBeDisabled();
    fireEvent.change(screen.getByTestId("kg-card-remember-text"), { target: { value: " 客户A的对接人是王经理，电话找他 " } });
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    await screen.findByTestId("kg-card-done");
    expect(onAct).toHaveBeenCalledWith("accept", { editedStatement: "客户A的对接人是王经理，电话找他" });
  });

  it("「不用了」⇒ 交出 dismiss，卡片收成一行", async () => {
    const onAct = vi.fn(async () => ({ ...REMEMBER, state: "dismissed" as const }));
    render(<MemoryCard card={REMEMBER} canAct onAct={onAct} />);
    fireEvent.click(screen.getByTestId("kg-card-dismiss"));
    expect(await screen.findByTestId("kg-card-dismissed")).toHaveTextContent("好的，这条没有记在长期记忆里");
    expect(onAct).toHaveBeenCalledWith("dismiss", {});
  });

  it("撤销：交出刚记下的那条 id，成功后说「已撤销」、不再给撤销；失败给人话", async () => {
    const onUndo = vi.fn().mockRejectedValueOnce(new Error("内容已变化，已为你刷新到最新，请再操作一次。")).mockResolvedValueOnce("undone");
    render(<MemoryCard card={{ ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "x" }] }} canAct onAct={vi.fn()} onUndo={onUndo} />);
    fireEvent.click(screen.getByTestId("kg-card-undo"));
    expect(await screen.findByTestId("kg-card-error")).toHaveTextContent("内容已变化");
    fireEvent.click(screen.getByTestId("kg-card-undo"));
    await waitFor(() => expect(screen.getByTestId("kg-card-done")).toHaveTextContent("已撤销"));
    expect(screen.queryByTestId("kg-card-undo")).not.toBeInTheDocument();
    expect(onUndo).toHaveBeenCalledWith("c-new");
  });

  it.each([
    ["kept", "长期记忆里这条还有别的来源，所以还在"],
    ["not_undoable", "没法只撤这一次"],
  ] as const)("撤销的结果以服务端为准：%s ⇒ 照实说，不说「没有记到长期记忆」", async (outcome, text) => {
    render(<MemoryCard card={{ ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "x" }] }} canAct onAct={vi.fn()} onUndo={vi.fn(async () => outcome)} />);
    fireEvent.click(screen.getByTestId("kg-card-undo"));
    await waitFor(() => expect(screen.getByTestId("kg-card-done")).toHaveTextContent(text));
    expect(screen.getByTestId("kg-card-done")).not.toHaveTextContent("没有记到长期记忆");
    expect(screen.queryByTestId("kg-card-undo")).not.toBeInTheDocument();
  });

  it("已记住、但服务端没给 claimId（用的是原来就有的那条 / 并进了长期记忆里原来就有的那条）⇒ 只说「已记住」、不给撤销", () => {
    render(<MemoryCard card={{ ...REMEMBER, state: "done" }} canAct onAct={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByTestId("kg-card-done")).toHaveTextContent("已记住");
    expect(screen.getByTestId("kg-card-done")).not.toHaveTextContent("撤销");
    expect(screen.queryByTestId("kg-card-undo")).not.toBeInTheDocument();
  });

  it("长期记忆里那条后来不在了（服务端读作 dismissed）⇒ 说「这条没有记在长期记忆里」", () => {
    render(<MemoryCard card={{ ...REMEMBER, state: "dismissed" }} canAct onAct={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByTestId("kg-card-dismissed")).toHaveTextContent("这条没有记在长期记忆里");
  });

  it("不是对话创建者：已记住的卡上没有撤销", () => {
    render(<MemoryCard card={{ ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "x" }] }} canAct={false} onAct={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByTestId("kg-card-done")).toHaveTextContent("已记住");
    expect(screen.queryByTestId("kg-card-undo")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("失败：卡片上给那句人话，按钮恢复可以再试；处理中不连发", async () => {
    let finish: (c: KgMemoryCard) => void = () => {};
    const onAct = vi.fn()
      .mockRejectedValueOnce(new Error("只有对话创建者能管理记忆。"))
      .mockImplementationOnce(() => new Promise<KgMemoryCard>((r) => { finish = r; }));
    render(<MemoryCard card={REMEMBER} canAct onAct={onAct} />);
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    expect(await screen.findByTestId("kg-card-error")).toHaveTextContent("只有对话创建者能管理记忆。");
    expect(screen.getByTestId("kg-card-accept")).toBeEnabled();
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    await waitFor(() => expect(screen.getByTestId("kg-card-accept")).toBeDisabled());
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    fireEvent.click(screen.getByTestId("kg-card-dismiss"));
    expect(onAct).toHaveBeenCalledTimes(2);
    finish({ ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "x" }] });
    await screen.findByTestId("kg-card-done");
    expect(document.body.textContent).not.toContain("KG_");
  });

  it("不是对话创建者：只看到要记的内容，没有输入框、没有按钮", () => {
    render(<MemoryCard card={REMEMBER} canAct={false} onAct={vi.fn()} />);
    const card = screen.getByTestId("kg-card-remember");
    expect(within(card).getByTestId("kg-card-remember-readonly")).toHaveTextContent("客户A的对接人是王经理");
    expect(within(card).queryAllByRole("button")).toEqual([]);
    expect(within(card).queryByRole("textbox")).toBeNull();
  });

  it("过期（E2）：只提示「内容已经变了」，没有按钮", () => {
    render(<MemoryCard card={{ ...REMEMBER, state: "stale" }} canAct onAct={vi.fn()} />);
    expect(screen.getByTestId("kg-card-stale")).toHaveTextContent("这张卡上的内容已经变了");
    expect(screen.queryAllByRole("button")).toEqual([]);
  });
});

describe("MemoryCard：忘掉卡", () => {
  it("逐条列出、默认全选；全选时点「忘掉」不带 claimIds（= 卡上全部）", async () => {
    const onAct = vi.fn(async () => ({ ...FORGET, state: "done" as const }));
    render(<MemoryCard card={FORGET} canAct onAct={onAct} />);
    for (const id of ["c-1", "c-2", "c-3"]) expect(screen.getByTestId(`kg-card-forget-check-${id}`)).toBeChecked();
    expect(screen.getByTestId("kg-card-accept")).toHaveTextContent("忘掉（3）");
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    expect(await screen.findByTestId("kg-card-done")).toHaveTextContent("已忘掉 3 条");
    expect(onAct).toHaveBeenCalledWith("accept", {});
  });

  it("取消勾选一条 ⇒ 只交出还勾着的；全部取消 ⇒「忘掉」不可点", async () => {
    const onAct = vi.fn(async () => ({ ...FORGET, state: "done" as const, items: FORGET.items.filter((i) => i.claimId !== "c-2") }));
    render(<MemoryCard card={FORGET} canAct onAct={onAct} />);
    for (const id of ["c-1", "c-2", "c-3"]) fireEvent.click(screen.getByTestId(`kg-card-forget-check-${id}`));
    expect(screen.getByTestId("kg-card-accept")).toBeDisabled();
    expect(screen.getByTestId("kg-card-accept")).toHaveTextContent("忘掉（0）");
    fireEvent.click(screen.getByTestId("kg-card-forget-check-c-1"));
    fireEvent.click(screen.getByTestId("kg-card-forget-check-c-3"));
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    expect(await screen.findByTestId("kg-card-done")).toHaveTextContent("已忘掉 2 条");
    expect(onAct).toHaveBeenCalledWith("accept", { claimIds: ["c-1", "c-3"] });
  });

  it("不是对话创建者：只看到列表，没有勾选框、没有按钮", () => {
    render(<MemoryCard card={FORGET} canAct={false} onAct={vi.fn()} />);
    const card = screen.getByTestId("kg-card-forget");
    expect(card).toHaveTextContent("王经理负责审批合同");
    expect(within(card).queryAllByRole("checkbox")).toEqual([]);
    expect(within(card).queryAllByRole("button")).toEqual([]);
  });
});

/* ── 经 TurnMemoryLine 的真实接线（getTurnMemory → actOnMemoryCard） ───── */

interface Server {
  revision: number;
  card: KgMemoryCard | null;
  cardCalls: { cardId: string; body: Record<string, unknown> }[];
  actions: { basedOnRevision: number; action: KgHumanAction }[];
  onCard: (body: Record<string, unknown>) => Response | undefined;
  turnReads: number;
  /** true ⇒ getTurnMemory 这一轮回的是矛盾卡（I-18 冲突卡优先），读不到记忆卡 */
  conflictInstead?: boolean;
  /** 撤销之后服务端读回的卡（缺省：长期记忆里那条没了 ⇒ dismissed） */
  afterUndo?: KgMemoryCard;
}
let server: Server;
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const failure = (status: number, reasonCode: string) => json({ error: "rejected", traceId: "t-1", reasonCode }, status);

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-card");
  server = { revision: 7, card: REMEMBER, cardCalls: [], actions: [], onCard: () => undefined, turnReads: 0 };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}/messages/msg-5/memory`) {
      server.turnReads += 1;
      return json(knowledgeGraph.getTurnMemory.out.parse({
        messageId: "msg-5", captured: [], pending: false, supersede: null, recalled: [], recallDegraded: false,
        prompt: server.conflictInstead === true
          ? { type: "conflict", conflict: { promptId: "kgp-x", newerClaim: { id: "c-n", statement: "新" }, olderClaim: { id: "c-o", statement: "旧", saidAt: "2026-09-20T00:00:00Z" } } }
          : server.card === null ? null : { type: "memory_card", card: server.card },
      }));
    }
    if (path === `/knowledge-graph/threads/${THREAD}` && (init?.method ?? "GET") === "GET") {
      return json(knowledgeGraph.getThreadKnowledge.out.parse({
        scope: { kind: "chat_session", id: THREAD }, revision: server.revision, objects: [], claims: [], edges: [],
        ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only",
        extractionActive: true,
      }));
    }
    if (path.startsWith("/knowledge-graph/cards/") && init?.method === "POST") {
      const cardId = decodeURIComponent(path.slice("/knowledge-graph/cards/".length));
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      // 请求体必须是契约 in（cardId 在路径里）
      knowledgeGraph.actOnMemoryCard.in.parse({ ...body, cardId });
      server.cardCalls.push({ cardId, body });
      const override = server.onCard(body);
      if (override) return override;
      const card = server.card!;
      const next: KgMemoryCard = body.decision === "dismiss"
        ? { ...card, state: "dismissed" }
        : card.kind === "remember"
          ? { ...card, state: "done", items: [{ claimId: "c-new", statement: String(body.editedStatement ?? card.items[0]!.statement) }] }
          : { ...card, state: "done", items: card.items.filter((i) => body.claimIds === undefined || (body.claimIds as string[]).includes(i.claimId!)) };
      server.card = next;
      return json(knowledgeGraph.actOnMemoryCard.out.parse({ card: next, actionIds: ["act-1"] }));
    }
    if (path === `/knowledge-graph/threads/${THREAD}/actions` && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Server["actions"][number];
      server.actions.push(body);
      server.revision += 1;
      if (server.card !== null && body.action.type === "revokeClaim" && server.card.items[0]?.claimId === body.action.claimId) {
        server.card = server.afterUndo ?? { ...server.card, state: "dismissed", items: [{ claimId: null, statement: server.card.items[0]!.statement }] };
      }
      return json({ revision: server.revision, actionId: `act-${String(server.actions.length)}` });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  publishKnowledgeSnapshot(null);
});

const owner = () => publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 1 });

describe("TurnMemoryLine：本轮的「记住 / 忘掉」卡", () => {
  it("记住（改了字）：发出 actOnMemoryCard{accept, editedStatement}，成功后「已记住」、记忆面板重读", async () => {
    owner();
    const reloads: string[] = [];
    const off = onKnowledgeReload((t) => reloads.push(t));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    fireEvent.change(await screen.findByTestId("kg-card-remember-text"), { target: { value: "客户A的对接人是王经理，电话找他" } });
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    expect(await screen.findByTestId("kg-card-done")).toHaveTextContent("已记住");
    expect(server.cardCalls).toEqual([{ cardId: "card-r1", body: { decision: "accept", editedStatement: "客户A的对接人是王经理，电话找他" } }]);
    expect(reloads).toEqual([THREAD]);
    off();
  });

  it("已记住 · 撤销：发出 revokeClaim（刚记下的那条），版本号是点击时现取的", async () => {
    owner();
    server.card = { ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "客户A的对接人是王经理" }] };
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    fireEvent.click(await screen.findByTestId("kg-card-undo"));
    await waitFor(() => expect(screen.getByTestId("kg-card-done")).toHaveTextContent("已撤销，这条没有记到长期记忆"));
    expect(server.actions).toEqual([{ basedOnRevision: 7, action: { type: "revokeClaim", claimId: "c-new", reason: "user_undo_remember" } }]);
  });

  it("撤销前服务端已经不给撤（长期记忆里这条后来有了别的来源）⇒ 不发 revokeClaim，照实说撤不掉", async () => {
    owner();
    server.card = { ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "客户A的对接人是王经理" }] };
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    const undo = await screen.findByTestId("kg-card-undo");
    server.card = { ...REMEMBER, state: "done", items: [{ claimId: null, statement: "客户A的对接人是王经理" }] };
    fireEvent.click(undo);
    await waitFor(() => expect(screen.getByTestId("kg-card-done")).toHaveTextContent("没法只撤这一次"));
    expect(server.actions).toEqual([]);
  });

  it("撤之前卡已经读作 dismissed（别的标签页撤过了）⇒ 不再发 revokeClaim，显示「已撤销」", async () => {
    owner();
    server.card = { ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "客户A的对接人是王经理" }] };
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    const undo = await screen.findByTestId("kg-card-undo");
    server.card = { ...REMEMBER, state: "dismissed", items: [{ claimId: null, statement: "客户A的对接人是王经理" }] };
    fireEvent.click(undo);
    await waitFor(() => expect(screen.getByTestId("kg-card-done")).toHaveTextContent("已撤销，这条没有记到长期记忆"));
    expect(server.actions).toEqual([]);
  });

  it("这一轮现在出的是矛盾卡（I-18），读不到这张记忆卡 ⇒ 照撤，但只说中性的「已撤销这次的记住」", async () => {
    owner();
    server.card = { ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "客户A的对接人是王经理" }] };
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    const undo = await screen.findByTestId("kg-card-undo");
    server.conflictInstead = true;
    fireEvent.click(undo);
    await waitFor(() => expect(screen.getByTestId("kg-card-done")).toHaveTextContent("已撤销这次的记住"));
    expect(screen.getByTestId("kg-card-done")).not.toHaveTextContent("没有记到长期记忆");
    expect(screen.getByTestId("kg-card-done")).not.toHaveTextContent("没法只撤");
    expect(screen.getByTestId("kg-card-done")).not.toHaveTextContent("还在");
    expect(server.actions.map((a) => a.action)).toEqual([{ type: "revokeClaim", claimId: "c-new", reason: "user_undo_remember" }]);
  });

  it("撤的同时别处又记了一次（撤完服务端读回仍是已记住）⇒ 说「还在」，不说「没有记到长期记忆」", async () => {
    owner();
    server.card = { ...REMEMBER, state: "done", items: [{ claimId: "c-new", statement: "客户A的对接人是王经理" }] };
    server.afterUndo = { ...REMEMBER, state: "done", items: [{ claimId: null, statement: "客户A的对接人是王经理" }] };
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    fireEvent.click(await screen.findByTestId("kg-card-undo"));
    await waitFor(() => expect(screen.getByTestId("kg-card-done")).toHaveTextContent("所以还在"));
    expect(server.actions).toHaveLength(1);
  });

  it("忘掉（取消勾选一条）：请求体只带还勾着的", async () => {
    owner();
    server.card = FORGET;
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    fireEvent.click(await screen.findByTestId("kg-card-forget-check-c-2"));
    fireEvent.click(screen.getByTestId("kg-card-accept"));
    expect(await screen.findByTestId("kg-card-done")).toHaveTextContent("已忘掉 2 条");
    expect(server.cardCalls).toEqual([{ cardId: "card-f1", body: { decision: "accept", claimIds: ["c-1", "c-3"] } }]);
  });

  it("过期（KG_CARD_STALE）⇒ 人话，并重读这一轮：卡片变成「内容已经变了」", async () => {
    owner();
    server.card = FORGET;
    server.onCard = () => {
      server.card = { ...FORGET, state: "stale" };
      return failure(409, "KG_CARD_STALE");
    };
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    fireEvent.click(await screen.findByTestId("kg-card-accept"));
    expect(await screen.findByTestId("kg-card-stale")).toHaveTextContent("这张卡上的内容已经变了");
    expect(server.turnReads).toBe(2);
    expect(document.body.textContent).not.toContain("KG_");
  });

  it.each([
    [403, "KG_NOT_OWNER", "只有对话创建者能管理记忆。"],
    [409, "KG_CONTESTED_NEEDS_RESOLUTION", "这条和你之前说的有矛盾"],
    [403, "KG_ACTOR_NOT_HUMAN", "这个操作只能由你本人在界面上完成。"],
    [500, "INTERNAL", "没能完成这次操作，请稍后重试。"],
  ])("服务端拒绝（%s %s）⇒ 卡片上是人话，内部码不上屏，卡还能再点", async (status, code, text) => {
    owner();
    server.onCard = () => failure(status, code);
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    fireEvent.click(await screen.findByTestId("kg-card-accept"));
    expect(await screen.findByTestId("kg-card-error")).toHaveTextContent(text);
    expect(document.body.textContent).not.toContain("KG_");
    expect(screen.getByTestId("kg-card-accept")).toBeEnabled();
    expect(server.turnReads).toBe(1);
  });

  it("非所有者：卡片只读，没有按钮；不发任何写请求", async () => {
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: false, revision: 1 });
    server.card = FORGET;
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    const card = await screen.findByTestId("kg-card-forget");
    expect(within(card).queryAllByRole("button")).toEqual([]);
    expect(within(card).queryAllByRole("checkbox")).toEqual([]);
    expect(server.cardCalls).toEqual([]);
  });

  it("这一轮没有卡：不画卡（也不画别的）", async () => {
    owner();
    server.card = null;
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-5" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
