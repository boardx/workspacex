/**
 * phase-18 F11 —— 记忆面板里「记到我的长期记忆」（uc-18-4 R3 / A1 / E1-E5，U-3）。
 *
 * 与 `claim-edit-menu-actions.test.tsx` 同一个套路：网络在 `fetch` 层打桩成一个有状态的小服务端，
 * 断言的是**真实请求体**（经契约 `in` 校验后发出）、逐条结果怎么上屏、成功后面板重读这一整条链，
 * 不是某个回调被调了。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@xyflow/react", () => import("@/tests/support/xyflow-stub"));

import { knowledgeGraph, type KgClaim, type KgPromotionItemResult } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { PromotionNominations, ThreadKnowledge } from "@/lib/knowledge-graph-api";
import { ThreadKnowledgeTab, useThreadKnowledge } from "@/components/chat/knowledge/thread-knowledge-tab";

const THREAD = "thr-kg-promote";
const SCOPE = { kind: "chat_session", id: THREAD } as const;
const UI_DEADLINE = { timeout: 2_000 };

function triOf(status: KgClaim["status"]): KgClaim["triState"] {
  return status === "accepted" ? "confirmed" : status === "contested" ? "conflict" : "pending";
}
function claim(id: string, kind: KgClaim["kind"], statement: string, status: KgClaim["status"]): KgClaim {
  return {
    id, scope: SCOPE, kind, statement, status, triState: triOf(status), confidence: 0.8, createdBy: "model",
    reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [],
    supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z",
  };
}

/* ── 有状态的桩服务端 ─────────────────────────────────────────────── */

interface PromoteBody { claimIds: string[]; choices?: { claimId: string; choice: "merge" | "coexist" }[] }
interface Server {
  canEdit: boolean;
  canPromote: boolean;
  claims: KgClaim[];
  nominations: PromotionNominations["nominations"];
  promotes: PromoteBody[];
  gets: number;
  nominationGets: number;
  /** 返回 Response = 整批用它回；返回结果数组 = 逐条结果 200；undefined = 默认全部 promoted。 */
  onPromote: (body: PromoteBody) => Response | KgPromotionItemResult[] | undefined;
}
let server: Server;

