/**
 * 项目中枢 B3-T1（#4495）—— 研究洞察 › 来源 子页读真实的项目证据库。
 * 钉住：`sub=sources` 真的切到 `ProjectEvidenceSection`（GET /projects/:id/evidence）；每条显示来源标签 / 摘录 /
 * 说话人 / 材料标题；chips 用服务端的 `countsBySource` 标数、点一类 ⇒ 带 `?sourceKind=` 重新请求；
 * 「AI 权限」关掉的来源标「已关闭」（AI 权限读不到 ⇒ 不标、不报错）；`nextCursor` ⇒ 「加载更多」带 cursor 追加；
 * 空态 / 403 NO_PROJECT_ROLE 如实显示且不露内部码 / 500 走 httpFailureText。只 mock 网络边界（`fetch`）与路由。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { httpFailureText } from "@/lib/http-failure-text";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/p1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { TabResearch } from "@/components/project/tab-research";
import { formatLocator } from "@/components/project/project-evidence-section";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const COUNTS = { chat_message: 1, attachment: 0, survey_response: 2, interview_segment: 1, transcript_segment: 0, research_source: 0 };
const item = (id: string, sourceKind: string, over: Record<string, unknown> = {}) => ({
  id, projectId: "p1", sourceKind, resourceId: "r", sourceRef: `ref-${id}`, excerpt: `摘录 ${id}`, locator: {},
  speakerLabel: null, resourceTitle: `材料 ${id}`, revoked: false, createdAt: "2026-09-28T00:00:00.000Z", ...over,
});
const PAGE = {
  items: [
    item("ev_1", "survey_response", { locator: { ordinal: 3 } }),
    item("ev_2", "interview_segment", { speakerLabel: "张三", locator: { ordinal: 1, startMs: 65000, endMs: 70000 } }),
    item("ev_3", "chat_message", { resourceTitle: "并网讨论" }),
    item("ev_4", "survey_response"),
  ],
  nextCursor: null,
  countsBySource: COUNTS,
};
const AI = { projectId: "p1", allowedSources: ["chat", "survey"], updatedAt: null, updatedBy: null };

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function stubFetch(route: Route) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return route(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const evidenceCalls = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname === "/projects/p1/evidence");

describe("B3-T1 研究洞察 › 来源：项目证据库", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sub=sources 切到证据列表：来源标签 / 摘录 / 说话人 / 材料标题 / 定位；chips 用 countsBySource；被 AI 权限关掉的来源标「已关闭」", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.pathname === "/projects/p1/evidence") return json(PAGE);
      if (url.pathname === "/projects/p1/ai-settings") return json(AI);
      return json({ error: "nope" }, 500);
    });
    render(<TabResearch view="member" sub="sources" projectId="p1" />);
    const list = await screen.findByTestId("project-evidence-list");
    expect(list.querySelectorAll("li")).toHaveLength(4);
    expect(screen.queryByTestId("project-research")).toBeNull();
    expect(screen.queryByTestId("project-resources")).toBeNull();

    const ev2 = screen.getByTestId("project-evidence-ev_2");
    expect(ev2).toHaveTextContent("访谈片段");
    expect(ev2).toHaveTextContent("摘录 ev_2");
    expect(ev2).toHaveTextContent("材料 ev_2");
    expect(screen.getByTestId("project-evidence-ev_2-speaker")).toHaveTextContent("张三");
    expect(ev2).toHaveTextContent("#1 · 01:05–01:10");
    expect(screen.getByTestId("project-evidence-ev_1-speaker")).toHaveTextContent("匿名答题人");
    expect(screen.getByTestId("project-evidence-ev_3")).toHaveTextContent("对话");
    expect(screen.getByTestId("project-evidence-ev_3")).toHaveTextContent("并网讨论");

    expect(screen.getByTestId("project-evidence-filter-all")).toHaveTextContent("全部 4");
    expect(screen.getByTestId("project-evidence-filter-survey_response")).toHaveTextContent("问卷答卷 2");
    expect(screen.getByTestId("project-evidence-filter-research_source")).toHaveTextContent("深研来源 0");
    // interview 开关没开 ⇒ 访谈片段标「已关闭」；chat / survey 开着 ⇒ 不标
    await waitFor(() => expect(screen.getByTestId("project-evidence-filter-interview_segment")).toHaveTextContent("已关闭"));
    expect(screen.getByTestId("project-evidence-ev_2-off")).toBeInTheDocument();
    expect(screen.queryByTestId("project-evidence-ev_1-off")).toBeNull();
    expect(screen.getByTestId("project-evidence-filter-survey_response")).not.toHaveTextContent("已关闭");
    expect(fetchMock.mock.calls.every(([u]) => ["/projects/p1/evidence", "/projects/p1/ai-settings"].includes(new URL(String(u)).pathname))).toBe(true);
  });

  it("点来源 chip ⇒ 带 ?sourceKind= 重新请求；筛选后空 ⇒ 「这个来源下还没有证据」", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.pathname === "/projects/p1/evidence") {
        const kind = url.searchParams.get("sourceKind");
        return json(kind === null ? PAGE : { ...PAGE, items: PAGE.items.filter((it) => it.sourceKind === kind) });
      }
      if (url.pathname === "/projects/p1/ai-settings") return json({ error: "forbidden", traceId: "t", reasonCode: "NO_PROJECT_ROLE" }, 403);
      return json({ error: "nope" }, 500);
    });
    render(<TabResearch view="observer" sub="sources" projectId="p1" />);
    await screen.findByTestId("project-evidence-list");
    fireEvent.click(screen.getByTestId("project-evidence-filter-survey_response"));
    await waitFor(() => expect(screen.getByTestId("project-evidence-list").querySelectorAll("li")).toHaveLength(2));
    expect(evidenceCalls(fetchMock).at(-1)?.searchParams.get("sourceKind")).toBe("survey_response");
    fireEvent.click(screen.getByTestId("project-evidence-filter-transcript_segment"));
    await screen.findByTestId("project-evidence-filtered-empty");
    // AI 权限读不到（观察者 403）⇒ 不标「已关闭」，也不是错误
    expect(screen.queryByTestId("project-evidence-error")).toBeNull();
    expect(screen.queryByText("已关闭")).toBeNull();
  });

  it("nextCursor ⇒ 「加载更多」带 cursor 追加，追加后按钮消失", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.pathname === "/projects/p1/evidence") {
        const cursor = url.searchParams.get("cursor");
        return json(cursor === null
          ? { ...PAGE, items: PAGE.items.slice(0, 2), nextCursor: "c1" }
          : { ...PAGE, items: PAGE.items.slice(2), nextCursor: null });
      }
      if (url.pathname === "/projects/p1/ai-settings") return json(AI);
      return json({ error: "nope" }, 500);
    });
    render(<TabResearch view="member" sub="sources" projectId="p1" />);
    await screen.findByTestId("project-evidence-list");
    fireEvent.click(await screen.findByTestId("project-evidence-more"));
    await waitFor(() => expect(screen.getByTestId("project-evidence-list").querySelectorAll("li")).toHaveLength(4));
    expect(evidenceCalls(fetchMock).at(-1)?.searchParams.get("cursor")).toBe("c1");
    expect(screen.queryByTestId("project-evidence-more")).toBeNull();
  });

  it("空态说清怎么来证据", async () => {
    stubFetch((url) => url.pathname === "/projects/p1/evidence"
      ? json({ items: [], nextCursor: null, countsBySource: { ...COUNTS, chat_message: 0, survey_response: 0, interview_segment: 0 } })
      : json(AI));
    render(<TabResearch view="member" sub="sources" projectId="p1" />);
    expect(await screen.findByTestId("project-evidence-empty")).toHaveTextContent("挂到项目上");
    expect(screen.queryByTestId("project-evidence-list")).toBeNull();
  });

  it("非成员 403 NO_PROJECT_ROLE 如实显示，不露内部码；500 走 httpFailureText；重试可用", async () => {
    stubFetch(() => json({ error: "forbidden", traceId: "t", reasonCode: "NO_PROJECT_ROLE" }, 403));
    const { unmount } = render(<TabResearch view="member" sub="sources" projectId="p1" />);
    const err = await screen.findByTestId("project-evidence-error");
    expect(err).toHaveTextContent("你不在这个项目里");
    expect(err).not.toHaveTextContent("NO_PROJECT_ROLE");
    expect(screen.queryByTestId("project-evidence-empty")).toBeNull();
    unmount();
    vi.unstubAllGlobals();
    let calls = 0;
    stubFetch((url) => {
      if (url.pathname !== "/projects/p1/evidence") return json(AI);
      calls += 1;
      return calls === 1 ? json({ error: "boom", traceId: "t" }, 500) : json(PAGE);
    });
    render(<TabResearch view="member" sub="sources" projectId="p1" />);
    expect(await screen.findByTestId("project-evidence-error")).toHaveTextContent(httpFailureText(500));
    fireEvent.click(screen.getByTestId("project-evidence-retry"));
    await screen.findByTestId("project-evidence-list");
    expect(screen.queryByTestId("project-evidence-error")).toBeNull();
  });

  it("formatLocator：题号 / 页码 / 时间各自成句，空定位为空串", () => {
    expect(formatLocator({ locator: {}, createdAt: "" })).toBe("");
    expect(formatLocator({ locator: { ordinal: 2 }, createdAt: "" })).toBe("#2");
    expect(formatLocator({ locator: { page: 5, startMs: 0 }, createdAt: "" })).toBe("第 5 页 · 00:00");
  });
});
