/**
 * F950（2026-08-16 delta）—— 项目筹备「定题与分组」从 mock 切到真实
 * `getProjectTopic`/`saveAndSyncTopic`/`getProjectGrouping`/`updateGrouping`。
 *
 * 直接测 `TabPrep`（不经过整条 `ProjectWorkbench` 拉取链路，同
 * `project-overview-live-info.test.tsx` 对 `TabOverview` 的测法）：父组件的 fetch/刷新
 * 逻辑已经是既有模式（`liveSegments`/`refreshSegments`），这里只钉住 `TabPrep` 本身
 * 拿到 props 后怎么渲染、编辑、提交。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-e2e-demo" } }),
}));

import { TabPrep } from "@/components/project/tab-prep";

const ORG = "org-e2e-demo";
const PROJECT = "p-prep-1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("F950 TabPrep：定题——真实空态 / 编辑保存 / 并发冲突", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let putCalls: { body: unknown }[];

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-950");
    putCalls = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      if (url.pathname === "/organizations/org-e2e-demo/members" && method === "GET") {
        return jsonResponse({ members: [] });
      }
      if (url.pathname === `/projects/${PROJECT}/topic` && method === "PUT") {
        putCalls.push({ body: JSON.parse((init?.body as string) ?? "{}") });
        return jsonResponse({ topicId: PROJECT, syncedTo: ["grouping", "agenda", "ai-context"] });
      }
      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("未定题时是真实空态，不是编造的问题文案", () => {
    render(
      <TabPrep
        view="facilitator" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
      />,
    );
    expect(screen.getByTestId("project-prep-topic-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("project-prep-topic-title")).not.toBeInTheDocument();
  });

  it("引导师编辑定题并保存：发出真实 PUT，body 带 expectedTopicRevision", async () => {
    const onTopicSaved = vi.fn();
    render(
      <TabPrep
        view="facilitator" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
        onTopicSaved={onTopicSaved}
      />,
    );

    fireEvent.click(screen.getByTestId("project-prep-topic-edit"));
    fireEvent.change(screen.getByTestId("project-prep-topic-title-input"), { target: { value: "欧洲市场进入策略" } });
    fireEvent.change(screen.getByTestId("project-prep-topic-background-input"), { target: { value: "Q3 要结果" } });
    fireEvent.click(screen.getByTestId("project-prep-topic-save"));

    await waitFor(() => expect(putCalls).toHaveLength(1));
    expect(putCalls[0]?.body).toMatchObject({
      projectId: PROJECT, title: "欧洲市场进入策略", background: "Q3 要结果",
      expectedTopicRevision: "0", aiGenerated: null,
    });
    await waitFor(() => expect(onTopicSaved).toHaveBeenCalledTimes(1));
  });

  it("组长/组员/观察者不能编辑——没有「编辑」按钮", () => {
    render(
      <TabPrep
        view="member" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "已有主题", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
      />,
    );
    expect(screen.queryByTestId("project-prep-topic-edit")).not.toBeInTheDocument();
  });

  it("并发冲突：保存时后端返回 VERSION_CHANGED，就地显示提示不覆盖", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      if (url.pathname === "/organizations/org-e2e-demo/members" && method === "GET") {
        return jsonResponse({ members: [] });
      }
      if (url.pathname === `/projects/${PROJECT}/topic` && method === "PUT") {
        return jsonResponse({ reasonCode: "VERSION_CHANGED" }, 409);
      }
      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });

    render(
      <TabPrep
        view="facilitator" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "旧标题", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
      />,
    );
    fireEvent.click(screen.getByTestId("project-prep-topic-edit"));
    fireEvent.change(screen.getByTestId("project-prep-topic-title-input"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("project-prep-topic-save"));

    await waitFor(() => {
      expect(screen.getByTestId("project-prep-topic-submit-error")).toHaveTextContent("有人改过了");
    });
  });
});

describe("F950 TabPrep：分组——真实空态 / 加组 / 指派组长组员", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let putCalls: { body: unknown }[];
  const MEMBERS = [
    { userId: "u-1", displayName: "高琳", email: "a@x.com", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
    { userId: "u-2", displayName: "郑好", email: "b@x.com", orgRole: "consultant", teamId: null, joinedAt: "2026-01-01", status: "active" },
  ];

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-950b");
    putCalls = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      if (url.pathname === "/organizations/org-e2e-demo/members" && method === "GET") {
        return jsonResponse({ members: MEMBERS });
      }
      if (url.pathname === `/projects/${PROJECT}/grouping` && method === "PUT") {
        putCalls.push({ body: JSON.parse((init?.body as string) ?? "{}") });
        const body = JSON.parse((init?.body as string) ?? "{}");
        return jsonResponse(body.groups);
      }
      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("未分组时是真实空态", () => {
    render(
      <TabPrep
        view="facilitator" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
      />,
    );
    expect(screen.getByTestId("project-prep-groups-empty")).toBeInTheDocument();
  });

  it("加一组、选组长、勾组员、保存：真实 PUT 带整批分组", async () => {
    const onGroupingSaved = vi.fn();
    render(
      <TabPrep
        view="facilitator" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
        onGroupingSaved={onGroupingSaved}
      />,
    );

    fireEvent.click(screen.getByTestId("project-prep-groups-edit"));
    fireEvent.click(screen.getByTestId("project-prep-groups-add"));

    await waitFor(() => screen.getAllByTestId(/project-prep-group-g-.*-name/));
    const nameInput = screen.getAllByTestId(/project-prep-group-g-.*-name/)[0]!;
    const leaderSelect = screen.getAllByTestId(/project-prep-group-g-.*-leader/)[0]!;
    fireEvent.change(nameInput, { target: { value: "第 1 组" } });
    fireEvent.change(leaderSelect, { target: { value: "u-1" } });

    fireEvent.click(screen.getByTestId("project-prep-groups-save"));

    await waitFor(() => expect(putCalls).toHaveLength(1));
    const body = putCalls[0]?.body as { groups: { name: string; leaderUserId: string }[] };
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({ name: "第 1 组", leaderUserId: "u-1" });
    await waitFor(() => expect(onGroupingSaved).toHaveBeenCalledTimes(1));
  });

  it("组长必填：不选组长直接保存 ⇒ 就地报错，不发请求", async () => {
    render(
      <TabPrep
        view="facilitator" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
      />,
    );
    fireEvent.click(screen.getByTestId("project-prep-groups-edit"));
    fireEvent.click(screen.getByTestId("project-prep-groups-add"));
    fireEvent.click(screen.getByTestId("project-prep-groups-save"));

    await waitFor(() => {
      expect(screen.getByTestId("project-prep-groups-submit-error")).toHaveTextContent("组长");
    });
    expect(putCalls).toHaveLength(0);
  });

  it("观察者看不到分组编排——只有说明文案", () => {
    render(
      <TabPrep
        view="observer" projectId={PROJECT}
        liveTopic={{ topicId: PROJECT, title: "", background: "", revision: "0" }}
        liveGrouping={{ groups: [], revision: "0" }}
      />,
    );
    expect(screen.getByTestId("project-prep-observer-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("project-prep-groups")).not.toBeInTheDocument();
  });
});
