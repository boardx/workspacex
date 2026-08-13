/**
 * PJ-01 —— 新建项目向导（`/project/new`，`NewProjectFlow`）接真实 `POST /projects`。
 *
 * 与 `tests/ui/projects-screen-live.test.tsx`（issue #353）同一模式：假 `fetch`，
 * 不连真实后端；SessionProvider 已在壳层完成登录与 current-org 解析。
 *
 * 本文件钉住的是「接线是真的、且没有假在哪」这几件：
 *   ① 提交发出的是**契约那一份形状**的真实 POST：orgId 取自 provider 的 current-org，
 *      kind 恒为 workshop，blueprintVersionId 恒为 null（发布版本端点未实现），并带鉴权头。
 *   ② 成功后跳到刚建成的那个项目 `/projects/<id>`，用的是响应体里回来的 id，
 *      不是本地编的。
 *   ③ 失败（如 ORG_ROLE_INSUFFICIENT）就地把 reasonCode 显示出来，
 *      **并且按钮恢复可点** —— 旧实现点一次就永久禁用，遇到 403 的人再也建不了。
 *   ④ 界面层防重复提交：提交进行中不会发出第二个请求。
 *   ⑤ 蓝本九宫格现在拉真实 `GET /blueprints`（F175/BP-01 已落地）展示这个组织真实
 *      存在的蓝本，但整体仍然禁用——能被真正套用的是已发布版本的 `blueprintVersionId`，
 *      发布版本端点（`POST /blueprints/:id/versions`）还没实现，`BlueprintRow` 里也
 *      没有这个字段。`stubFetch` 因此要同时应答 `GET /blueprints`（否则该请求落到
 *      真实网络在 jsdom 下报错，虽然组件会吞掉这个错误、不影响其它断言，但会让
 *      `calls` 数组混进一条不相关的调用，污染「只发了一次 POST」这类计数断言）。
 *      六类初始化一览仍与蓝本设计器共用同一份数据源（`INIT_CATEGORIES`），
 *      不另开一份清单（I-17）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const ORG = "org-e2e-demo";
const pushMock = vi.fn();

// `NewProjectFlow` 现在只渲染向导主体（壳层由 page 的 AppShell 提供），但它用
// `useRouter().push` 做建成后的跳转 —— jsdom 下没有 Next 路由上下文，按真实 app
// 提供它的方式 mock 掉，这样测试考的是向导本体而不是路由实现。
vi.mock("next/navigation", () => ({
  usePathname: () => "/project/new",
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: ORG } }),
}));

import { NewProjectFlow } from "@/components/project/new-project-flow";
import { INIT_CATEGORIES } from "@/lib/mock/tpl";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface CreateCall {
  readonly method: string;
  readonly pathname: string;
  readonly auth: string | undefined;
  readonly body: unknown;
}

let calls: CreateCall[];

/** 默认的蓝本目录应答：空列表——大多数用例不关心蓝本区块本身，只是不能让
 *  组件挂载时发出的那次 `GET /blueprints` 落到真实网络、污染 `calls` 计数。 */
function stubFetch(respond: () => Response, blueprintsRespond: () => Response = () => jsonResponse([])) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    calls.push({
      method: init?.method ?? "GET",
      pathname: url.pathname,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    if (url.pathname === "/blueprints") return blueprintsRespond();
    return respond();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  calls = [];
  pushMock.mockClear();
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-pj-01");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PJ-01 提交：真实 POST /projects", () => {
  it("按契约形状发出创建请求，成功后跳进刚建成的那个项目", async () => {
    stubFetch(() =>
      jsonResponse({ id: "p-new-001", kind: "workshop", status: "active", provenanceEventId: "ev-1" }),
    );

    render(<NewProjectFlow />);

    // 没填名字之前不能提交——契约 name 是 min(1)，空名字的请求不该发出去。
    expect(screen.getByTestId("project-new-create")).toBeDisabled();

    fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "  欧洲进入策略 Kickoff  " } });
    fireEvent.click(screen.getByTestId("project-new-create"));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());

    // 挂载时还会真发一次 GET /blueprints（见文件头注）；只筛 POST /projects 那一条断言。
    const createCalls = calls.filter((c) => c.method === "POST" && c.pathname === "/projects");
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]!.auth).toBe("Bearer tok-pj-01");
    expect(createCalls[0]!.body).toEqual({
      orgId: ORG,
      name: "欧洲进入策略 Kickoff", // 首尾空白已裁掉，不是原样发出去
      kind: "workshop",
      blueprintVersionId: null,
    });

    // 跳转用的是响应体回来的 id，不是本地编的
    expect(pushMock).toHaveBeenCalledWith(`/projects/p-new-001?org=${ORG}`);
  });

  it("提交进行中不会发出第二个请求（界面层防重复提交）", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        // 挂载时的 GET /blueprints 立即应答，不占用 gate——gate 只用来卡住
        // 「提交」这一次 POST，好在它悬而未决时点第二、第三下。
        if (url.pathname === "/blueprints") return jsonResponse([]);
        calls.push({
          method: init?.method ?? "GET",
          pathname: url.pathname,
          auth: undefined,
          body: null,
        });
        await gate;
        return jsonResponse({ id: "p-new-002", kind: "workshop", status: "active", provenanceEventId: "ev-2" });
      }),
    );

    render(<NewProjectFlow />);
    fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "重复提交测试" } });

    const btn = screen.getByTestId("project-new-create");
    fireEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    fireEvent.click(btn);
    fireEvent.click(btn);

    release();
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(calls).toHaveLength(1);
  });
});

