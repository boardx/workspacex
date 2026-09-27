/**
 * S7（#4364）—— 回答下的引用 chip：只画服务端对账后的 `cited`，「依据你 {M/D} 的决定」，点开展开原话 + 跳到原消息，
 * 所有者可以当场纠正：「这条不对」（不填 ⇒ 忘掉卡；填了 ⇒ 改口卡「用〈新〉取代〈旧〉？」）/「已过时」。
 * TurnMemoryLine 那几条在 `fetch` 层打桩，走真实的 `fetchTurnMemory` / `correctCitation`（契约校验）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import { knowledgeGraph, type KgRecalledMemory } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { TurnMemory } from "@/lib/knowledge-graph-api";
import { AnswerKnowledgeFooter } from "@/components/chat/knowledge/answer-knowledge-footer";
import { TurnMemoryLine } from "@/components/chat/knowledge/turn-memory-line";
import { publishKnowledgeSnapshot } from "@/lib/knowledge-graph-events";
import { citationBasisPrefix, citedMemories } from "@/lib/knowledge-graph-citation";

const THREAD = "thr-s7";

function mem(overrides: Partial<KgRecalledMemory> & { claimId: string }): KgRecalledMemory {
  return {
    statement: `结论 ${overrides.claimId}`, kind: "fact", triState: "confirmed", scope: "chat_session",
    saidAt: "2026-09-20T04:00:00Z", channels: ["fts"], retrievalReasons: ["recall"], score: 0.02, graphPath: null,
    ...overrides,
  };
}
const DECIDE = mem({ claimId: "c-db", statement: "主库用 PostgreSQL", kind: "decision" });
const UNUSED = mem({ claimId: "c-unused", statement: "周末不打电话", kind: "preference" });
const GOAL = mem({ claimId: "p-goal", statement: "今年跑完半马", kind: "goal", scope: "personal" });

function localMonthDay(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
}

describe("chip 只画服务端对账后的引用", () => {
  it("cited 是 recalled 的子集：只画 cited 里的；「为什么用到它」仍列全部召回", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE, UNUSED]} cited={["c-db"]} recallDegraded={false} onOpenSource={() => {}} />);
    const chips = screen.getByTestId("kg-citation-chips");
    expect(within(chips).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTestId("kg-citation-c-unused")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kg-why-recall-toggle"));
    expect(screen.getByTestId("kg-recall-reason-c-unused")).toBeInTheDocument();
  });

  it("cited 里有 recalled 之外的 id（不该发生）⇒ 照样不画：chip 只从召回集合里出", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} cited={["c-db", "c-invented"]} recallDegraded={false} onOpenSource={() => {}} />);
    expect(within(screen.getByTestId("kg-citation-chips")).getAllByRole("button")).toHaveLength(1);
    expect(citedMemories([DECIDE], ["c-invented"])).toEqual([]);
  });

  it("cited 为空：不画 chip 区（回答没用到记忆），但「为什么用到它」还在", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} cited={[]} recallDegraded={false} onOpenSource={() => {}} />);
    expect(screen.queryByTestId("kg-citation-chips")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-why-recall-toggle")).toBeInTheDocument();
  });

  it("chip 写「依据你 {M/D} 的决定」；长期记忆的写「依据你的目标」（日期在「来自你…的对话」上）", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE, GOAL]} recallDegraded={false} onOpenSource={() => {}} />);
    expect(screen.getByTestId("kg-cite-basis-c-db")).toHaveTextContent(`依据你 ${localMonthDay(DECIDE.saidAt!)} 的决定`);
    expect(screen.getByTestId("kg-cite-basis-p-goal")).toHaveTextContent("依据你的目标");
    expect(citationBasisPrefix({ scope: "chat_session", saidAt: null })).toBe("依据你的");
  });
});

describe("点开一条引用：原话 + 跳到原消息 + 纠正", () => {
  it("点 chip：照旧请求打开来源抽屉，并在下面展开原话；「跳到原消息」调 onJump", async () => {
    const onOpenSource = vi.fn();
    const onJump = vi.fn(() => Promise.resolve(true));
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} recallDegraded={false} onOpenSource={onOpenSource} onJump={onJump} />);
    const chip = screen.getByTestId("kg-citation-c-db");
    fireEvent.click(chip);
    expect(onOpenSource).toHaveBeenCalledWith("c-db");
    expect(chip).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("kg-cite-statement-c-db")).toHaveTextContent("主库用 PostgreSQL");
    fireEvent.click(screen.getByTestId("kg-cite-jump-c-db"));
    await waitFor(() => expect(onJump).toHaveBeenCalledWith("c-db"));
    // 再点一次收起
    fireEvent.click(chip);
    expect(screen.queryByTestId("kg-cite-detail-c-db")).not.toBeInTheDocument();
  });

  it("原话找不到（onJump ⇒ false）：如实说，不假装跳了", async () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} recallDegraded={false} onOpenSource={() => {}} onJump={() => Promise.resolve(false)} />);
    fireEvent.click(screen.getByTestId("kg-citation-c-db"));
    fireEvent.click(screen.getByTestId("kg-cite-jump-c-db"));
    expect(await screen.findByTestId("kg-cite-error-c-db")).toHaveTextContent("原话找不到了");
  });

  it("作用域不在可纠正之列（例如日后召回里出现的项目记忆，delta review L5）：所有者也不给纠正入口", () => {
    const project = { ...DECIDE, claimId: "c-l2", scope: "project" as unknown as KgRecalledMemory["scope"] };
    render(<AnswerKnowledgeFooter recalled={[project, DECIDE]} recallDegraded={false} onOpenSource={() => {}} onJump={() => Promise.resolve(true)} canCorrect onCorrect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("kg-citation-c-l2"));
    expect(screen.getByTestId("kg-cite-detail-c-l2")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-cite-wrong-c-l2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-cite-expired-c-l2")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("kg-citation-c-db"));
    expect(screen.getByTestId("kg-cite-wrong-c-db")).toBeInTheDocument();
  });

  it("不是所有者：没有「这条不对」/「已过时」", () => {
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} recallDegraded={false} onOpenSource={() => {}} onJump={() => Promise.resolve(true)} onCorrect={vi.fn()} />);
    fireEvent.click(screen.getByTestId("kg-citation-c-db"));
    expect(screen.queryByTestId("kg-cite-wrong-c-db")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-cite-expired-c-db")).not.toBeInTheDocument();
  });

  it("「这条不对」不填新说法 ⇒ 出忘掉卡（只列这一条）；点「忘掉」才执行", async () => {
    const onCorrect = vi.fn(() => Promise.resolve({ outcome: "forgotten" as const, newClaimId: null }));
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} recallDegraded={false} onOpenSource={() => {}} onJump={() => Promise.resolve(true)} canCorrect onCorrect={onCorrect} />);
    fireEvent.click(screen.getByTestId("kg-citation-c-db"));
    fireEvent.click(screen.getByTestId("kg-cite-wrong-c-db"));
    const card = screen.getByTestId("kg-card-forget");
    expect(card).toHaveTextContent("主库用 PostgreSQL");
    expect(onCorrect).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByTestId("kg-card-accept"));
    await waitFor(() => expect(onCorrect).toHaveBeenCalledWith("c-db", "wrong", undefined));
    expect(await screen.findByTestId("kg-cite-done-c-db")).toHaveTextContent("已忘掉这条");
  });

  it("「这条不对」填了新说法 ⇒ 出改口卡「用〈新〉取代〈旧〉？」；「取代」才执行，「两条都保留」什么都不改", async () => {
    const onCorrect = vi.fn(() => Promise.resolve({ outcome: "superseded" as const, newClaimId: "c-new" }));
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} recallDegraded={false} onOpenSource={() => {}} onJump={() => Promise.resolve(true)} canCorrect onCorrect={onCorrect} />);
    fireEvent.click(screen.getByTestId("kg-citation-c-db"));
    fireEvent.click(screen.getByTestId("kg-cite-wrong-c-db"));
    fireEvent.change(screen.getByTestId("kg-cite-replacement-c-db"), { target: { value: "主库改用 MySQL" } });
    expect(screen.queryByTestId("kg-card-forget")).not.toBeInTheDocument();
    const card = screen.getByTestId("kg-conflict-card");
    expect(card).toHaveAttribute("data-kind", "possible_change");
    expect(card).toHaveTextContent("用〈主库改用 MySQL〉取代〈主库用 PostgreSQL〉？");
    fireEvent.click(within(card).getByTestId("kg-conflict-keep-both"));
    await screen.findByTestId("kg-conflict-resolved");
    expect(onCorrect).not.toHaveBeenCalled();
    // 换个说法再来一次（改字 ⇒ 新的一张卡），这次点「取代」
    fireEvent.change(screen.getByTestId("kg-cite-replacement-c-db"), { target: { value: "主库改用 MySQL 8" } });
    fireEvent.click(within(screen.getByTestId("kg-conflict-card")).getByTestId("kg-conflict-keep-new"));
    await waitFor(() => expect(onCorrect).toHaveBeenCalledWith("c-db", "wrong", "主库改用 MySQL 8"));
    expect(await screen.findByTestId("kg-cite-done-c-db")).toHaveTextContent("已改成新的说法");
  });

  it("「已过时」要先确认（review F4）：点「已过时」不执行，「取消」收起；「确认」才执行；失败时把人话显示出来、可以再来", async () => {
    const onCorrect = vi.fn()
      .mockRejectedValueOnce(new Error("这条已经不在了，刷新后再看看。"))
      .mockResolvedValueOnce({ outcome: "expired", newClaimId: null });
    render(<AnswerKnowledgeFooter recalled={[DECIDE]} recallDegraded={false} onOpenSource={() => {}} onJump={() => Promise.resolve(true)} canCorrect onCorrect={onCorrect} />);
    fireEvent.click(screen.getByTestId("kg-citation-c-db"));
    fireEvent.click(screen.getByTestId("kg-cite-expired-c-db"));
    expect(onCorrect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("kg-cite-expire-cancel-c-db"));
    expect(screen.queryByTestId("kg-cite-expire-confirm-panel-c-db")).not.toBeInTheDocument();
    expect(onCorrect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("kg-cite-expired-c-db"));
    fireEvent.click(screen.getByTestId("kg-cite-expire-confirm-c-db"));
    expect(await screen.findByTestId("kg-cite-error-c-db")).toHaveTextContent("这条已经不在了");
    fireEvent.click(screen.getByTestId("kg-cite-expire-confirm-c-db"));
    expect(await screen.findByTestId("kg-cite-done-c-db")).toHaveTextContent("已标为过时");
    expect(onCorrect).toHaveBeenLastCalledWith("c-db", "expired", undefined);
  });
});

/* ── TurnMemoryLine 接线（getTurnMemory → correctCitation） ──────────── */

