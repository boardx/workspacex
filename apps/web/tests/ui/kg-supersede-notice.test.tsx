/**
 * Issue #4290 —— 回答下的改口取代提示「已用〈新〉取代〈旧〉 · 撤销」。
 *
 * 经 `TurnMemoryLine` 的真实接线：数据来自 `getTurnMemory.supersede`（契约 `out` 校验），「撤销」发出的是
 * **真实请求体** `applyHumanAction{undoSupersede}`（经契约 `in` 校验），版本号点击时现取；失败码翻成人话、内部码不上屏；
 * 只有所有者看得到「撤销」。网络在 `fetch` 层打桩成一个有状态的小服务端。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { knowledgeGraph, type KgHumanAction, type KgSupersedeNotice } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { onKnowledgeReload, publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";

const THREAD = "thr-kg-supersede";
const NOTICE: KgSupersedeNotice = {
  noticeId: "act-1-0",
  newerClaim: { id: "c-new", statement: "改成关注 985 高校" },
  olderClaim: { id: "c-old", statement: "我决定关注 211 高校" },
  state: "applied",
};

interface Server {
  revision: number;
  notice: KgSupersedeNotice | null;
  actions: { basedOnRevision: number; action: KgHumanAction }[];
  onAction: (body: Server["actions"][number]) => Response | undefined;
}
let server: Server;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const failure = (status: number, reasonCode: string) => json({ error: "rejected", traceId: "t-1", reasonCode }, status);

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-supersede");
  server = { revision: 7, notice: NOTICE, actions: [], onAction: () => undefined };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}/messages/msg-b/memory`) {
      return json(knowledgeGraph.getTurnMemory.out.parse({
        messageId: "msg-b", captured: [], pending: false, prompt: null, supersede: server.notice, recalled: [], recallDegraded: false,
      }));
    }
    if (path === `/knowledge-graph/threads/${THREAD}` && (init?.method ?? "GET") === "GET") {
      return json(knowledgeGraph.getThreadKnowledge.out.parse({
        scope: { kind: "chat_session", id: THREAD }, revision: server.revision, objects: [], claims: [], edges: [],
        ingestion: { queued: 0, running: 0, failed: 0, failures: [] }, canEdit: true, canPromote: true, visibility: "owner_only",
        extractionActive: true,
      }));
    }
    if (path === `/knowledge-graph/threads/${THREAD}/actions` && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Server["actions"][number];
      knowledgeGraph.applyHumanAction.in.parse({ threadId: THREAD, ...body });
      server.actions.push(body);
      const override = server.onAction(body);
      if (override) return override;
      server.revision += 1;
      if (server.notice !== null) server.notice = { ...server.notice, state: "undone" };
      return json({ revision: server.revision, actionId: `act-${String(server.actions.length)}` });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  publishKnowledgeSnapshot(null);
});

const owner = () => publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 1 });

describe("TurnMemoryLine：改口取代提示", () => {
  it("显示「已用〈新〉取代〈旧〉 · 撤销」", async () => {
    owner();
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-b" />);
    expect(await screen.findByTestId("kg-supersede-text")).toHaveTextContent("已用〈改成关注 985 高校〉取代〈我决定关注 211 高校〉");
    expect(screen.getByTestId("kg-supersede-undo")).toHaveTextContent("撤销");
  });

  it("撤销：发出 undoSupersede{noticeId}，版本号点击时现取；完成后收成「已撤销：〈旧〉恢复为生效」并让记忆面板重读", async () => {
    owner();
    const reloads: string[] = [];
    const off = onKnowledgeReload((t) => reloads.push(t));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-b" />);
    fireEvent.click(await screen.findByTestId("kg-supersede-undo"));
    expect(await screen.findByTestId("kg-supersede-undone")).toHaveTextContent("已撤销：〈我决定关注 211 高校〉恢复为生效");
    expect(server.actions).toEqual([{ basedOnRevision: 7, action: { type: "undoSupersede", noticeId: "act-1-0" } }]);
    expect(reloads).toEqual([THREAD]);
    off();
  });

  it("服务端已读作 undone（别处撤过）⇒ 直接是撤销后的那一行，没有按钮", async () => {
    owner();
    server.notice = { ...NOTICE, state: "undone" };
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-b" />);
    expect(await screen.findByTestId("kg-supersede-undone")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-supersede-undo")).not.toBeInTheDocument();
  });

  it.each([
    [409, "KG_REVISION_CHANGED", "内容已变化"],
    [403, "KG_NOT_OWNER", "只有对话的创建者可以修改这里的记忆。"],
  ])("服务端拒绝（%s %s）⇒ 这一行下是人话，内部码不上屏，按钮还在", async (status, code, text) => {
    owner();
    server.onAction = () => failure(status, code);
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-b" />);
    fireEvent.click(await screen.findByTestId("kg-supersede-undo"));
    expect(await screen.findByTestId("kg-supersede-undo-error")).toHaveTextContent(text);
    expect(document.body.textContent).not.toContain("KG_");
    expect(screen.getByTestId("kg-supersede-undo")).toBeEnabled();
  });

  it("非所有者：只有提示文字，没有「撤销」；不发写请求", async () => {
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: false, revision: 1 });
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-b" />);
    expect(await screen.findByTestId("kg-supersede-text")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-supersede-undo")).not.toBeInTheDocument();
    expect(server.actions).toEqual([]);
  });

  it("没有取代提示 ⇒ 不画这一行", async () => {
    owner();
    server.notice = null;
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-b" />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("kg-supersede-notice")).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
