/**
 * 项目中枢 B2-S2 —— 研究洞察 › 问卷 / 用户洞察 / 深度研究 / 录音转写 子页读真实的项目资源列表。
 * 钉住：`sub=survey|itv|research|transcript` 真的切到 `ProjectResourceSection`，且只显示该类 /
 * 空态说清怎么加 / 403 如实显示 / 「在本项目中新建」带 `?projectId=` 去对应 Studio /
 * 「关联已有」列出调用者自己的资源（减去已挂上的）并向 `POST /projects/:id/resources` 发正确的正文 /
 * 观察者没有任何写入口 / 访谈没有「关联已有」。只 mock 网络边界（`fetch`）与路由。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/p1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { TabResearch } from "@/components/project/tab-research";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
const item = (kind: string, id: string, title: string) => ({
  kind, id, title, ownerUserId: "u1", status: kind === "survey" ? "draft" : null,
  updatedAt: "2026-09-27T01:00:00.000Z", linkedAt: "2026-09-27T02:00:00.000Z",
});
const RESOURCES = {
  items: [item("survey", "s1", "并网周期问卷"), item("guided_research", "g1", "储能政策研究"), item("interview", "i1", "采购访谈"), item("personal_transcription", "t1", "周会录音")],
  counts: { survey: 1, guided_research: 1, personal_transcription: 1, interview: 1 },
};

type Route = (url: URL, init?: RequestInit) => Response | Promise<Response>;
function stubFetch(route: Route) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    return route(url, init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("B2-S2 研究洞察 › 项目资源子页", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["survey", "s1", "/studio/survey/s1?projectId=p1", "/studio/survey/new?projectId=p1"],
    ["research", "g1", "/research?session=g1&projectId=p1", "/research?flow=home&projectId=p1"],
    ["itv", "i1", "/itv/i1/setup?projectId=p1", "/itv?create=1&projectId=p1"],
    ["transcript", "t1", "/rec?session=t1&projectId=p1", "/rec?create=1&projectId=p1"],
  ] as const)("sub=%s 只列该类资源，卡片与「新建」都带 ?projectId= 往返", async (sub, id, detailHref, newHref) => {
    const fetchMock = stubFetch((url) => url.pathname === "/projects/p1/resources" ? json(RESOURCES) : json({ error: "nope" }, 500));
    render(<TabResearch view="facilitator" sub={sub} projectId="p1" />);
    const card = await screen.findByTestId(`project-resource-${id}`);
    expect(card).toHaveAttribute("href", detailHref);
    expect(screen.getByTestId("project-resources-list").querySelectorAll("li")).toHaveLength(1);
    expect(screen.getByTestId("project-resources-new").getAttribute("href")).toBe(newHref);
    expect(screen.queryByTestId("project-research")).toBeNull();
    expect(fetchMock.mock.calls.every(([u]) => new URL(String(u)).pathname === "/projects/p1/resources")).toBe(true);
  });

  it("空态说清怎么加；观察者既没有新建也没有关联入口", async () => {
    stubFetch(() => json({ items: [], counts: { survey: 0, guided_research: 0, personal_transcription: 0, interview: 0 } }));
    const { unmount } = render(<TabResearch view="facilitator" sub="survey" projectId="p1" />);
    expect(await screen.findByTestId("project-resources-empty")).toHaveTextContent("关联已有问卷");
    expect(screen.getByTestId("project-resources-link-open")).toBeInTheDocument();
    unmount();
    render(<TabResearch view="observer" sub="survey" projectId="p1" />);
    await screen.findByTestId("project-resources-empty");
    expect(screen.queryByTestId("project-resources-new")).toBeNull();
    expect(screen.queryByTestId("project-resources-link-open")).toBeNull();
  });

  it("非成员 403 NO_PROJECT_ROLE 如实显示，不显示内部错误码", async () => {
    stubFetch(() => json({ error: "forbidden", traceId: "t", reasonCode: "NO_PROJECT_ROLE" }, 403));
    render(<TabResearch view="member" sub="research" projectId="p1" />);
    const err = await screen.findByTestId("project-resources-error");
    expect(err).toHaveTextContent("你不在这个项目里");
    expect(err).not.toHaveTextContent("NO_PROJECT_ROLE");
  });

  it("「关联已有」列出自己的问卷减去已挂上的，点关联向 POST /projects/p1/resources 发 {projectId, kind, resourceId}", async () => {
    let linked = false;
    const fetchMock = stubFetch((url, init) => {
      if (url.pathname === "/projects/p1/resources" && (init?.method ?? "GET") === "GET") {
        return json(linked ? { ...RESOURCES, items: [...RESOURCES.items, item("survey", "s2", "新挂的问卷")] } : RESOURCES);
      }
      if (url.pathname === "/projects/p1/resources" && init?.method === "POST") {
        linked = true;
        return json({ projectId: "p1", kind: "survey", resourceId: "s2", alreadyLinked: false });
      }
      if (url.pathname === "/surveys") {
        return json([
          { id: "s1", title: "并网周期问卷", updatedAt: "2026-09-27T01:00:00.000Z" },
          { id: "s2", title: "新挂的问卷", updatedAt: "2026-09-26T01:00:00.000Z" },
        ]);
      }
      return json({ error: "nope" }, 500);
    });
    render(<TabResearch view="facilitator" sub="survey" projectId="p1" />);
    await screen.findByTestId("project-resource-s1");
    fireEvent.click(screen.getByTestId("project-resources-link-open"));
    const link = await screen.findByTestId("project-resources-link-s2");
    expect(screen.queryByTestId("project-resources-link-s1")).toBeNull();
    fireEvent.click(link);
    await screen.findByTestId("project-resource-s2");
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(post).toBeDefined();
    expect(new URL(String(post![0])).pathname).toBe("/projects/p1/resources");
    expect(JSON.parse(String(post![1]!.body))).toEqual({ projectId: "p1", kind: "survey", resourceId: "s2" });
  });

  it("移出项目向 DELETE /projects/p1/resources/survey/s1 发请求；#4615 起访谈也可关联 / 移出", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (init?.method === "DELETE") return json({ removed: true });
      return json(RESOURCES);
    });
    const { unmount } = render(<TabResearch view="facilitator" sub="survey" projectId="p1" />);
    fireEvent.click(await screen.findByTestId("project-resource-unlink-s1"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE")!;
    expect(new URL(String(del[0])).pathname).toBe("/projects/p1/resources/survey/s1");
    unmount();
    render(<TabResearch view="facilitator" sub="itv" projectId="p1" />);
    await screen.findByTestId("project-resource-i1");
    expect(screen.getByTestId("project-resources-link-open")).toBeInTheDocument();
    expect(screen.getByTestId("project-resource-unlink-i1")).toBeInTheDocument();
    expect(screen.getByTestId("project-resources-new")).toBeInTheDocument();
  });

  it("#4615 访谈「关联已有」列出自己的访谈（/interviews/digital）减去已挂上的，关联发 kind=interview", async () => {
    const fetchMock = stubFetch((url, init) => {
      if (url.pathname === "/interviews/digital") {
        return json({ items: [
          { interviewId: "i1", name: "采购访谈", tags: [], topic: null, kind: "batch", status: "draft", expertCount: 0, completedExpertCount: 0, primaryAction: "confirm_topic", updatedAt: "2026-09-27T00:00:00.000Z" },
          { interviewId: "i2", name: "运维访谈", tags: [], topic: null, kind: "batch", status: "draft", expertCount: 0, completedExpertCount: 0, primaryAction: "confirm_topic", updatedAt: "2026-09-27T00:00:00.000Z" },
        ] });
      }
      if (init?.method === "POST") return json({ projectId: "p1", kind: "interview", resourceId: "i2", alreadyLinked: false });
      return json(RESOURCES);
    });
    render(<TabResearch view="facilitator" sub="itv" projectId="p1" />);
    fireEvent.click(await screen.findByTestId("project-resources-link-open"));
    await screen.findByTestId("project-resources-link-i2");
    expect(screen.queryByTestId("project-resources-link-i1")).toBeNull();
    fireEvent.click(screen.getByTestId("project-resources-link-i2"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ projectId: "p1", kind: "interview", resourceId: "i2" });
  });
});
