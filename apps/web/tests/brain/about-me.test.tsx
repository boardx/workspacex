/**
 * issue #4360 /brain「关于我」：按 目标 / 偏好 / 约束与身份 / 在做的事 分组，挂了目标的决定 / 待办折叠在目标下；
 * 每条可以改写（revisePersonalClaim）、忘掉（与长期记忆同一个既有动作）、挂到目标 / 摘掉（setGoalLink），并能点回原话。
 * 开场简报关掉过 ⇒ 一行「重新打开」。
 *
 * 网络在 `fetch` 这一层打桩（不替身 `lib/knowledge-graph-api.ts`）：请求路径、方法、请求体、契约 `out` 校验都是真代码在跑。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { knowledgeGraph, type KgClaim } from "@repo/contracts/chat-knowledge-graph";
import { AboutMe } from "@/components/brain/about-me";
import { aboutMe } from "@/lib/about-me-view";
import type { BrainOverview, PersonalKnowledge } from "@/lib/knowledge-graph-api";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";

const ME = "u-me";
const PSCOPE = { kind: "personal", id: ME } as const;
const GOAL = "我的目标是探索未来教育";

function claim(id: string, kind: KgClaim["kind"], statement: string, createdAt = "2026-09-24T08:00:00Z"): KgClaim {
  return {
    id, scope: PSCOPE, kind, statement, status: "proposed", triState: "pending", confidence: 0.9, createdBy: "model",
    reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: `src-${id}`, aboutObjectIds: [],
    supportingCount: 1, contradictingCount: 0, createdAt,
  };
}
const edge = (id: string, src: string, dst: string, relation: "serves_goal" | "derived_from" = "serves_goal") =>
  ({ id, src: { kind: "claim" as const, id: src }, dst: { kind: "claim" as const, id: dst }, relation, createdBy: "model" as const });

const PERSONAL: PersonalKnowledge = knowledgeGraph.getPersonalKnowledge.out.parse({
  scope: PSCOPE, revision: 5, objects: [],
  claims: [
    claim("g1", "goal", GOAL),
    claim("pr1", "preference", "我更喜欢简洁的回答"),
    claim("i1", "fact", "我是一名中学语文老师"),
    claim("d1", "decision", "我决定先调研三所实验学校", "2026-09-25T08:00:00Z"),
    claim("t1", "todo", "整理书架", "2026-09-26T08:00:00Z"),
    claim("f1", "fact", "客户 A 的合同在法务那里"),
  ],
  edges: [edge("e1", "d1", "g1")],
  replaced: [],
});
const ORIGINS: BrainOverview["personalOrigins"] = ["g1", "pr1", "i1", "d1", "t1"].map((id) => ({
  personalClaimId: id, sourceClaimId: `src-${id}`, threadId: "thr-a1", projectId: null, threadTitle: "聊聊教育", saidAt: "2026-09-26T12:00:00Z", autoCopied: true,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
function stubNetwork(route: (path: string, init?: RequestInit) => Response | undefined): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = route(new URL(url, "http://localhost").pathname, init);
    if (!res) throw new Error(`unexpected fetch: ${url}`);
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
}
const calls = () => fetchMock.mock.calls.map(([u, init]) => ({
  path: new URL(String(u), "http://localhost").pathname, method: (init as RequestInit | undefined)?.method ?? "GET",
  body: (init as RequestInit | undefined)?.body === undefined ? undefined : JSON.parse(String((init as RequestInit).body)),
}));
const briefingRoute = (dismissed: boolean) => (p: string, init?: RequestInit) =>
  p === "/knowledge-graph/briefing" ? json({ dismissed, items: [] })
    : p === "/knowledge-graph/briefing/preference" && init?.method === "PUT" ? json({ dismissed: false }) : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("「关于我」投影", () => {
  it("四组固定顺序；挂了目标的决定折叠到目标下；与「你」无关的事实不进画像", () => {
    const v = aboutMe(PERSONAL);
    expect(v.groups.map((g) => [g.section, g.claims.map((c) => c.id)])).toEqual([
      ["goals", ["g1"]], ["preferences", ["pr1"]], ["identity", ["i1"]], ["doing", ["t1"]],
    ]);
    expect(v.childrenOf.get("g1")?.map((c) => c.id)).toEqual(["d1"]);
    expect(v.goalOf.get("d1")).toBe("g1");
    expect(v.total).toBe(5);
  });

  it("挂接的一端已不在（目标被忘掉）⇒ 决定回到「在做的事」", () => {
    const v = aboutMe({ ...PERSONAL, claims: PERSONAL.claims.filter((c) => c.id !== "g1") });
    expect(v.groups.find((g) => g.section === "doing")?.claims.map((c) => c.id)).toEqual(["t1", "d1"]);
    expect(v.goalOf.size).toBe(0);
  });
});

describe("/brain「关于我」", () => {
  it("分组显示、每条带「来自你 M/D 的对话」与点回原话的链接；文案不含内部术语", async () => {
    stubNetwork(briefingRoute(false));
    render(<AboutMe personal={PERSONAL} origins={ORIGINS} onChanged={async () => PERSONAL} />);
    const root = screen.getByTestId("about-me");
    expect(within(screen.getByTestId("about-me-group-goals")).getAllByTestId("about-me-statement")[0]!.textContent).toBe(GOAL);
    const children = within(screen.getByTestId("about-me-group-goals")).getByTestId("about-me-goal-children");
    expect(within(children).getByText("我决定先调研三所实验学校")).toBeTruthy();
    expect(within(screen.getByTestId("about-me-group-identity")).getByText("我是一名中学语文老师")).toBeTruthy();
    expect(root.textContent).not.toContain("客户 A 的合同在法务那里");
    expect(screen.getByTestId("about-me-count").textContent).toBe("5");
    expect(within(root).getAllByTestId("brain-origin-link")[0]!.getAttribute("href")).toBe("/chat/thr-a1?memory=src-g1");
    for (const w of KG_BANNED_USER_FACING_WORDS) expect(root.textContent).not.toContain(w);
    await waitFor(() => expect(calls().map((c) => c.path)).toEqual(["/knowledge-graph/briefing"]));
    expect(screen.queryByTestId("about-me-briefing-off")).toBeNull();
  });

  it("改写：POST revise（新说法），成功后静默重读", async () => {
    stubNetwork((p, init) => (p === "/knowledge-graph/personal/claims/g1/revise" && init?.method === "POST" ? json({ claimId: "g1-new" }) : briefingRoute(false)(p, init)));
    const onChanged = vi.fn(async () => PERSONAL);
    render(<AboutMe personal={PERSONAL} origins={ORIGINS} onChanged={onChanged} />);
    const goalItem = within(screen.getByTestId("about-me-group-goals")).getAllByTestId("about-me-item")[0]!;
    // 目标自己的「改写」在前，挂在它下面的决定各有自己的一份
    fireEvent.click(within(goalItem).getAllByTestId("about-me-edit")[0]!);
    fireEvent.change(within(goalItem).getByTestId("about-me-edit-input"), { target: { value: "我的目标是探索未来教育与 AI 的结合" } });
    fireEvent.click(within(goalItem).getByTestId("about-me-edit-save"));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls().find((c) => c.path.endsWith("/revise"))).toEqual({
      path: "/knowledge-graph/personal/claims/g1/revise", method: "POST", body: { statement: "我的目标是探索未来教育与 AI 的结合" },
    });
    expect(screen.queryByTestId("about-me-edit-input")).toBeNull();
  });

  it("忘掉：与长期记忆同一个既有动作（AI 记下、自动记入 ⇒ 撤销自动记入）；做完仍活着就如实说", async () => {
    stubNetwork((p, init) => (p === "/knowledge-graph/threads/thr-a1/claims/src-pr1/personal-copy/undo" ? json({ personalClaimId: "pr1", outcome: "revoked" }) : briefingRoute(false)(p, init)));
    render(<AboutMe personal={PERSONAL} origins={ORIGINS} onChanged={async () => PERSONAL} />);
    const pref = within(screen.getByTestId("about-me-group-preferences")).getAllByTestId("about-me-item")[0]!;
    fireEvent.click(within(pref).getByTestId("about-me-forget"));
    expect(await within(pref).findByTestId("err-about-me")).toBeTruthy();
    expect(calls().some((c) => c.path === "/knowledge-graph/threads/thr-a1/claims/src-pr1/personal-copy/undo" && c.method === "POST")).toBe(true);
  });

  it("挂到目标：PUT goal（选目标 / 选「不挂到目标」）", async () => {
    stubNetwork((p, init) => (p.startsWith("/knowledge-graph/personal/claims/") && init?.method === "PUT"
      ? json({ claimId: p.split("/")[4], goalClaimId: JSON.parse(String(init.body)).goalClaimId }) : briefingRoute(false)(p, init)));
    const onChanged = vi.fn(async () => PERSONAL);
    render(<AboutMe personal={PERSONAL} origins={ORIGINS} onChanged={onChanged} />);
    const todo = within(screen.getByTestId("about-me-group-doing")).getAllByTestId("about-me-item")[0]!;
    const trigger = within(todo).getByTestId("about-me-goal-select");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: GOAL }));
    await waitFor(() => expect(calls().some((c) => c.method === "PUT")).toBe(true));
    expect(calls().find((c) => c.method === "PUT")).toEqual({ path: "/knowledge-graph/personal/claims/t1/goal", method: "PUT", body: { goalClaimId: "g1" } });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("画像为空 ⇒ 一句引导（怎么让我了解你）", async () => {
    stubNetwork(briefingRoute(false));
    render(<AboutMe personal={{ ...PERSONAL, claims: [PERSONAL.claims[5]!], edges: [] }} origins={[]} onChanged={async () => PERSONAL} />);
    expect(screen.getByTestId("about-me-empty").textContent).toContain("我的目标是");
  });

  it("开场简报关掉过 ⇒ 「重新打开」一行，点了 PUT dismissed=false 后消失", async () => {
    stubNetwork(briefingRoute(true));
    render(<AboutMe personal={PERSONAL} origins={ORIGINS} onChanged={async () => PERSONAL} />);
    fireEvent.click(await screen.findByTestId("about-me-briefing-reopen"));
    await waitFor(() => expect(screen.queryByTestId("about-me-briefing-off")).toBeNull());
    expect(calls().find((c) => c.method === "PUT")).toEqual({ path: "/knowledge-graph/briefing/preference", method: "PUT", body: { dismissed: false } });
  });
});
