/**
 * 人类反馈（2026-08-17）：点击「编辑」应该打开一个新的界面，而不是在当前列表页里
 * 展开编辑区块。这个文件替换的是 `capability-catalog-edit-deeplink.test.tsx`——
 * 那个文件测的是旧机制（`?edit=<id>` query 参数 + 数据到位后自动内联展开），
 * 旧机制随着「编辑」改成整页跳转一起被删掉了，不再是这条主流程的一部分。
 *
 * 新机制更简单，测试也更简单：「编辑」直接是一条 `<Link>`，断言它的 `href`
 * 指向 `/admin/<kind>/<id>` 就是全部——不需要再验证"数据到位后自动展开"这类
 * 只有内联机制才有的时序问题。
 */
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { agentRuntime } from "@repo/contracts";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-edit-nav", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

/**
 * 人类实测反馈（2026-08-30）：「编辑」链接现在带 `?from=<这个屏当前的 URL>`——
 * 见 `capability-catalog-screen.tsx` 的 `editHrefFor` 与 `capability-edit-page.tsx`
 * 里 `CATALOG_HREF`/`backHref` 的头注（「返回」不能写死回按 kind 猜的目的地）。
 * `nav.pathname` 按各自测试实际渲染的路由设置，让 `?from=` 断言反映真实语义。
 */
const nav = vi.hoisted(() => ({ pathname: "/admin/skill" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}));

import { SkillScreen } from "@/components/admin/skill-screen";
import { AgentScreen } from "@/components/admin/agent-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function oneListing(kind: "skill" | "agent") {
  return jsonResponse([
    {
      id: `${kind}-1`, orgId: sessionState.currentOrgId, kind, name: "第一个",
      scope: "org-wide", enabled: true, endpoint: null, disabledReason: null,
    },
  ]);
}

describe("「编辑」按钮是指向独立页面的链接，不是内联展开", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-edit-nav");
  });

  it("skill 目录：编辑按钮 href 指向 /platform-admin/skill/<id>", async () => {
    nav.pathname = "/admin/skill";
    vi.stubGlobal("fetch", vi.fn(async () => oneListing("skill")));
    render(<SkillScreen state="default" />);
    await waitFor(() => expect(screen.getByTestId("admin-skill-list")).toBeTruthy());
    const link = await screen.findByTestId("admin-skill-row-skill-1-edit");
    expect(link.getAttribute("href")).toBe("/platform-admin/skill/skill-1?from=%2Fadmin%2Fskill");
    vi.unstubAllGlobals();
  });

  it("agent 目录：编辑按钮 href 指向 /platform-admin/agent/<id>", async () => {
    nav.pathname = "/admin/agent";
    // ⚠ #1915 起 `AgentScreen` 还并行挂了 `AgentDefinitionListPanel`（独立的
    // `GET /agents`）——按路径分流，避免它吃到 capability-listing 形状的夹具。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input.toString());
        if (url.pathname === agentRuntime.operations.listAgents.path) return jsonResponse([]);
        return oneListing("agent");
      }),
    );
    render(<AgentScreen state="default" />);
    await waitFor(() => expect(screen.getByTestId("admin-agent-list")).toBeTruthy());
    const link = await screen.findByTestId("admin-agent-row-agent-1-edit");
    expect(link.getAttribute("href")).toBe("/platform-admin/agent/agent-1?from=%2Fadmin%2Fagent");
    vi.unstubAllGlobals();
  });

  it("点击编辑不会在列表页里内联展开表单——CapabilityEditForm 的字段不出现在这一页", async () => {
    nav.pathname = "/admin/skill";
    vi.stubGlobal("fetch", vi.fn(async () => oneListing("skill")));
    render(<SkillScreen state="default" />);
    await waitFor(() => expect(screen.getByTestId("admin-skill-list")).toBeTruthy());
    // 编辑按钮存在，但列表页上不应该出现内联编辑表单的字段（名称输入框）。
    expect(screen.getByTestId("admin-skill-row-skill-1-edit")).toBeTruthy();
    expect(screen.queryByTestId("admin-skill-row-skill-1-name")).toBeNull();
    vi.unstubAllGlobals();
  });
});
