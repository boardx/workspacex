/**
 * phase-18 F11 —— 「记到长期记忆」逐条结果（uc-18-4 R3-5 / R4-E4：部分成功，不整批回滚）。
 *
 * 覆盖：
 *  · 五种 outcome 各自的人话
 *  · 面板上方的汇总计数（记下了几条 / 几条等你选 / 几条没记下）
 *  · needs_choice：「合并」/「两条都保留」只重发这一条并带 choices（真实 POST 请求体），结果原位替换
 *  · rejected：原因是人话，内部码不上屏
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import {
  knowledgeGraph,
  KgPromotionRejectCode,
  type KgClaim,
  type KgPromotionItemResult,
} from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { promoteToPersonal, type PromotionResults, type ThreadKnowledge } from "@/lib/knowledge-graph-api";
import { describePromotionReject } from "@/lib/knowledge-graph-failure";
import { PromotionResultList } from "@/components/chat/knowledge/promotion-result-list";
import { KnowledgePanel } from "@/components/chat/knowledge/knowledge-panel";

const THREAD = "thr-kg-results";
const SCOPE = { kind: "chat_session", id: THREAD } as const;

function claim(id: string, statement: string): KgClaim {
  return {
    id, scope: SCOPE, kind: "fact", statement, status: "accepted", triState: "confirmed",
    confidence: 0.8, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null,
    aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z",
  };
}
const CLAIMS = [
  claim("c-a", "王五决定周五发版。"),
  claim("c-b", "客户 B 需要中文界面。"),
  claim("c-c", "客户 B 的对接人是钱八。"),
  claim("c-d", "赵六整理发版清单。"),
  claim("c-e", "周五发版可能赶不上测试。"),
  claim("c-f", "旧报表下线。"),
];
const LABEL = (id: string): string => CLAIMS.find((c) => c.id === id)?.statement ?? id;

const MIXED: PromotionResults = knowledgeGraph.promoteToPersonal.out.parse({
  results: [
    { claimId: "c-a", outcome: "promoted", personalClaimId: "p-a" },
    { claimId: "c-b", outcome: "merged_into_existing", personalClaimId: "p-b" },
    { claimId: "c-c", outcome: "coexisting", personalClaimId: "p-c" },
    { claimId: "c-d", outcome: "needs_choice", existingPersonalClaimId: "p-d" },
    { claimId: "c-e", outcome: "rejected", code: "KG_CONTESTED_NEEDS_RESOLUTION" },
    { claimId: "c-f", outcome: "rejected", code: "KG_EVIDENCE_REVOKED" },
  ] satisfies KgPromotionItemResult[],
});

function knowledge(): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: SCOPE, revision: 4, objects: [], claims: CLAIMS, edges: [],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    canEdit: true, canPromote: true, visibility: "owner_only", extractionActive: true,
  });
}

let promoteBodies: unknown[];
let reply: (body: { claimIds: string[]; choices?: { claimId: string; choice: string }[] }) => KgPromotionItemResult[];
beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-results");
  promoteBodies = [];
  reply = () => [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    if (path === `/knowledge-graph/threads/${THREAD}/promote` && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Parameters<typeof reply>[0];
      promoteBodies.push(body);
      return new Response(JSON.stringify({ results: reply(body) }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch: ${path}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("PromotionResultList：逐条结果说人话", () => {
  it("五种结果各一句人话", () => {
    render(<PromotionResultList data={MIXED} claimLabel={LABEL} />);
    expect(screen.getByTestId("kg-promo-c-a")).toHaveTextContent("已记到你的长期记忆");
    expect(screen.getByTestId("kg-promo-c-b")).toHaveTextContent("已并入长期记忆里同样的一条");
    expect(screen.getByTestId("kg-promo-c-c")).toHaveTextContent("和已有的一条并存");
    expect(screen.getByTestId("kg-promo-c-d")).toHaveTextContent("长期记忆里已有同样的一条：「赵六整理发版清单。」");
    expect(screen.getByTestId("kg-promo-reject-reason-c-e")).toHaveTextContent("有矛盾，先解决再记下");
    expect(screen.getByTestId("kg-promo-reject-reason-c-f")).toHaveTextContent("原话已经不在了");
  });

  it("被拒原因是人话，任何内部码都不上屏", () => {
    const all: PromotionResults = {
      results: KgPromotionRejectCode.options.map((code, i) => ({ claimId: `c-${String(i)}`, outcome: "rejected" as const, code })),
    };
    const { container } = render(<PromotionResultList data={all} claimLabel={(id) => `第 ${id} 条`} />);
    for (const code of KgPromotionRejectCode.options) {
      expect(container.textContent).not.toContain(code);
      expect(describePromotionReject(code)).not.toMatch(/KG_|[A-Z]{2,}_/);
    }
    expect(container.textContent).not.toMatch(/KG_/);
  });

  it("不传 onChoice（静态预览）时选择按钮照画，点了不会发请求", () => {
    render(<PromotionResultList data={MIXED} claimLabel={LABEL} />);
    fireEvent.click(screen.getByTestId("kg-choice-merge-c-d"));
    expect(promoteBodies).toEqual([]);
  });

  it("busy 期间选择按钮禁用", () => {
    render(<PromotionResultList data={MIXED} claimLabel={LABEL} onChoice={() => {}} busy />);
    expect(screen.getByTestId("kg-choice-merge-c-d")).toBeDisabled();
    expect(screen.getByTestId("kg-choice-coexist-c-d")).toBeDisabled();
  });
});

describe("面板里的逐条结果", () => {
  function renderPanel() {
    render(
      <KnowledgePanel
        status="ready"
        data={knowledge()}
        writeActions={{
          apply: () => Promise.resolve(),
          onPromote: (ids, choices) => promoteToPersonal(THREAD, ids, choices),
        }}
        initialPromotionResult={MIXED}
      />,
    );
  }

  it("汇总计数：记下了 3 条（新记 + 并入 + 并存）· 1 条等你选 · 2 条没记下", () => {
    renderPanel();
    expect(within(screen.getByTestId("kg-promotion-summary")).getByRole("status"))
      .toHaveTextContent("已记到长期记忆 3 条 · 1 条等你选 · 2 条没记下");
  });

  it("needs_choice →「合并到已有的那条」：只重发这一条并带 choices；结果原位换成「已并入」，其它条不动", async () => {
    reply = (body) => (body.choices ? [{ claimId: "c-d", outcome: "merged_into_existing", personalClaimId: "p-d" }] : []);
    renderPanel();
    fireEvent.click(screen.getByTestId("kg-choice-merge-c-d"));
    await waitFor(() => expect(promoteBodies).toEqual([{ claimIds: ["c-d"], choices: [{ claimId: "c-d", choice: "merge" }] }]));
    await waitFor(() => expect(screen.getByTestId("kg-promo-c-d")).toHaveTextContent("已并入长期记忆里同样的一条"));
    expect(screen.queryByTestId("kg-choice-merge-c-d")).not.toBeInTheDocument();
    expect(screen.getByTestId("kg-promo-c-a")).toHaveTextContent("已记到你的长期记忆");
    expect(screen.getByTestId("kg-promo-reject-reason-c-e")).toHaveTextContent("有矛盾，先解决再记下");
    expect(screen.getByTestId("kg-promotion-summary")).toHaveTextContent("已记到长期记忆 4 条 · 2 条没记下");
  });

  it("needs_choice →「两条都保留」：重发带 coexist；结果换成「并存」", async () => {
    reply = (body) => (body.choices ? [{ claimId: "c-d", outcome: "coexisting", personalClaimId: "p-d2" }] : []);
    renderPanel();
    fireEvent.click(screen.getByTestId("kg-choice-coexist-c-d"));
    await waitFor(() => expect(promoteBodies).toEqual([{ claimIds: ["c-d"], choices: [{ claimId: "c-d", choice: "coexist" }] }]));
    await waitFor(() => expect(screen.getByTestId("kg-promo-c-d")).toHaveTextContent("和已有的一条并存"));
  });
});
