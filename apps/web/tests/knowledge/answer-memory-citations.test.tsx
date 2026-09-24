/**
 * phase-18 F13 —— 回答下「这次用到了哪些记忆、为什么」（uc-18-2 R8 / E1，uc-18-4 R3-6）。
 *
 * 数据形状即契约 `KgTurnMemory.recalled` / `recallDegraded`；`TurnMemoryLine` 那几条在 `fetch` 层打桩，
 * 走真实的 `fetchTurnMemory`（契约 `out` 校验）。
 *
 * 覆盖：
 *  · 引用 chip 从 `recalled` 渲染（按名次编号），不画 `recalled` 之外的东西
 *  · 「AI 记下的」/「有矛盾」徽标（契约三态文案）
 *  · 长期记忆的「来自你 {M/D} 的对话」（本地时区）；没有时间时「来自你的长期记忆」
 *  · 「为什么用到它」：通道用词、召回理由（filter-action 单源）、关系路径 + 关系短标签；不显示分数
 *  · 「查不全」只看 `recallDegraded`，与向量无关
 *  · 点 chip 请求打开那一条的来源抽屉（面板已挂载 / 点击后才挂载 两种）
 *  · TurnMemoryLine：有 recalled 就画 footer（在「已记下」之前）；recalled 与 captured 都空时什么都不画
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import { knowledgeGraph, KG_TRI_STATE_LABEL_ZH, type KgRecalledMemory } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { ClaimSources, ThreadKnowledge, TurnMemory } from "@/lib/knowledge-graph-api";
import { AnswerKnowledgeFooter } from "@/components/chat/knowledge/answer-knowledge-footer";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { OPEN_CLAIM_SOURCES_EVENT, takePendingClaimSources } from "@/lib/knowledge-graph-events";
import {
  KG_RELATED_QUERY_DEGRADED_ZH,
  KG_RELATION_LABEL_ZH,
  RETRIEVAL_CHANNEL_LABEL_ZH,
  graphPathText,
} from "@/lib/knowledge-graph-recall";
import { FILTER_ACTIONS } from "@/lib/filter-action";

const THREAD = "thr-kg-recall";

function mem(overrides: Partial<KgRecalledMemory> & { claimId: string }): KgRecalledMemory {
  return {
    statement: `结论 ${overrides.claimId}`,
    triState: "confirmed",
    scope: "chat_session",
    saidAt: "2026-09-22T04:00:00Z",
    channels: ["fts"],
    retrievalReasons: ["recall"],
    score: 0.0164,
    graphPath: null,
    ...overrides,
  };
}

const DECIDE = mem({
  claimId: "c-decide",
  statement: "王五决定周五发版，发版前先冻结报表模块的范围。",
  channels: ["graph", "fts"],
  retrievalReasons: ["lead", "recall"],
  score: 0.0325,
  graphPath: [{ from: "王五决定周五发版", relation: "decided_by", to: "王五" }],
});
const TODO = mem({ claimId: "c-todo", statement: "赵六整理发版清单。", triState: "pending" });
const RISK = mem({ claimId: "c-risk", statement: "周五发版可能赶不上测试。", triState: "conflict", retrievalReasons: ["recall", "paired"] });
const PERSONAL = mem({
  claimId: "p-custa",
  statement: "客户 B 需要中文界面。",
  scope: "personal",
  saidAt: "2026-09-20T12:00:00Z",
  channels: ["fts", "graph"],
  retrievalReasons: ["recall", "lead"],
  graphPath: [
    { from: "客户 B 需要中文界面。", relation: "about", to: "客户 B" },
    { from: "客户 B", relation: "belongs_to", to: "海外项目" },
  ],
});

function localMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

/* ── footer 本身 ─────────────────────────────────────────────────── */

