/**
 * issue #4180 —— 发送的用户消息下方，一句「刚被抽取出新知识」的轻量反馈：
 * 「已记下：{claim 摘要} · 撤销」。
 *
 * 数据来自 `getMessageExtraction`（契约 `out` 校验）；「撤销」发出的是 F10 既有的
 * `applyHumanAction{revokeClaim}`（同 `AnswerMemoryLine` 的撤销用的那一个操作，不是新端点）。
 * 网络在 `fetch` 层打桩成一个有状态的小服务端，同 `kg-conflict-card.test.tsx` 的接线方式。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { knowledgeGraph, type KgHumanAction } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { ExtractionFeedbackChip } from "@/components/chat/knowledge/extraction-feedback-chip";
import { publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";

const THREAD = "thr-kg-extraction";
const MESSAGE = "msg-user-1";
const CLAIM_ID = "clm-extracted-1";
const STATEMENT = "客户 A 要求下周一上线";

interface Server {
  revision: number;
  claims: readonly { claimId: string; statement: string }[];
  actions: { basedOnRevision: number; action: KgHumanAction }[];
  onAction: (body: Server["actions"][number]) => Response | undefined;
}
let server: Server;
let fetchMock: ReturnType<typeof vi.fn>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const failure = (status: number, reasonCode: string) => json({ error: "rejected", traceId: "t-1", reasonCode }, status);

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-extraction");
  server = { revision: 7, claims: [{ claimId: CLAIM_ID, statement: STATEMENT }], actions: [], onAction: () => undefined };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}/messages/${MESSAGE}/extraction`) {
      return json(knowledgeGraph.getMessageExtraction.out.parse({ claims: server.claims }));
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
      server.actions.push(body);
      const override = server.onAction(body);
      if (override) return override;
      server.revision += 1;
      return json({ revision: server.revision, actionId: `act-${String(server.actions.length)}` });
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: server.revision });
});
afterEach(() => {
  vi.unstubAllGlobals();
  publishKnowledgeSnapshot(null);
});

describe("ExtractionFeedbackChip", () => {
  it("有新 claim ⇒ 出现「已记下：{摘要}·撤销」", async () => {
    render(<ExtractionFeedbackChip threadId={THREAD} messageId={MESSAGE} />);
    const line = await screen.findByTestId(`kg-extraction-line-${CLAIM_ID}`);
    expect(line).toHaveTextContent(`已记下：${STATEMENT}`);
    expect(screen.getByTestId(`kg-extraction-undo-${CLAIM_ID}`)).toHaveTextContent("撤销");
  });

  it("没有新 claim ⇒ 不出现", async () => {
    server.claims = [];
    const { container } = render(<ExtractionFeedbackChip threadId={THREAD} messageId={MESSAGE} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("kg-extraction-feedback")).not.toBeInTheDocument();
  });

  it("非所有者：没有「撤销」按钮，仍显示反馈文字", async () => {
    publishKnowledgeSnapshot({ threadId: THREAD, canEdit: false, revision: server.revision });
    render(<ExtractionFeedbackChip threadId={THREAD} messageId={MESSAGE} />);
    await screen.findByTestId(`kg-extraction-line-${CLAIM_ID}`);
    expect(screen.queryByTestId(`kg-extraction-undo-${CLAIM_ID}`)).not.toBeInTheDocument();
  });

  it("点「撤销」⇒ 发出 F10 既有的 applyHumanAction{revokeClaim}（同一个操作，不是新端点），版本号点击时现取", async () => {
    const revisionAtClick = server.revision;
    render(<ExtractionFeedbackChip threadId={THREAD} messageId={MESSAGE} />);
    fireEvent.click(await screen.findByTestId(`kg-extraction-undo-${CLAIM_ID}`));
    await waitFor(() => expect(server.actions).toEqual([
      { basedOnRevision: revisionAtClick, action: { type: "revokeClaim", claimId: CLAIM_ID } },
    ]));
  });

  it("撤销后：这条反馈消失", async () => {
    render(<ExtractionFeedbackChip threadId={THREAD} messageId={MESSAGE} />);
    fireEvent.click(await screen.findByTestId(`kg-extraction-undo-${CLAIM_ID}`));
    await waitFor(() => expect(screen.queryByTestId(`kg-extraction-line-${CLAIM_ID}`)).not.toBeInTheDocument());
  });

  it("撤销时这条已经被别处撤销（KG_CLAIM_NOT_FOUND）⇒ 视为已撤销，不报错，反馈消失", async () => {
    server.onAction = () => failure(404, "KG_CLAIM_NOT_FOUND");
    render(<ExtractionFeedbackChip threadId={THREAD} messageId={MESSAGE} />);
    fireEvent.click(await screen.findByTestId(`kg-extraction-undo-${CLAIM_ID}`));
    await waitFor(() => expect(screen.queryByTestId(`kg-extraction-line-${CLAIM_ID}`)).not.toBeInTheDocument());
    expect(screen.queryByTestId(`kg-extraction-undo-error-${CLAIM_ID}`)).not.toBeInTheDocument();
  });

  it("撤销失败（其余错误）⇒ 人话错误提示，反馈仍在，可以再点", async () => {
    server.onAction = () => failure(409, "KG_REVISION_CHANGED");
    render(<ExtractionFeedbackChip threadId={THREAD} messageId={MESSAGE} />);
    fireEvent.click(await screen.findByTestId(`kg-extraction-undo-${CLAIM_ID}`));
    expect(await screen.findByTestId(`kg-extraction-undo-error-${CLAIM_ID}`)).toHaveTextContent("内容已变化");
    expect(document.body.textContent).not.toContain("KG_");
    expect(screen.getByTestId(`kg-extraction-line-${CLAIM_ID}`)).toBeInTheDocument();
  });
});
