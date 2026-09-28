/**
 * Issue #4361（phase-18 S4）—— 在对话里管理记忆的两块界面：
 *  · 忘掉卡生效之后「已忘掉 N 条 · 撤销」（`undoMemoryCard`），撤销后「都恢复了」；非所有者没有撤销；失败给人话；
 *  · 「你记得我什么」的清单卡（`kind = overview`）：按种类分组（契约次序）、每条带来源对话链接 / 「长期记忆」，没有任何按钮，
 *    用词不出内部术语；
 *  · 经 `TurnMemoryLine` 的真实接线：点「撤销」发出的是 POST /knowledge-graph/cards/:cardId/undo（契约 in / out 校验），
 *    成功后记忆面板重读；卡已经不是眼前的样子（KG_CARD_STALE）⇒ 人话 + 重读这一轮。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { knowledgeGraph, type KgMemoryCard } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { MemoryCard } from "@/components/chat/knowledge/memory-card";
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { onKnowledgeReload, publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";

const THREAD = "thr-kg-manage";
const FORGET: KgMemoryCard = {
  cardId: "card-f1", kind: "forget", state: "open",
  items: [
    { claimId: "c-1", statement: "王经理负责审批合同" },
    { claimId: "c-2", statement: "客户A的对接人是王经理" },
    { claimId: "c-3", statement: "王经理下周休假" },
  ],
};
const OVERVIEW: KgMemoryCard = {
  cardId: "card-o1", kind: "overview", state: "open",
  items: [
    { claimId: "t-1", statement: "周五之前把报价单发给客户A", claimKind: "todo", source: { threadId: "thr-a", title: "报价" } },
    { claimId: "d-1", statement: "改成关注985高校", claimKind: "decision", source: { threadId: "thr-b", title: "择校" } },
    { claimId: "f-1", statement: "客户A的对接人是王经理", claimKind: "fact", source: null },
  ],
};

describe("MemoryCard：忘掉之后可以撤销", () => {
  it("已忘掉 N 条 · 撤销 ⇒ 交给 onUndoForget，服务端回 undone ⇒「都恢复了」、不再给撤销", async () => {
    const onUndoForget = vi.fn(async () => ({ ...FORGET, state: "undone" as const }));
    render(<MemoryCard card={{ ...FORGET, state: "done" }} canAct onAct={vi.fn()} onUndoForget={onUndoForget} />);
    const done = screen.getByTestId("kg-card-done");
    expect(done).toHaveTextContent("已忘掉 3 条");
    fireEvent.click(within(done).getByTestId("kg-card-undo"));
    expect(await screen.findByTestId("kg-card-undone")).toHaveTextContent("已撤销，这 3 条都恢复了");
    expect(onUndoForget).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("kg-card-undo")).toBeNull();
  });

  it("不是对话创建者 / 没接撤销：只说「已忘掉」，没有撤销（对照：所有者 + 接了撤销 ⇒ 有）", () => {
    const { rerender } = render(<MemoryCard card={{ ...FORGET, state: "done" }} canAct onAct={vi.fn()} onUndoForget={vi.fn()} />);
    expect(screen.getByTestId("kg-card-undo")).toBeInTheDocument();
    rerender(<MemoryCard card={{ ...FORGET, state: "done" }} canAct={false} onAct={vi.fn()} onUndoForget={vi.fn()} />);
    expect(screen.queryByTestId("kg-card-undo")).toBeNull();
    rerender(<MemoryCard card={{ ...FORGET, state: "done" }} canAct onAct={vi.fn()} />);
    expect(screen.queryByTestId("kg-card-undo")).toBeNull();
  });

  it("撤销失败 ⇒ 卡上一句人话，撤销按钮还在可以再试", async () => {
    const onUndoForget = vi.fn(async () => { throw new Error("这张卡上的内容已经变了，已为你刷新。"); });
    render(<MemoryCard card={{ ...FORGET, state: "done" }} canAct onAct={vi.fn()} onUndoForget={onUndoForget} />);
    fireEvent.click(screen.getByTestId("kg-card-undo"));
    expect(await screen.findByTestId("kg-card-error")).toHaveTextContent("已为你刷新");
    expect(screen.getByTestId("kg-card-undo")).toBeEnabled();
  });

  it("服务端读回 undone 的卡（刷新之后）⇒ 直接显示「都恢复了」", () => {
    render(<MemoryCard card={{ ...FORGET, state: "undone" }} canAct onAct={vi.fn()} onUndoForget={vi.fn()} />);
    expect(screen.getByTestId("kg-card-undone")).toHaveTextContent("都恢复了");
  });
});

describe("MemoryCard：「你记得我什么」清单", () => {
  it("按种类分组（决定 → 事实 → 待办），每条带来源对话链接，没有来源的写「长期记忆」；没有任何按钮", () => {
    render(<MemoryCard card={OVERVIEW} canAct onAct={vi.fn()} />);
    const card = screen.getByTestId("kg-card-overview");
    const groups = within(card).getAllByRole("heading").map((h) => h.textContent);
    expect(groups).toEqual(["决定", "事实", "待办"]);
    expect(within(screen.getByTestId("kg-overview-group-decision")).getByText("改成关注985高校")).toBeInTheDocument();
    const links = within(card).getAllByTestId("kg-overview-source-link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["来自「择校」", "/chat/thr-b?memory=1"],
      ["来自「报价」", "/chat/thr-a?memory=1"],
    ]);
    expect(within(screen.getByTestId("kg-overview-item-f-1")).getByTestId("kg-overview-source-longterm")).toHaveTextContent("长期记忆");
    expect(within(card).getByTestId("kg-overview-brain-link")).toHaveAttribute("href", "/brain");
    expect(within(card).queryAllByRole("button")).toEqual([]);
    expect(within(card).queryAllByRole("checkbox")).toEqual([]);
    for (const w of KG_BANNED_USER_FACING_WORDS) expect(card.textContent).not.toContain(w);
  });
});

/* ── 经 TurnMemoryLine 的真实接线 ─────────────────────────────────── */