describe("AnswerKnowledgeFooter：引用 chip", () => {
  it("chip 按 recalled 名次编号，只画 recalled 里的条目；长句截断但 title 保留全文", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE, TODO]} recallDegraded={false} onOpenSource={() => {}} />);
    const chips = screen.getByTestId("kg-citation-chips");
    expect(within(chips).getAllByRole("button")).toHaveLength(2);
    const first = screen.getByTestId("kg-citation-c-decide");
    expect(first).toHaveTextContent("[1]");
    expect(first).toHaveTextContent("…");
    expect(first).toHaveAttribute("title", DECIDE.statement);
    expect(screen.getByTestId("kg-citation-c-todo")).toHaveTextContent("[2]");
    expect(screen.getByTestId("kg-citation-c-todo")).toHaveTextContent("赵六整理发版清单。");
    expect(screen.queryByTestId("kg-citation-c-risk")).not.toBeInTheDocument();
  });

  it("「AI 记下的」只挂在 pending 那条，「有矛盾」只挂在 conflict 那条（文案来自契约）", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE, TODO, RISK]} recallDegraded={false} onOpenSource={() => {}} />);
    expect(screen.getByTestId("kg-citation-pending-c-todo")).toHaveTextContent(KG_TRI_STATE_LABEL_ZH.pending);
    expect(screen.getByTestId("kg-citation-conflict-c-risk")).toHaveTextContent(KG_TRI_STATE_LABEL_ZH.conflict);
    expect(screen.queryByTestId("kg-citation-pending-c-decide")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-citation-conflict-c-decide")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-citation-pending-c-risk")).not.toBeInTheDocument();
  });

  it("长期记忆的一条标「来自你 {M/D} 的对话」（本地时区）；本会话的不标；没有时间时说「来自你的长期记忆」", () => {
    const noDate = mem({ claimId: "p-nodate", scope: "personal", saidAt: null });
    render(<AnswerKnowledgeFooter recalled={[PERSONAL, DECIDE, noDate]} recallDegraded={false} onOpenSource={() => {}} />);
    expect(screen.getByTestId("kg-from-personal-p-custa")).toHaveTextContent(`来自你 ${localMonthDay(PERSONAL.saidAt!)} 的对话`);
    expect(screen.queryByTestId("kg-from-personal-c-decide")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-from-personal-p-nodate")).toHaveTextContent("来自你的长期记忆");
  });
});

describe("AnswerKnowledgeFooter：为什么用到它", () => {
  it("展开后逐条显示通道用词、召回理由、关系路径（关系用短标签），不显示分数", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE, TODO, PERSONAL]} recallDegraded={false} onOpenSource={() => {}} />);
    expect(screen.queryByTestId("kg-why-recall-body")).not.toBeInTheDocument();
    const toggle = screen.getByTestId("kg-why-recall-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const decide = screen.getByTestId("kg-recall-reason-c-decide");
    expect(within(decide).getByTestId("kg-recall-channel-c-decide-graph")).toHaveTextContent(RETRIEVAL_CHANNEL_LABEL_ZH.graph);
    expect(within(decide).getByTestId("kg-recall-channel-c-decide-fts")).toHaveTextContent(RETRIEVAL_CHANNEL_LABEL_ZH.fts);
    expect(RETRIEVAL_CHANNEL_LABEL_ZH.graph).toBe("关联");
    expect(RETRIEVAL_CHANNEL_LABEL_ZH.fts).toBe("全文");
    expect(within(decide).getByTestId("kg-recall-why-c-decide-lead")).toHaveTextContent(FILTER_ACTIONS.lead.label);
    expect(within(decide).getByTestId("kg-recall-why-c-decide-recall")).toHaveTextContent(FILTER_ACTIONS.recall.label);
    expect(within(decide).getByTestId("kg-graph-path-c-decide")).toHaveTextContent(
      `王五决定周五发版 —${KG_RELATION_LABEL_ZH.decided_by}→ 王五`,
    );
    expect(KG_RELATION_LABEL_ZH.decided_by).toBe("拍板人");

    // 没有路径的那条不画路径行
    expect(within(screen.getByTestId("kg-recall-reason-c-todo")).queryByTestId("kg-graph-path-c-todo")).not.toBeInTheDocument();

    // 首尾相接的两段连成一条链
    expect(screen.getByTestId("kg-graph-path-p-custa")).toHaveTextContent("客户 B 需要中文界面。 —关于→ 客户 B —属于→ 海外项目");

    // 分数是原始 RRF，不给人看
    const body = screen.getByTestId("kg-why-recall-body");
    expect(body.textContent).not.toContain("相关度");
    expect(body.textContent).not.toContain("0.03");
    expect(body.textContent).not.toContain("0.01");
  });

  it("关系路径：接不上的边另起一截，不自作主张补边", () => {
    expect(graphPathText([
      { from: "甲", relation: "blocks", to: "乙" },
      { from: "丙", relation: "supported_by", to: "丁" },
    ])).toBe("甲 —阻碍→ 乙；丙 —依据→ 丁");
    expect(graphPathText(null)).toBeNull();
    expect(graphPathText([])).toBeNull();
  });
});

