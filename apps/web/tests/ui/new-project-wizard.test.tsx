/**
 * PJ-01 —— 新建项目向导（`/project/new`，`NewProjectFlow`）接真实 `POST /projects`。
 *
 * 与 `tests/ui/projects-screen-live.test.tsx`（issue #353）同一模式：假 `fetch`，
 * 不连真实后端；SessionProvider 已在壳层完成登录与 current-org 解析。
 *
 * 本文件钉住的是「接线是真的、且没有假在哪」这几件：
 *   ① 提交发出的是**契约那一份形状**的真实 POST：orgId 取自 provider 的 current-org，
 *      kind 恒为 workshop，blueprintVersionId 恒为 null（蓝本后端未实现），并带鉴权头。
 *   ② 成功后跳到刚建成的那个项目 `/projects/<id>`，用的是响应体里回来的 id，
 *      不是本地编的。
 *   ③ 失败（如 ORG_ROLE_INSUFFICIENT）就地把 reasonCode 显示出来，
 *      **并且按钮恢复可点** —— 旧实现点一次就永久禁用，遇到 403 的人再也建不了。
 *   ④ 界面层防重复提交：提交进行中不会发出第二个请求。
 *   ⑤ 蓝本九宫格整体禁用（后端零实现），六类初始化一览仍与蓝本设计器共用同一份
 *      数据源（`INIT_CATEGORIES`），不另开一份清单（I-17）。
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
import { BLUEPRINT_CATALOG } from "@/lib/mock/project";

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

function stubFetch(respond: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    calls.push({
      method: init?.method ?? "GET",
      pathname: url.pathname,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
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

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.pathname).toBe("/projects");
    expect(calls[0]!.auth).toBe("Bearer tok-pj-01");
    expect(calls[0]!.body).toEqual({
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
  it("蓝本九宫格整体禁用，并写明后端未实现", () => {
    render(<NewProjectFlow />);

    expect(screen.getByTestId("project-new-blueprint-unavailable")).toBeInTheDocument();
    const grid = screen.getByTestId("project-new-blueprints");
    for (const bp of BLUEPRINT_CATALOG) {
      expect(within(grid).getByTestId(`project-new-blueprint-${bp.id}`)).toBeDisabled();
    }
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