const TURN_PATH = `/knowledge-graph/threads/${THREAD}/messages/msg-9/memory`;
const CORRECT_PATH = `/knowledge-graph/threads/${THREAD}/messages/msg-9/citations/c-db/correction`;

function turn(overrides: Partial<TurnMemory> = {}): TurnMemory {
  return knowledgeGraph.getTurnMemory.out.parse({
    messageId: "msg-9", captured: [], pending: false, prompt: null, supersede: null, recalled: [], recallDegraded: false, ...overrides,
  });
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("TurnMemoryLine：服务端的 cited → chip；纠正走 correctCitation", () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  let turnCanCorrect = true;
  beforeEach(() => {
    calls.length = 0;
    turnCanCorrect = true;
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-s7");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
      calls.push({ path, method: init?.method ?? "GET", body: init?.body === undefined ? null : JSON.parse(String(init.body)) });
      if (path === TURN_PATH) return json(turn({ recalled: [DECIDE, UNUSED], cited: ["c-db"], canCorrect: turnCanCorrect }));
      if (path === CORRECT_PATH) return json({ outcome: "expired", newClaimId: null });
      throw new Error(`unexpected fetch: ${path}`);
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    act(() => publishKnowledgeSnapshot(null));
  });

  it("只画 cited 那一条；所有者点「已过时」⇒ POST correction {kind: expired}", async () => {
    act(() => publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 3 }));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    const chip = await screen.findByTestId("kg-citation-c-db");
    expect(screen.queryByTestId("kg-citation-c-unused")).not.toBeInTheDocument();
    fireEvent.click(chip);
    fireEvent.click(screen.getByTestId("kg-cite-expired-c-db"));
    fireEvent.click(screen.getByTestId("kg-cite-expire-confirm-c-db"));
    expect(await screen.findByTestId("kg-cite-done-c-db")).toBeInTheDocument();
    expect(calls.find((c) => c.path === CORRECT_PATH)).toEqual({ path: CORRECT_PATH, method: "POST", body: { kind: "expired" } });
  });

  it("所有者、但不是这一轮的提问人（服务端 canCorrect=false，review F6）：展开里没有纠正入口", async () => {
    turnCanCorrect = false;
    act(() => publishKnowledgeSnapshot({ threadId: THREAD, canEdit: true, revision: 3 }));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-citation-c-db"));
    expect(screen.getByTestId("kg-cite-detail-c-db")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-cite-wrong-c-db")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-cite-expired-c-db")).not.toBeInTheDocument();
  });

  it("不是所有者（快照 canEdit=false）：展开里没有纠正入口", async () => {
    act(() => publishKnowledgeSnapshot({ threadId: THREAD, canEdit: false, revision: 3 }));
    render(<TurnMemoryLine threadId={THREAD} messageId="msg-9" />);
    fireEvent.click(await screen.findByTestId("kg-citation-c-db"));
    expect(screen.getByTestId("kg-cite-detail-c-db")).toBeInTheDocument();
    expect(screen.queryByTestId("kg-cite-expired-c-db")).not.toBeInTheDocument();
  });
});