describe("AnswerKnowledgeFooter：查不全提示只看 recallDegraded", () => {
  it("recallDegraded=true 时显示固定说法", () => {
    render(<AnswerKnowledgeFooter recalled={[TODO]} recallDegraded onOpenSource={() => {}} />);
    expect(screen.getByTestId("kg-channel-unavailable")).toHaveTextContent(KG_RELATED_QUERY_DEGRADED_ZH);
  });

  it("recallDegraded=false：哪怕没有一条走「相似」（向量未部署），也不提示", () => {
    const ftsOnly = [mem({ claimId: "c-a", channels: ["fts"] }), mem({ claimId: "c-b", channels: ["graph"] })];
    render(<AnswerKnowledgeFooter recalled={ftsOnly} recallDegraded={false} onOpenSource={() => {}} />);
    expect(screen.queryByTestId("kg-channel-unavailable")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-answer-footer").textContent).not.toContain("没能查全");
  });

  it("recalled 为空但 recallDegraded=true：只画那一行提示，不画空 chip 区；两者都没有时整块不渲染", () => {
    const { container, rerender } = render(<AnswerKnowledgeFooter recalled={[]} recallDegraded onOpenSource={() => {}} />);
    expect(screen.getByTestId("kg-channel-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-citation-chips")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-why-recall-toggle")).not.toBeInTheDocument();
    rerender(<AnswerKnowledgeFooter recalled={[]} recallDegraded={false} onOpenSource={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/* ── 点 chip → 来源抽屉 ──────────────────────────────────────────── */

const SOURCES: ClaimSources = knowledgeGraph.getClaimSources.out.parse({
  claim: {
    id: "p-custa", scope: { kind: "personal", id: "u-me" }, kind: "fact", statement: "客户 B 需要中文界面。",
    status: "accepted", triState: "confirmed", confidence: 0.9, createdBy: "human", reviewedBy: "u-me",
    supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 1,
    contradictingCount: 0, createdAt: "2026-09-20T12:00:00Z",
  },
  evidence: [],
  provenance: [],
});

function knowledge(): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: { kind: "chat_session", id: THREAD }, revision: 1, objects: [], claims: [], edges: [],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    canEdit: false, canPromote: false, visibility: "owner_only",
  });
}

describe("点引用 chip：打开那一条的来源抽屉", () => {
  afterEach(() => { takePendingClaimSources(); });

  it("默认经 requestOpenClaimSources 发出请求，带的是这一条的 claimId", () => {
    const heard: string[] = [];
    const listener = (e: Event): void => { heard.push(String((e as CustomEvent<unknown>).detail)); };
    window.addEventListener(OPEN_CLAIM_SOURCES_EVENT, listener);
    try {
      render(<AnswerKnowledgeFooter recalled={[DECIDE, PERSONAL]} recallDegraded={false} />);
      fireEvent.click(screen.getByTestId("kg-citation-p-custa"));
      expect(heard).toEqual(["p-custa"]);
    } finally {
      window.removeEventListener(OPEN_CLAIM_SOURCES_EVENT, listener);
    }
  });

  it("面板已挂载：抽屉按 claimId 取来源并打开——长期记忆的那条不在本会话列表里也能开", async () => {
    const loadSources = vi.fn(() => Promise.resolve(SOURCES));
    render(
      <>
        <AnswerKnowledgeFooter recalled={[PERSONAL]} recallDegraded={false} />
        <KnowledgePanel status="ready" data={knowledge()} loadSources={loadSources} />
      </>,
    );
    expect(screen.queryByTestId("kg-source-drawer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kg-citation-p-custa"));
    const drawer = await screen.findByTestId("kg-source-drawer");
    expect(loadSources).toHaveBeenCalledWith("p-custa");
    await waitFor(() => expect(within(drawer).getByTestId("kg-source-statement")).toHaveTextContent("客户 B 需要中文界面。"));
  });

  it("点击时面板还没挂载（记忆页签没打开）：面板挂载时接住这一次，且只接一次", async () => {
    const loadSources = vi.fn(() => Promise.resolve(SOURCES));
    render(<AnswerKnowledgeFooter recalled={[PERSONAL]} recallDegraded={false} />);
    fireEvent.click(screen.getByTestId("kg-citation-p-custa"));

    const first = render(<KnowledgePanel status="ready" data={knowledge()} loadSources={loadSources} />);
    await within(first.container).findByTestId("kg-source-drawer");
    expect(loadSources).toHaveBeenCalledWith("p-custa");
    first.unmount();

    // 再打开面板不会又弹一次旧抽屉
    const second = render(<KnowledgePanel status="ready" data={knowledge()} loadSources={loadSources} />);
    expect(within(second.container).queryByTestId("kg-source-drawer")).not.toBeInTheDocument();
    expect(loadSources).toHaveBeenCalledTimes(1);
  });
});

/* ── TurnMemoryLine 接线（getTurnMemory） ──────────────────────────── */

function turn(overrides: Partial<TurnMemory> = {}): TurnMemory {
  return knowledgeGraph.getTurnMemory.out.parse({
    messageId: "msg-7", captured: [], pending: false, prompt: null, recalled: [], recallDegraded: false, ...overrides,
  });
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const TURN_PATH = `/knowledge-graph/threads/${THREAD}/messages/msg-7/memory`;
let fetchMock: ReturnType<typeof vi.fn>;
function stubTurn(body: Response): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path !== TURN_PATH) throw new Error(`unexpected fetch: ${path}`);
    return body.clone();
  });
  vi.stubGlobal("fetch", fetchMock);
}

describe("TurnMemoryLine：回答下的引用 + 已记下", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-recall");
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("API 返回 recalled：画出引用 footer，且在「已记下 N 条」之前", async () => {
    stubTurn(json(turn({
      recalled: [DECIDE, TODO],
      captured: [{ claimId: "c-new", statement: "孙七负责回滚预案。" }],
    })));
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-7" />);
    const footer = await screen.findByTestId("kg-answer-footer");
    expect(within(footer).getByTestId("kg-citation-c-decide")).toBeInTheDocument();
    const captured = screen.getByTestId("kg-turn-captured");
    expect(captured).toHaveTextContent("已记下 1 条");
    // 顺序：引用在前，已记下在后
    expect(footer.compareDocumentPosition(captured) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toContain("没能查全");
  });

  it("只有 recalled、没有 captured：只画 footer，不画「已记下 0 条」", async () => {
    stubTurn(json(turn({ recalled: [PERSONAL] })));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-7" />);
    await screen.findByTestId("kg-answer-footer");
    expect(screen.queryByTestId("kg-turn-captured")).not.toBeInTheDocument();
  });

  it("recallDegraded=true 而 recalled 为空：照样画那一行提示", async () => {
    stubTurn(json(turn({ recallDegraded: true })));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-7" />);
    expect(await screen.findByTestId("kg-channel-unavailable")).toHaveTextContent(KG_RELATED_QUERY_DEGRADED_ZH);
  });

  it("recalled 与 captured 都空：什么都不渲染", async () => {
    stubTurn(json(turn()));
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-7" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("读失败：什么都不渲染（不挂报错、不回退假数据）", async () => {
    stubTurn(json({ error: "denied", traceId: "t-1", reasonCode: "KG_NOT_VISIBLE" }, 403));
    const { container } = render(<TurnMemoryLine threadId={THREAD} messageId="msg-7" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });
});
