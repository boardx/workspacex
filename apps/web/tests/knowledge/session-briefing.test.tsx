/**
 * issue #4362 新个人对话空状态里的开场简报（「接着上次」）。
 *
 *   - 没有可说的（items 为空 / 关掉过）⇒ 整块不出现，也不记「展示」；
 *   - 有内容 ⇒ 三段（上次在做的事 / 没做完的待办 / 还没定下来的），记一次「展示」；
 *   - 「续上」⇒ 把服务端写好的首问填进输入框（onResume），留一行「引用：〈类型〉原文」，记「采纳」；
 *   - 「关闭」⇒ PUT 偏好 dismissed=true + 记「关闭」，整块收起；
 *   - 读不到 ⇒ 一行说明（不影响开始新对话）；
 *   - 空状态只给位置：项目对话不传简报，模板照旧。
 * 网络在 `fetch` 这一层打桩：路径、方法、请求体、契约校验都是真代码。
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { SessionBriefing } from "@/components/chat/knowledge/session-briefing";
import { TaskWorkbenchEmptyState } from "@/components/chat/chat-task-workbench-empty-state";
import type { SessionBriefing as Briefing } from "@/lib/knowledge-graph-api";
import { KG_BANNED_USER_FACING_WORDS } from "@/lib/knowledge-graph-view";

const GOAL = "我的目标是探索未来教育";
const BRIEFING: Briefing = knowledgeGraph.getSessionBriefing.out.parse({
  dismissed: false,
  items: [
    {
      itemId: "recent:p-d1", section: "recent", kind: "decision", cardKind: null, statement: "我决定先调研三所实验学校", counterpart: null,
      goal: { claimId: "p-g1", statement: GOAL }, saidAt: "2026-09-26T12:00:00Z",
      cite: { claimId: "p-d1", scope: "personal", threadId: "thr-a1" }, resumePrompt: "之前定下的：「我决定先调研三所实验学校」。接下来怎么推进？",
    },
    {
      itemId: "recent:p-g1", section: "recent", kind: "goal", cardKind: null, statement: GOAL, counterpart: null, goal: null, saidAt: "2026-09-26T12:00:00Z",
      cite: { claimId: "p-g1", scope: "personal", threadId: null }, resumePrompt: `接着聊我的目标：「${GOAL}」。帮我规划下一步。`,
    },
    {
      itemId: "open_todos:c-t1", section: "open_todos", kind: "todo", cardKind: null, statement: "下周约王老师聊课程设计", counterpart: null, goal: null,
      saidAt: null, cite: { claimId: "c-t1", scope: "chat_session", threadId: "thr-a1" }, resumePrompt: "继续这件待办：「下周约王老师聊课程设计」。现在该做哪一步？",
    },
    {
      itemId: "unresolved:cp1", section: "unresolved", kind: "decision", cardKind: "possible_change", statement: "我决定改成调研五所学校",
      counterpart: { claimId: "c-d0", statement: "我决定先调研三所实验学校" }, goal: null, saidAt: null,
      cite: { claimId: "c-n1", scope: "chat_session", threadId: "thr-a1" },
      resumePrompt: "我之前说「我决定先调研三所实验学校」，后来说「我决定改成调研五所学校」——是不是改主意了？帮我确认一下。",
    },
  ],
});

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
const events = () => calls().filter((c) => c.path === "/knowledge-graph/briefing/events").map((c) => c.body as { event: string; itemIds: string[] });
const serve = (briefing: Briefing) => (p: string, init?: RequestInit) =>
  p === "/knowledge-graph/briefing" && (init?.method ?? "GET") === "GET" ? json(briefing)
    : p === "/knowledge-graph/briefing/events" ? json({ recorded: true })
      : p === "/knowledge-graph/briefing/preference" ? json({ dismissed: true }) : undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("开场简报（issue #4362）", () => {
  it("没有记忆 ⇒ 什么都不显示，也不记「展示」", async () => {
    stubNetwork(serve({ dismissed: false, items: [] }));
    const { container } = render(<SessionBriefing onResume={() => undefined} />);
    await waitFor(() => expect(screen.queryByTestId("session-briefing-loading")).toBeNull());
    expect(container.textContent).toBe("");
    expect(events()).toEqual([]);
  });

  it("关掉过 ⇒ 不显示", async () => {
    stubNetwork(serve({ dismissed: true, items: [] }));
    const { container } = render(<SessionBriefing onResume={() => undefined} />);
    await waitFor(() => expect(screen.queryByTestId("session-briefing-loading")).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("三段、决定带「为了：目标」、可能改口卡带「之前说的」、能点回原话；记一次「展示」；文案不含内部术语", async () => {
    stubNetwork(serve(BRIEFING));
    render(<SessionBriefing onResume={() => undefined} />);
    const root = await screen.findByTestId("session-briefing");
    expect(within(root).getByTestId("session-briefing-section-recent").textContent).toContain("上次在做的事");
    expect(within(root).getByTestId("session-briefing-section-open_todos").textContent).toContain("没做完的待办");
    expect(within(root).getByTestId("session-briefing-section-unresolved").textContent).toContain("可能改口");
    expect(within(root).getByTestId("session-briefing-goal").textContent).toBe(`为了：${GOAL}`);
    expect(within(root).getByTestId("session-briefing-counterpart").textContent).toContain("我决定先调研三所实验学校");
    expect(within(root).getAllByTestId("session-briefing-source").map((a) => a.getAttribute("href"))).toEqual([
      "/chat/thr-a1?memory=1", "/chat/thr-a1?memory=c-t1", "/chat/thr-a1?memory=c-n1",
    ]);
    for (const w of KG_BANNED_USER_FACING_WORDS) expect(root.textContent).not.toContain(w);
    await waitFor(() => expect(events()).toEqual([{ event: "shown", itemIds: BRIEFING.items.map((i) => i.itemId) }]));
  });

  it("续上 ⇒ 首问填进输入框（不发送）、留一行引用、记「采纳」", async () => {
    stubNetwork(serve(BRIEFING));
    const onResume = vi.fn();
    render(<SessionBriefing onResume={onResume} />);
    const todo = (await screen.findAllByTestId("session-briefing-item")).find((li) => li.getAttribute("data-item-id") === "open_todos:c-t1")!;
    fireEvent.click(within(todo).getByTestId("session-briefing-resume"));
    expect(onResume).toHaveBeenCalledWith("继续这件待办：「下周约王老师聊课程设计」。现在该做哪一步？");
    const cited = screen.getByTestId("session-briefing-cited");
    expect(cited.getAttribute("data-claim-id")).toBe("c-t1");
    expect(cited.textContent).toContain("引用：待办：下周约王老师聊课程设计");
    await waitFor(() => expect(events()).toContainEqual({ event: "accepted", itemIds: ["open_todos:c-t1"] }));
  });

  it("关闭 ⇒ PUT dismissed=true + 记「关闭」，整块收起", async () => {
    stubNetwork(serve(BRIEFING));
    render(<SessionBriefing onResume={() => undefined} />);
    fireEvent.click(await screen.findByTestId("session-briefing-dismiss"));
    expect(screen.queryByTestId("session-briefing")).toBeNull();
    await waitFor(() => expect(calls().find((c) => c.method === "PUT")).toEqual({ path: "/knowledge-graph/briefing/preference", method: "PUT", body: { dismissed: true } }));
    expect(events()).toContainEqual({ event: "dismissed", itemIds: BRIEFING.items.map((i) => i.itemId) });
  });

  it("读不到 ⇒ 一行说明，不挡开始新对话", async () => {
    stubNetwork((p) => (p === "/knowledge-graph/briefing" ? json({ reasonCode: "KG_NOT_VISIBLE" }, 403) : undefined));
    render(<SessionBriefing onResume={() => undefined} />);
    expect((await screen.findByTestId("err-session-briefing")).textContent).toContain("不影响开始新对话");
  });

  it("空状态只给位置：传了简报就摆在引导语与模板之间；不传（项目对话）模板照旧、没有简报", () => {
    const { rerender } = render(<TaskWorkbenchEmptyState onUseTemplate={() => undefined} materialsCount={0} skillsCount={0} briefing={<div data-testid="slot">简报</div>} />);
    expect(screen.getByTestId("slot")).toBeTruthy();
    rerender(<TaskWorkbenchEmptyState onUseTemplate={() => undefined} materialsCount={0} skillsCount={0} />);
    expect(screen.queryByTestId("slot")).toBeNull();
    expect(screen.getByTestId("chat-task-workbench-template-research")).toBeTruthy();
  });
});