interface Server { card: KgMemoryCard | null; undoCalls: { path: string; body: unknown }[]; turnReads: number; undoFails?: boolean }
let server: Server;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-manage");
  server = { card: { ...FORGET, state: "done" }, undoCalls: [], turnReads: 0 };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}/messages/msg-9/memory`) {
      server.turnReads += 1;
      return json(knowledgeGraph.getTurnMemory.out.parse({
        messageId: "msg-9", captured: [], pending: false, supersede: null, recalled: [], recallDegraded: false,
        prompt: server.card === null ? null : { type: "memory_card", card: server.card },
      }));
    }
    if (path === "/knowledge-graph/cards/card-f1/undo" && init?.method === "POST") {
      server.undoCalls.push({ path, body: JSON.parse(String(init.body)) });
      knowledgeGraph.undoMemoryCard.in.parse({ cardId: "card-f1" });
      if (server.undoFails === true) {
        server.card = { ...FORGET, state: "undone" };
        return json({ error: "rejected", traceId: "t-1", reasonCode: "KG_CARD_STALE" }, 409);
      }
      server.card = { ...FORGET, state: "undone" };
      return json(knowledgeGraph.undoMemoryCard.out.parse({ card: server.card, actionIds: ["act-u1"] }));
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  publishKnowledgeSnapshot(null);
});

describe("TurnMemoryLine：忘掉卡的撤销", () => {
  it("点「撤销」⇒ POST /knowledge-graph/cards/card-f1/undo；成功后「都恢复了」、记忆面板重读", async () => {
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 1 });
    const reloads: string[] = [];
    const off = onKnowledgeReload((t) => reloads.push(t));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-card-undo"));
    expect(await screen.findByTestId("kg-card-undone")).toHaveTextContent("都恢复了");
    expect(server.undoCalls).toEqual([{ path: "/knowledge-graph/cards/card-f1/undo", body: {} }]);
    expect(reloads).toEqual([THREAD]);
    off();
  });

  it("卡已经撤过（KG_CARD_STALE）⇒ 人话，重读这一轮后按服务端现在的样子显示", async () => {
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 1 });
    server.undoFails = true;
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-card-undo"));
    expect(await screen.findByTestId("kg-card-undone")).toBeInTheDocument();
    expect(server.turnReads).toBe(2);
    expect(document.body.textContent).not.toContain("KG_");
  });

  it("非所有者：没有撤销、不发写请求（对照：所有者看得到撤销）", async () => {
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 1 });
    const first = render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    expect(await screen.findByTestId("kg-card-undo")).toBeInTheDocument();
    first.unmount();
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: false, revision: 1 });
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    expect(await screen.findByTestId("kg-card-done")).toHaveTextContent("已忘掉 3 条");
    expect(screen.queryByTestId("kg-card-undo")).toBeNull();
    expect(server.undoCalls).toEqual([]);
  });
});
