/**
 * Issue #4363（S6）—— 大脑页的时间维度：链式取代历史（211 → 985 → 清华，从新到旧）、「已过期」标记、待办状态可改。
 * 网络在 `fetch` 这一层打桩（真 lib/knowledge-graph-api.ts、真契约校验），同 brain-screen.test.tsx。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-brain" } }),
}));

import { knowledgeGraph, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import type { BrainOverview, PersonalKnowledge } from "@/lib/knowledge-graph-api";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";
import { BrainScreen } from "@/components/brain/brain-screen";
import { ClaimTimeBadges } from "@/components/chat/knowledge/claim-time-badges";

const ME = "u-me";
const PSCOPE = { kind: "personal", id: ME } as const;

function claim(id: string, kind: KgClaim["kind"], statement: string, over: Partial<KgClaim> = {}): KgClaim {
  return {
    id, scope: PSCOPE, kind, statement, status: "proposed", triState: "pending", confidence: 0.8, createdBy: "model",
    reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [],
    supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-24T08:00:00Z", ...over,
  };
}

const PERSONAL: PersonalKnowledge = knowledgeGraph.getPersonalKnowledge.out.parse({
  scope: PSCOPE, revision: 7, objects: [], edges: [],
  claims: [
    claim("p-qh", "decision", "改成关注清华高校"),
    claim("p-trip", "fact", "这周我在上海出差", { validUntil: "2026-09-28T00:00:00+08:00", expired: true, todoStatus: null }),
    claim("p-todo", "todo", "下个月之前交报告", { todoStatus: "open", dueAt: "2026-10-01T00:00:00+08:00", validUntil: null, expired: false }),
  ],
  // 服务端给的顺序故意打乱：界面按 step 从新到旧排
  replaced: [
    { byClaimId: "p-qh", replaces: { claimId: "p-211", statement: "我决定关注 211 高校" }, undo: null,
      step: 2, replacedBy: { claimId: "p-985", statement: "改成关注 985 高校" } },
    { byClaimId: "p-qh", replaces: { claimId: "p-985", statement: "改成关注 985 高校" }, undo: { threadId: "thr-c", noticeId: "n-2" } },
  ],
});
const OVERVIEW: BrainOverview = { threads: [], personalOrigins: [] };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
let personal: PersonalKnowledge = PERSONAL;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-brain");
  personal = PERSONAL;
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const p = new URL(String(input), "http://localhost").pathname;
    if (p === "/knowledge-graph/personal") return json(personal);
    if (p === "/knowledge-graph/me/overview") return json(OVERVIEW);
    if (p === "/knowledge-graph/claims/p-todo/todo-status" && init?.method === "POST") {
      const { status } = JSON.parse(String(init.body)) as { status: "open" | "done" | "dropped" };
      personal = { ...personal, claims: personal.claims.map((c) => (c.id === "p-todo" ? { ...c, todoStatus: status } : c)) };
      return json({ claimId: "p-todo", status, claimIds: ["p-todo", "c-todo"] });
    }
    throw new Error(`unexpected fetch: ${p}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const item = (statement: string) =>
  screen.getAllByTestId("brain-personal-item").find((li) => li.textContent?.includes(statement))!;

describe("大脑页：时间维度（issue #4363）", () => {
  it("链式取代历史：清华下面从新到旧——「取代了：985」（可撤销）、「更早是：211」（不可撤销）", async () => {
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    const rows = within(item("改成关注清华高校")).getAllByTestId("brain-replaced");
    expect(rows.map((r) => within(r).getByTestId("brain-replaced-text").textContent)).toEqual([
      "取代了：改成关注 985 高校", "更早是：我决定关注 211 高校",
    ]);
    expect(within(rows[0]!).queryByTestId("brain-undo-supersede")).not.toBeNull();
    expect(within(rows[1]!).queryByTestId("brain-undo-supersede")).toBeNull();
    // 链上的旧说法不单独成一条
    expect(screen.getAllByTestId("brain-personal-item")).toHaveLength(3);
  });

  it("过期的仍列出，标「已过期」（带文字，不只靠颜色）；没过期的不标", async () => {
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    expect(within(item("这周我在上海出差")).getByTestId("kg-claim-expired").textContent).toMatch(/^已过期 · 到 \d+\/\d+ 为止$/);
    expect(within(item("改成关注清华高校")).queryByTestId("kg-claim-expired")).toBeNull();
    expect(within(item("下个月之前交报告")).queryByTestId("kg-claim-expired")).toBeNull();
  });

  it("待办显示状态与截止；点「做完了」⇒ POST todo-status，重读后按钮与标签都是「做完了」，截止不再显示", async () => {
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    const todo = item("下个月之前交报告");
    expect(within(todo).getByTestId("kg-todo-status-open").textContent).toBe("还没做");
    expect(within(todo).getByTestId("kg-todo-due").textContent).toMatch(/^截止 \d+\/\d+$/);
    expect(within(todo).getByTestId("brain-todo-set-open").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(todo).getByTestId("brain-todo-set-done"));
    await waitFor(() => expect(within(item("下个月之前交报告")).getByTestId("kg-todo-status-done").textContent).toBe("做完了"));
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/todo-status"))!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ status: "done" });
    expect(within(item("下个月之前交报告")).getByTestId("brain-todo-set-done").getAttribute("aria-pressed")).toBe("true");
    expect(within(item("下个月之前交报告")).queryByTestId("kg-todo-due")).toBeNull();
    // 非待办没有状态按钮
    expect(within(item("这周我在上海出差")).queryByTestId("brain-todo-set-done")).toBeNull();
  });

  it("新加的文字不出现内部术语", async () => {
    render(<BrainScreen />);
    await screen.findByTestId("brain-personal");
    const page = screen.getByTestId("brain-personal").textContent ?? "";
    for (const w of KG_BANNED_USER_FACING_WORDS) expect(page).not.toContain(w);
  });
});

describe("ClaimTimeBadges（面板与大脑页共用）", () => {
  it("没有时间维度 ⇒ 什么都不渲染；有效期没过 ⇒「有效到 M/D」（左闭右开，显示最后一天）", () => {
    const { container, rerender } = render(<ClaimTimeBadges claim={{}} />);
    expect(container.textContent).toBe("");
    rerender(<ClaimTimeBadges claim={{ validUntil: new Date(2026, 9, 5).toISOString(), expired: false }} />);
    expect(screen.getByTestId("kg-claim-valid-until").textContent).toBe("有效到 10/4");
  });
});
