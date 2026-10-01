/**
 * issue #4352 —— /chat 记忆面板的「整理本会话」与「失败 · 重试」接上 UC-KG-4 `requestReindex`，
 * 以及抽取关着时的说明「关闭期间的消息不会整理，可用「整理本会话」补」。
 *
 * 真实的 `useThreadKnowledge` + `ThreadKnowledgeTab`（与 /chat 右栏同一条接线），网络在 `fetch` 层打桩成
 * 一个有状态的小服务端：POST …/reindex 把会话标成「整理中」，下一次 GET 读到 queued > 0。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { ThreadKnowledge } from "@/lib/knowledge-graph-api";
import { ThreadKnowledgeTab, useThreadKnowledge } from "@/components/chat/knowledge/thread-knowledge-tab";

const THREAD = "thr-kg-reindex";

interface Server {
  canEdit: boolean;
  extractionActive: boolean;
  ingestion: { queued: number; running: number; failed: number };
  reindexCalls: unknown[];
  reindexReply: () => Response;
}
let server: Server;

function readModel(): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: { kind: "chat_session", id: THREAD }, revision: 1, objects: [], claims: [], edges: [],
    ingestion: {
      ...server.ingestion,
      failures: Array.from({ length: server.ingestion.failed }, (_, i) => ({ sourceKind: "chat_message", sourceRef: `m-${String(i)}`, reason: "retries_exhausted" })),
    },
    canEdit: server.canEdit, canPromote: false, visibility: "owner_only", extractionActive: server.extractionActive,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-reindex");
  server = {
    canEdit: true, extractionActive: true, ingestion: { queued: 0, running: 0, failed: 0 }, reindexCalls: [],
    reindexReply: () => {
      server.ingestion = { queued: 2, running: 0, failed: 0 };
      return json(knowledgeGraph.requestReindex.out.parse({ queued: 2 }));
    },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}` && (init?.method ?? "GET") === "GET") return json(readModel());
    if (path === `/knowledge-graph/threads/${THREAD}/reindex` && init?.method === "POST") {
      server.reindexCalls.push(JSON.parse(String(init.body)));
      return server.reindexReply();
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function Harness() {
  const state = useThreadKnowledge(THREAD);
  return <ThreadKnowledgeTab state={state} />;
}

describe("issue #4352: /chat 记忆面板「整理本会话」", () => {
  it("所有者、抽取开着：有「整理本会话」；点了发 requestReindex，面板进入「整理中」", async () => {
    render(<Harness />);
    const button = await screen.findByTestId("kg-reindex");
    expect(button).toHaveTextContent("整理本会话");
    fireEvent.click(button);
    expect(await screen.findByTestId("kg-ingestion-running")).toHaveTextContent("整理中（2 条）");
    expect(server.reindexCalls).toEqual([{}]);
  });

  it("空态里的「整理本会话」走同一条路", async () => {
    render(<Harness />);
    fireEvent.click(await screen.findByTestId("kg-empty-reindex"));
    expect(await screen.findByTestId("kg-ingestion-running")).toHaveTextContent("整理中");
    expect(server.reindexCalls).toHaveLength(1);
  });

  it("「失败 · 重试」走同一个 requestReindex，点了进入「整理中」", async () => {
    server.ingestion = { queued: 0, running: 0, failed: 1 };
    render(<Harness />);
    expect(await screen.findByTestId("kg-ingestion-failed")).toHaveTextContent("失败 1 条");
    fireEvent.click(screen.getByTestId("kg-ingestion-retry"));
    expect(await screen.findByTestId("kg-ingestion-running")).toBeInTheDocument();
    expect(server.reindexCalls).toHaveLength(1);
  });

  it("服务端说已经在整理（KG_REINDEX_ALREADY_RUNNING）⇒ 人话提示，不静默", async () => {
    server.reindexReply = () => json({ error: "rejected", traceId: "t-1", reasonCode: "KG_REINDEX_ALREADY_RUNNING" }, 409);
    render(<Harness />);
    fireEvent.click(await screen.findByTestId("kg-reindex"));
    expect(await screen.findByTestId("kg-action-error")).toHaveTextContent("正在整理中，请稍后再试。");
  });

  it("不是会话所有者 ⇒ 没有「整理本会话」，也没有「重试」", async () => {
    server.canEdit = false;
    server.ingestion = { queued: 0, running: 0, failed: 1 };
    render(<Harness />);
    await screen.findByTestId("kg-ingestion-failed");
    expect(screen.queryByTestId("kg-ingestion-retry")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-reindex")).not.toBeInTheDocument();
  });

  it("抽取关着 ⇒ 说明「关闭期间的消息不会整理，可用「整理本会话」补」，此时不给点不动的按钮", async () => {
    server.extractionActive = false;
    render(<Harness />);
    const inactive = await screen.findByTestId("kg-ingestion-inactive");
    expect(inactive).toHaveTextContent("自动记忆未开启");
    expect(screen.getByTestId("kg-ingestion-inactive-hint")).toHaveTextContent("关闭期间的消息不会整理，可用「整理本会话」补");
    expect(screen.queryByTestId("kg-reindex")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-empty-reindex")).not.toBeInTheDocument();
    await waitFor(() => expect(server.reindexCalls).toEqual([]));
  });
});