describe("PJ-01 失败面：不静默、不锁死", () => {
  it("后端拒绝时就地显示 reasonCode，且按钮恢复可点", async () => {
    stubFetch(() =>
      jsonResponse({ error: "forbidden", traceId: "t-1", reasonCode: "ORG_ROLE_INSUFFICIENT" }, 403),
    );

    render(<NewProjectFlow />);
    fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "无权限也要试一下" } });
    fireEvent.click(screen.getByTestId("project-new-create"));

    const err = await screen.findByTestId("project-new-error");
    expect(err).toHaveTextContent("ORG_ROLE_INSUFFICIENT");

    // 没有跳转（项目并没有建成），按钮回到可点状态
    expect(pushMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("project-new-create")).toBeEnabled());
  });
});

describe("PJ-01 如实标注：没接的东西不装成接了", () => {
  it("蓝本目录拉真实 GET /blueprints，展示的卡片整体禁用，如实说明没有可套用的发布版本", async () => {
    stubFetch(
      () => jsonResponse({ error: "not_used_in_this_test" }, 500),
      () =>
        jsonResponse([
          {
            blueprintId: "bp-real-1", name: "供应链韧性工作坊", state: "draft", durationTier: "custom",
            agendaSegmentCount: 0, completeness: { done: 2, denominator: 15 }, appliedProjectCount: 0,
          },
          {
            blueprintId: "bp-real-2", name: "门店动线优化共创", state: "published", durationTier: "half-day",
            agendaSegmentCount: 7, completeness: { done: 15, denominator: 15 }, appliedProjectCount: 4,
          },
        ]),
    );

    render(<NewProjectFlow />);

    const note = await screen.findByTestId("project-new-blueprint-unavailable");
    expect(note).toHaveTextContent("已有 2 个蓝本，但还没有可套用的已发布版本");

    const grid = await screen.findByTestId("project-new-blueprints");
    for (const id of ["bp-real-1", "bp-real-2"]) {
      expect(within(grid).getByTestId(`project-new-blueprint-${id}`)).toBeDisabled();
    }
    // 真数据，不是编出来的目录：卡片文案里能看到后端给的名字，不是 mock 目录的措辞。
    expect(grid).toHaveTextContent("供应链韧性工作坊");
    expect(grid).toHaveTextContent("门店动线优化共创");
  });

  it("这个组织没有任何蓝本时，如实显示空态而不是假目录", async () => {
    stubFetch(
      () => jsonResponse({ error: "not_used_in_this_test" }, 500),
      () => jsonResponse([]),
    );

    render(<NewProjectFlow />);

    const note = await screen.findByTestId("project-new-blueprint-unavailable");
    await waitFor(() => expect(note).toHaveTextContent("这个组织还没有人建过蓝本"));
    expect(screen.queryByTestId("project-new-blueprints")).not.toBeInTheDocument();
  });

  it("契约收不到的四项标注为不写入后端，且不是可编辑输入框", () => {
    render(<NewProjectFlow />);

    expect(screen.getByTestId("project-new-unpersisted-note")).toHaveTextContent("本版不写入后端");
    for (const id of [
      "project-new-linked-source",
      "project-new-duration",
      "project-new-datetime",
      "project-new-headcount",
    ]) {
      expect(within(screen.getByTestId(id)).queryByRole("textbox")).toBeNull();
    }
  });

  it("六类初始化一览仍与蓝本设计器同源（I-17），不多不少", () => {
    render(<NewProjectFlow />);
    const preview = screen.getByTestId("project-new-init-preview");
    expect(within(preview).getAllByTestId("project-new-init-item")).toHaveLength(INIT_CATEGORIES.length);
    for (const c of INIT_CATEGORIES) {
      expect(preview.textContent).toContain(c.label);
    }
  });
});
