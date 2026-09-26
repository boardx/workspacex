/**
 * phase-18 F11 —— AI 提名「值得记住」卡片（uc-18-4 A1 / R4 硬边界：AI 只提名，不执行）。
 *
 * 覆盖：
 *  · 渲染卡片本身不发任何请求、不调记入（从不自己执行）
 *  · 单条「记下」只带这一条去记入；批量按勾选带
 *  · 在记忆面板里：点「记下」经 `promoteToPersonal` 发出只含这一条的请求；「×」收起后卡片消失且没有记入
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import { knowledgeGraph, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { promoteToPersonal, type PromotionNominations, type ThreadKnowledge } from "@/lib/knowledge-graph-api";
import { NominationCard } from "@/components/chat/knowledge/nomination-card";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";

const THREAD = "thr-kg-nominate";
const SCOPE = { kind: "chat_session", id: THREAD } as const;

function claim(id: string, statement: string, status: KgClaim["status"] = "accepted"): KgClaim {
  return {
    id, scope: SCOPE, kind: "fact", statement, status,
    triState: status === "accepted" ? "confirmed" : status === "contested" ? "conflict" : "pending",
    confidence: 0.8, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null,
    aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z",
  };
}
const CLAIMS = [claim("c-fact", "客户 B 需要中文界面。", "proposed"), claim("c-owner", "客户 B 的对接人是钱八。")];
const LABEL = (id: string): string => CLAIMS.find((c) => c.id === id)?.statement ?? id;

const NOMINATIONS: PromotionNominations = knowledgeGraph.listPromotionNominations.out.parse({
  nominations: [
    { claimId: "c-fact", rationale: "跨对话都用得上的客户要求。" },
    { claimId: "c-owner", rationale: "以后找人会用到。" },
  ],
});

function knowledge(): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: SCOPE, revision: 2, objects: [], claims: CLAIMS, edges: [],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let promoteBodies: unknown[];
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-nominate");
  promoteBodies = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}/promote` && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { claimIds: string[] };
      promoteBodies.push(body);
      return new Response(JSON.stringify({
        results: body.claimIds.map((id) => ({ claimId: id, outcome: "promoted", personalClaimId: `p-${id}` })),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("NominationCard：只提名，不执行", () => {
  it("渲染卡片不调记入、不发请求；每条带理由，文案说清「你点了才会记」", () => {
    const onPromote = vi.fn();
    render(<NominationCard data={NOMINATIONS} claimLabel={LABEL} onPromote={onPromote} />);
    const card = screen.getByTestId("kg-nomination-card");
    expect(card).toHaveTextContent("你点了才会记");
    expect(within(card).getByTestId("kg-nomination-c-fact")).toHaveTextContent("客户 B 需要中文界面。");
    expect(within(card).getByTestId("kg-nomination-c-fact")).toHaveTextContent("跨对话都用得上的客户要求。");
    expect(onPromote).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("单条「记下」只带这一条；批量按勾选带（取消勾选的那条不带）", () => {
    const onPromote = vi.fn();
    render(<NominationCard data={NOMINATIONS} claimLabel={LABEL} onPromote={onPromote} />);
    fireEvent.click(screen.getByTestId("kg-nomination-promote-one-c-owner"));
    expect(onPromote).toHaveBeenLastCalledWith(["c-owner"]);

    fireEvent.click(screen.getByTestId("kg-nomination-check-c-owner"));
    const batch = screen.getByTestId("kg-nomination-promote");
    expect(batch).toHaveTextContent("记到我的长期记忆（1）");
    fireEvent.click(batch);
    expect(onPromote).toHaveBeenLastCalledWith(["c-fact"]);
    expect(onPromote).toHaveBeenCalledTimes(2);
  });

  it("busy 期间「记下」禁用，防连点重复提交", () => {
    const onPromote = vi.fn();
    render(<NominationCard data={NOMINATIONS} claimLabel={LABEL} onPromote={onPromote} busy />);
    expect(screen.getByTestId("kg-nomination-promote-one-c-fact")).toBeDisabled();
    expect(screen.getByTestId("kg-nomination-promote")).toBeDisabled();
  });
});

describe("记忆面板里的提名卡", () => {
  function renderPanel() {
    const onPromote = vi.fn((ids: string[], choices?: Parameters<typeof promoteToPersonal>[2]) => promoteToPersonal(THREAD, ids, choices));
    render(
      <KnowledgePanel
        status="ready"
        data={knowledge()}
        writeActions={{ apply: () => Promise.resolve(), onPromote }}
        nominations={NOMINATIONS}
      />,
    );
    return onPromote;
  }

  it("挂上面板本身不发记入请求（从不自动执行）", async () => {
    const onPromote = renderPanel();
    expect(screen.getByTestId("kg-nomination-card")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(onPromote).not.toHaveBeenCalled();
    expect(promoteBodies).toEqual([]);
  });

  it("点「记下」：经 promoteToPersonal 发出只含这一条的请求；记下后那条从提名里消失", async () => {
    const onPromote = renderPanel();
    fireEvent.click(screen.getByTestId("kg-nomination-promote-one-c-fact"));
    await waitFor(() => expect(promoteBodies).toEqual([{ claimIds: ["c-fact"] }]));
    expect(onPromote).toHaveBeenCalledWith(["c-fact"], undefined);
    await waitFor(() => expect(screen.queryByTestId("kg-nomination-c-fact")).not.toBeInTheDocument());
    expect(screen.getByTestId("kg-nomination-c-owner")).toBeInTheDocument();
  });

  it("点「×」收起：卡片消失，且没有记入任何一条", async () => {
    const onPromote = renderPanel();
    fireEvent.click(screen.getByTestId("kg-nomination-dismiss"));
    expect(screen.queryByTestId("kg-nomination-card")).not.toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 0));
    expect(onPromote).not.toHaveBeenCalled();
    expect(promoteBodies).toEqual([]);
  });
});
