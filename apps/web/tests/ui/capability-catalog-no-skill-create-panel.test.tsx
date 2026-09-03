/**
 * 2026-09-03 —— `/skill?screen=catalog`（`CapabilityCatalogScreen kind="skill"`）
 * 不再挂载 `CapabilityCreatePanel`。
 *
 * ## 挡的是什么
 *
 * 这个面板对 `kind === "skill"` 建出来的行只是一条裸 `capability_listings`
 * （`POST /capabilities/mutate` 的 `op: "add"` 从不写 `skills`/`skill_versions`），
 * 在目录里看起来和真实导入的 skill 一模一样、能被勾选挂载，但没有任何源码文件——
 * 打开「编辑」会撞上 `getAssetDirectory` 404，挂进 chat 执行会
 * `SKILL_VERSION_UNAVAILABLE`。`kind === "agent"` 那边选择保留入口 + 加一句提示
 * （承认了"运维手动登记一个已经在别处发布好的 agent"这种合法用途），skill 没有
 * 对应场景——模型 B 的声明式创建路径已冻结（`POST /skills` 恒 410），今天真正
 * 能让一个 skill 有可执行内容的只有页面上方已经挂着的两条导入路径。
 *
 * ## 反空转
 * ① 装置自检：同一个页面对 `kind === "agent"` 时行为不变（入口仍在、仍带那句
 *    既有提示）——证明这不是「新增面板从此全局消失」这种更粗暴但错误的改法。
 * ② 断言的是真实渲染出的 DOM（不 mock `CapabilityCreatePanel` 本身），且断言
 *    两条真正能建出可执行 skill 的导入面板仍然在场——不是把入口连同它的替代
 *    路径一起删掉。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

const sessionState = vi.hoisted(() => ({ currentOrgId: "org-skill-create-hidden", orgRole: "admin" }));

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({
    session: { currentOrgId: sessionState.currentOrgId },
    identity: {
      org: { id: sessionState.currentOrgId, name: "真实组织" },
      orgRole: sessionState.orgRole,
    },
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/skill",
  useSearchParams: () => new URLSearchParams("screen=catalog"),
}));

import { CapabilityCatalogScreen } from "@/components/admin/capability-catalog-screen";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  sessionState.currentOrgId = "org-skill-create-hidden";
  sessionState.orgRole = "admin";
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-skill-create-hidden");
  vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Skill 目录页：没有裸『新增 Skill』入口", () => {
  it("admin-skill-create 不存在；两条真实导入面板仍然在场；说明文字如实指向它们", async () => {
    render(<CapabilityCatalogScreen kind="skill" />);
    await waitFor(() => expect(screen.getByTestId("skill-starter-import")).toBeInTheDocument());

    expect(screen.queryByTestId("admin-skill-create")).not.toBeInTheDocument();
    expect(screen.getByTestId("skill-url-import-panel")).toBeInTheDocument();

    const note = screen.getByTestId("admin-skill-create-skill-hidden-note");
    expect(note).toHaveTextContent("导入");
  });
});

describe("装置自检：Agent 目录页不受影响，入口与既有提示原样保留", () => {
  it("admin-agent-create 仍然存在，仍然带 agent 专属的那句提示", async () => {
    sessionState.currentOrgId = "org-agent-create-unaffected";
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-agent-create-unaffected");
    render(<CapabilityCatalogScreen kind="agent" />);
    await waitFor(() => expect(screen.getByTestId("admin-agent-create")).toBeInTheDocument());
    expect(screen.getByTestId("admin-agent-create-agent-caveat")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-agent-create-skill-hidden-note")).not.toBeInTheDocument();
  });
});