function readModel(): ThreadKnowledge {
  return knowledgeGraph.getThreadKnowledge.out.parse({
    scope: SCOPE, revision: 3, objects: [], claims: server.claims, edges: [],
    ingestion: { queued: 0, running: 0, failed: 0, failures: [] },
    canEdit: server.canEdit, canPromote: server.canPromote, visibility: "owner_only",
  });
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function failure(status: number, reasonCode: string): Response {
  return json({ error: "rejected", traceId: "t-1", reasonCode }, status);
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-kg-promote");
  server = {
    canEdit: true,
    canPromote: true,
    claims: [
      claim("c-decide", "decision", "王五决定周五发版。", "accepted"),
      claim("c-fact", "fact", "客户 B 需要中文界面。", "proposed"),
      claim("c-risk", "risk", "周五发版可能赶不上测试。", "contested"),
    ],
    nominations: [],
    promotes: [],
    gets: 0,
    nominationGets: 0,
    onPromote: () => undefined,
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
    const method = init?.method ?? "GET";
    if (path === `/knowledge-graph/threads/${THREAD}` && method === "GET") {
      server.gets += 1;
      return json(readModel());
    }
    if (path === `/knowledge-graph/threads/${THREAD}/nominations` && method === "GET") {
      server.nominationGets += 1;
      return json({ nominations: server.nominations });
    }
    if (path === `/knowledge-graph/threads/${THREAD}/promote` && method === "POST") {
      const body = JSON.parse(String(init?.body)) as PromoteBody;
      server.promotes.push(body);
      const out = server.onPromote(body);
      if (out instanceof Response) return out;
      const results = out ?? body.claimIds.map((id, i) => ({ claimId: id, outcome: "promoted" as const, personalClaimId: `p-${String(i)}` }));
      // U-3：人点了就算确认——被记下的那几条在服务端变成「你确认过」
      for (const r of results) {
        if (r.outcome === "promoted") {
          server.claims = server.claims.map((c) => (c.id === r.claimId ? { ...c, status: "accepted", triState: "confirmed" } : c));
        }
      }
      return json({ results });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function Harness() {
  const state = useThreadKnowledge(THREAD);
  return <ThreadKnowledgeTab state={state} />;
}
async function renderPanel() {
  const utils = render(<Harness />);
  await screen.findByTestId("kg-list");
  return utils;
}
/** Radix DropdownMenu 靠 pointerdown 开（jsdom 下 click 不开），菜单项靠 click 选中。 */
function openMenu(claimId: string): void {
  fireEvent.pointerDown(screen.getByTestId(`kg-claim-edit-trigger-${claimId}`), { button: 0, ctrlKey: false });
}
function promoteFromMenu(claimId: string): void {
  openMenu(claimId);
  fireEvent.click(screen.getByTestId(`kg-action-promote-${claimId}`));
}

describe("入口：只在所有者的个人对话里出现", () => {
  it("canPromote=false（不是个人对话）：多选入口、菜单项、提名都不画，也不去取提名", async () => {
    server.canPromote = false;
    server.nominations = [{ claimId: "c-fact", rationale: "常用。" }];
    await renderPanel();
    expect(screen.queryByTestId("kg-promote-enter")).not.toBeInTheDocument();
    openMenu("c-fact");
    expect(screen.getByTestId("kg-action-revise-c-fact")).toBeInTheDocument(); // 菜单确实开了
    expect(screen.queryByTestId("kg-action-promote-c-fact")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kg-nomination-card")).not.toBeInTheDocument();
    expect(server.nominationGets).toBe(0);
  });

  it("反证：canPromote=true 时入口在，且菜单里说清「记下后即视为你确认过」（U-3）", async () => {
    await renderPanel();
    expect(screen.getByTestId("kg-promote-enter")).toHaveTextContent("记到我的长期记忆");
    openMenu("c-fact");
    expect(screen.getByTestId("kg-action-promote-c-fact")).toHaveTextContent("记到我的长期记忆");
    expect(screen.getByTestId("kg-promote-confirms-c-fact")).toHaveTextContent("记下后即视为你确认过");
  });
});

describe("提交与逐条结果", () => {
  it("单条记下成功：请求体只含这一条；显示「已记到你的长期记忆」，面板重读后这条变成「你确认过」", async () => {
    await renderPanel();
    promoteFromMenu("c-fact");
    await waitFor(() => expect(server.promotes).toEqual([{ claimIds: ["c-fact"] }]));
    const row = await screen.findByTestId("kg-promo-c-fact");
    expect(row).toHaveTextContent("已记到你的长期记忆");
    expect(screen.getByTestId("kg-promotion-summary")).toHaveTextContent("已记到长期记忆 1 条");
    await waitFor(
      () => expect(within(screen.getByTestId("kg-claim-c-fact")).getByTestId("kg-tri-state-confirmed")).toBeInTheDocument(),
      UI_DEADLINE,
    );
    expect(server.gets).toBe(2);
  });

  it("多选提交：勾两条 → 一次请求带两条；选择时提示「记下后即视为你确认过」", async () => {
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-promote-enter"));
    expect(screen.getByTestId("kg-promote-hint")).toHaveTextContent("记下后即视为你确认过");
    fireEvent.click(screen.getByTestId("kg-claim-select-c-decide"));
    fireEvent.click(screen.getByTestId("kg-claim-select-c-fact"));
    fireEvent.click(screen.getByTestId("kg-promote-submit"));
    await waitFor(() => expect(server.promotes).toEqual([{ claimIds: ["c-decide", "c-fact"] }]));
    await screen.findByTestId("kg-promo-c-decide");
    expect(screen.getByTestId("kg-promo-c-fact")).toHaveTextContent("已记到你的长期记忆");
  });

  it("needs_choice → 点「合并到已有的那条」：只重发这一条并带 choices；结果换成「已并入」", async () => {
    server.onPromote = (body) => (body.choices
      ? [{ claimId: "c-fact", outcome: "merged_into_existing", personalClaimId: "p-old" }]
      : [{ claimId: "c-fact", outcome: "needs_choice", existingPersonalClaimId: "p-old" }]);
    await renderPanel();
    promoteFromMenu("c-fact");
    const card = await screen.findByTestId("kg-promo-c-fact");
    expect(card).toHaveTextContent("长期记忆里已有同样的一条");
    expect(within(card).getByTestId("kg-choice-coexist-c-fact")).toHaveTextContent("两条都保留");
    fireEvent.click(within(card).getByTestId("kg-choice-merge-c-fact"));
    await waitFor(() => expect(server.promotes.at(-1)).toEqual({
      claimIds: ["c-fact"], choices: [{ claimId: "c-fact", choice: "merge" }],
    }));
    await waitFor(() => expect(screen.getByTestId("kg-promo-c-fact")).toHaveTextContent("已并入长期记忆里同样的一条"), UI_DEADLINE);
    expect(screen.queryByTestId("kg-choice-merge-c-fact")).not.toBeInTheDocument();
  });

  it("逐条被拒：显示人话，不显示内部码；其余条照样成功（部分成功不回滚）", async () => {
    server.onPromote = () => [
      { claimId: "c-decide", outcome: "promoted", personalClaimId: "p-1" },
      { claimId: "c-risk", outcome: "rejected", code: "KG_CONTESTED_NEEDS_RESOLUTION" },
      { claimId: "c-fact", outcome: "rejected", code: "KG_EVIDENCE_REVOKED" },
    ];
    await renderPanel();
    fireEvent.click(screen.getByTestId("kg-promote-enter"));
    for (const id of ["c-decide", "c-risk", "c-fact"]) fireEvent.click(screen.getByTestId(`kg-claim-select-${id}`));
    fireEvent.click(screen.getByTestId("kg-promote-submit"));
    expect(await screen.findByTestId("kg-promo-reject-reason-c-risk")).toHaveTextContent("有矛盾，先解决再记下");
    expect(screen.getByTestId("kg-promo-reject-reason-c-fact")).toHaveTextContent("原话已经不在了");
    expect(screen.getByTestId("kg-promo-c-decide")).toHaveTextContent("已记到你的长期记忆");
    expect(screen.getByTestId("kg-promotion-summary")).toHaveTextContent("2 条没记下");
    expect(screen.getByTestId("kg-panel").textContent ?? "").not.toMatch(/KG_[A-Z_]+/);
  });

  it("「这条已经不在了」同样是人话", async () => {
    server.onPromote = () => [{ claimId: "c-fact", outcome: "rejected", code: "KG_CLAIM_NOT_FOUND" }];
    await renderPanel();
    promoteFromMenu("c-fact");
    expect(await screen.findByTestId("kg-promo-reject-reason-c-fact")).toHaveTextContent("这条已经不在了");
  });

  it("整批 403（不是所有者 / 不是个人对话）：面板顶部显示人话，不显示内部码", async () => {
    server.onPromote = () => failure(403, "KG_SCOPE_NOT_PERSONAL");
    await renderPanel();
    promoteFromMenu("c-fact");
    const alert = await screen.findByTestId("kg-action-error");
    expect(alert).toHaveTextContent("只有你自己的个人对话，才能把记忆记到长期记忆。");
    expect(alert.textContent ?? "").not.toMatch(/KG_|403/);
    expect(screen.queryByTestId("kg-promotion-summary")).not.toBeInTheDocument();

    server.onPromote = () => failure(403, "KG_NOT_OWNER");
    fireEvent.click(screen.getByTestId("kg-action-error-dismiss"));
    promoteFromMenu("c-fact");
    await waitFor(() => expect(screen.getByTestId("kg-action-error")).toHaveTextContent("只有对话的创建者可以把这里的记忆记到长期记忆。"));
  });
});

describe("AI 提名：只提名，不执行", () => {
  beforeEach(() => {
    server.nominations = [
      { claimId: "c-decide", rationale: "本次对话的核心决定。" },
      { claimId: "c-fact", rationale: "客户的硬性要求，跨会话用得上。" },
      { claimId: "c-gone", rationale: "指向已不在的一条。" },
    ];
  });

  it("渲染提名与理由，但不发任何写请求；指向已不在的一条不画（不上屏内部 id）", async () => {
    await renderPanel();
    const card = await screen.findByTestId("kg-nomination-card");
    expect(within(card).getByTestId("kg-nomination-c-decide")).toHaveTextContent("王五决定周五发版。");
    expect(within(card).getByTestId("kg-nomination-c-fact")).toHaveTextContent("客户的硬性要求，跨会话用得上。");
    expect(within(card).queryByTestId("kg-nomination-c-gone")).not.toBeInTheDocument();
    expect(server.promotes).toEqual([]);
  });

  it("点某条的「记下」：只带这一条去记；记下后那条从提名里消失", async () => {
    await renderPanel();
    await screen.findByTestId("kg-nomination-card");
    fireEvent.click(screen.getByTestId("kg-nomination-promote-one-c-fact"));
    await waitFor(() => expect(server.promotes).toEqual([{ claimIds: ["c-fact"] }]));
    await waitFor(() => expect(screen.queryByTestId("kg-nomination-c-fact")).not.toBeInTheDocument(), UI_DEADLINE);
    expect(screen.getByTestId("kg-nomination-c-decide")).toBeInTheDocument();
  });

  it("可以收起；收起不发请求", async () => {
    await renderPanel();
    fireEvent.click(await screen.findByTestId("kg-nomination-dismiss"));
    expect(screen.queryByTestId("kg-nomination-card")).not.toBeInTheDocument();
    expect(server.promotes).toEqual([]);
  });

  it("提名读失败：不画卡片，面板照常", async () => {
    server.nominations = [];
    const original = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(typeof input === "string" ? input : input.toString()).pathname;
      if (path.endsWith("/nominations")) return Promise.resolve(failure(500, "internal"));
      return original(input, init);
    }));
    await renderPanel();
    expect(screen.queryByTestId("kg-nomination-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("err-panel")).not.toBeInTheDocument();
  });
});
