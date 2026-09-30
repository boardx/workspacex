/**
 * #4743 —— 「新建项目」弹窗（`CreateProjectDialog`）与项目列表页的接线。
 *
 * 钉住：
 *   ① 列表页「新建项目」按钮（projects-new）打开弹窗，而不是跳 /project/new；
 *   ② 弹窗只有一个字段（项目名称）；空名不可提交；提交发出 kind=general、blueprintVersionId=null 的真实 POST，
 *      成功后 `router.push('/projects/<id>?org=<org>')`；
 *   ③ 失败用人话显示，原因码只在 `data-reason` 上，按钮恢复可点；
 *   ④ 次要入口「用工作坊模板创建」指向 `/project/new?mode=workshop`；取消关闭弹窗；
 *   ⑤ testid 沿用 /project/new 那套（project-new / -name / -create / -error / -workshop-link / -cancel）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const ORG = "org-e2e-demo";
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: ORG } }),
}));

import { ProjectsScreen } from "@/components/projects/projects-screen";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let posts: Array<{ pathname: string; body: unknown }>;

function stubFetch(createRespond: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      if (url.pathname === "/projects" && method === "GET") return jsonResponse([]);
      if (url.pathname === "/projects" && method === "POST") {
        posts.push({ pathname: url.pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
        return createRespond();
      }
      throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
    }),
  );
}

beforeEach(() => {
  posts = [];
  pushMock.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-4743");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#4743 列表页 → 新建项目弹窗", () => {
  it("点「新建项目」打开弹窗（不跳页）；标题、单字段、创建 / 取消、工作坊次要入口都在", async () => {
    stubFetch(() => jsonResponse({ id: "p-1" }));
    render(<ProjectsScreen />);
    expect(screen.queryByTestId("project-new")).toBeNull();
    const trigger = screen.getByTestId("projects-new");
    expect(trigger.tagName).toBe("BUTTON"); // 不再是指向 /project/new 的链接
    trigger.focus();
    fireEvent.click(trigger);
    expect(await screen.findByTestId("project-new")).toBeInTheDocument();
    expect(screen.getByTestId("project-new-title")).toHaveTextContent("新建项目");
    expect(screen.getByTestId("project-new-name")).toBeInTheDocument();
    expect(screen.getByTestId("project-new-create")).toBeDisabled();
    expect(screen.getByTestId("project-new-workshop-link")).toHaveAttribute("href", "/project/new?mode=workshop");
    expect(screen.getByTestId("project-new-workshop-link")).toHaveTextContent("要办一场工作坊？用工作坊模板创建");
    expect(pushMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("project-new-cancel"));
    await waitFor(() => expect(screen.queryByTestId("project-new")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("#4743 弹窗提交", () => {
  it("发出 kind=general 的 POST，成功后跳进新项目；提交中按钮禁用", async () => {
    stubFetch(() => jsonResponse({ id: "p-new-9", kind: "general", status: "active", provenanceEventId: "ev-1" }));
    render(<CreateProjectDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "  新品上市调研  " } });
    fireEvent.click(screen.getByTestId("project-new-create"));
    expect(screen.getByTestId("project-new-create")).toBeDisabled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/projects/p-new-9?org=${ORG}`));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toEqual({ orgId: ORG, name: "新品上市调研", kind: "general", blueprintVersionId: null });
  });

  it("失败：人话文案 + data-reason 带原因码，按钮恢复可点，不跳转", async () => {
    stubFetch(() => jsonResponse({ error: "forbidden", reasonCode: "ORG_ROLE_INSUFFICIENT" }, 403));
    render(<CreateProjectDialog open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId("project-new-name"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("project-new-create"));
    const err = await screen.findByTestId("project-new-error");
    expect(err).toHaveAttribute("data-reason", "ORG_ROLE_INSUFFICIENT");
    expect(err.textContent).not.toContain("ORG_ROLE_INSUFFICIENT");
    expect(err).toHaveTextContent("不能新建项目");
    await waitFor(() => expect(screen.getByTestId("project-new-create")).not.toBeDisabled());
    expect(pushMock).not.toHaveBeenCalled();
  });
});
