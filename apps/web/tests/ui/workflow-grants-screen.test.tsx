/**
 * 工作流权限授予（`/org-admin/workflow-grants`）—— 渲染、授予、撤销、非管理员、加载失败。
 * API 层替换为桩；页面、对话框、视图模型是真的。
 */
import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowCapabilityGrantsOut } from "@/lib/live-workflow-capability-grants";
import { ApiError } from "@/lib/api-client";

const api = vi.hoisted(() => ({
  listWorkflowCapabilityGrants: vi.fn(),
  setWorkflowCapabilityGrant: vi.fn(),
  revokeWorkflowCapabilityGrant: vi.fn(),
}));
const sessionState = vi.hoisted(() => ({ orgRole: "admin" as string }));

vi.mock("@/lib/live-workflow-capability-grants", () => api);
const orgApi = vi.hoisted(() => ({ listOrgMembers: vi.fn() }));
vi.mock("@/lib/live-org-admin", () => orgApi);
vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { userId: "u-admin", currentOrgId: "org-1" }, identity: { orgRole: sessionState.orgRole } }),
}));
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/admin/admin-nav", () => ({ AdminNav: () => null }));

import OrgAdminWorkflowGrantsPage from "@/app/org-admin/workflow-grants/page";

function data(grants: Partial<Record<string, "read" | "write">> = {}, audit: WorkflowCapabilityGrantsOut["audit"] = []): WorkflowCapabilityGrantsOut {
  const g = (c: string) => grants[c]
    ? { capabilityCategory: c, configured: true, authorized: true, sideEffectCap: grants[c]!, updatedAt: "2026-09-30T01:00:00Z", updatedBy: "u-admin" }
    : { capabilityCategory: c, configured: false, authorized: true, sideEffectCap: "read" as const, updatedAt: null, updatedBy: null };
  return {
    workflows: [{
      workflowId: "W029", workflowKey: "problem-to-prd", title: "Problem-to-PRD",
      capabilities: [
        { capabilityCategory: "notify.inapp", requiredCap: "write", stageIds: ["estimate", "notify"] },
        { capabilityCategory: "artifact.write", requiredCap: "write", stageIds: ["persist"] },
      ],
    }],
    grants: [g("artifact.write"), g("notify.inapp")],
    audit,
  };
}

beforeEach(() => {
  sessionState.orgRole = "admin";
  for (const f of Object.values(api)) f.mockReset();
  orgApi.listOrgMembers.mockReset().mockResolvedValue({ members: [
    { userId: "u-admin", displayName: "王管理", email: "admin@x", orgRole: "admin", teamId: null, joinedAt: "2026-01-01T00:00:00Z", status: "active" },
    { userId: "u-other", displayName: "李运营", email: "li@x", orgRole: "admin", teamId: null, joinedAt: "2026-01-01T00:00:00Z", status: "active" },
  ] });
});

describe("工作流权限授予页", () => {
  it("渲染：每项能力有中文名称与说明、当前等级、用到它的工作流；摘要提示会暂停；无变更记录时有空态", async () => {
    api.listWorkflowCapabilityGrants.mockResolvedValue(data());
    render(<OrgAdminWorkflowGrantsPage />);
    const row = await screen.findByTestId("workflow-grant-row-artifact.write");
    expect(row.textContent).toContain("保存产出文档");
    expect(row.textContent).toContain("文件库");
    expect(within(row).getByTestId("workflow-grant-current").textContent).toBe("当前：只读（默认）");
    expect(row.textContent).toContain("问题定义到 PRD");
    expect(screen.getByTestId("workflow-grants-summary").textContent).toContain("有 1 个会因权限不足在中途暂停");
    expect(screen.getByTestId("workflow-grants-audit-empty")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/capability_exceeds|NOT_ORG_ADMIN/);
  });

  it("按能力 / 按工作流 对同一能力的需求一致；已授予过的能力是「调整权限」而不是「授予权限」", async () => {
    const d = data({ "artifact.write": "write" });
    d.workflows.push({
      workflowId: "W032", workflowKey: "roadmap-review", title: "Roadmap review",
      capabilities: [{ capabilityCategory: "artifact.write", requiredCap: "external_send", stageIds: ["publish"] }],
    });
    api.listWorkflowCapabilityGrants.mockResolvedValue(d);
    render(<OrgAdminWorkflowGrantsPage />);
    const row = await screen.findByTestId("workflow-grant-row-artifact.write");
    expect(within(row).getByTestId("workflow-grant-edit").textContent).toBe("调整权限");
    expect(within(row).getByTestId("workflow-grant-use-artifact.write-W029").textContent).toContain("需要「可写入」");
    expect(within(row).getByTestId("workflow-grant-use-artifact.write-W032").textContent).toContain("需要「可对外发送」");
    const shortfall = within(row).getByTestId("workflow-grant-shortfall").textContent ?? "";
    expect(shortfall).toContain("1 个工作流会在对应步骤暂停");
    // 需求只以标签呈现一次，说明文字不再逐条复述
    expect(shortfall).not.toContain("路线图评审");
    fireEvent.click(screen.getByTestId("workflow-grants-tab-workflow"));
    expect(screen.getByTestId("workflow-grants-workflow-W029").textContent).toContain("保存产出文档需要「可写入」，当前「可写入」");
    expect(screen.getByTestId("workflow-grants-workflow-W032").textContent).toContain("保存产出文档需要「可对外发送」，当前「可写入」");
  });

  it("授予：打开确认框（预选工作流所需等级、展示影响）→ 确认 → 调用 API → 刷新并提示", async () => {
    api.listWorkflowCapabilityGrants.mockResolvedValueOnce(data())
      .mockResolvedValueOnce(data({ "artifact.write": "write" }, [
        { eventId: "e1", capabilityCategory: "artifact.write", action: "granted", fromCap: "read", toCap: "write", actorId: "u-admin", at: "2026-09-30T01:00:00Z" },
      ]));
    api.setWorkflowCapabilityGrant.mockResolvedValue({});
    render(<OrgAdminWorkflowGrantsPage />);
    const row = await screen.findByTestId("workflow-grant-row-artifact.write");
    fireEvent.click(within(row).getByTestId("workflow-grant-edit"));
    const dialog = await screen.findByTestId("workflow-grant-dialog");
    expect((within(dialog).getByTestId("workflow-grant-level-write") as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByTestId("workflow-grant-impact").textContent).toContain("可以继续运行：问题定义到 PRD");
    fireEvent.click(within(dialog).getByTestId("workflow-grant-confirm"));
    await waitFor(() => expect(api.setWorkflowCapabilityGrant).toHaveBeenCalledWith("artifact.write", "write"));
    await waitFor(() => expect(screen.queryByTestId("workflow-grant-dialog")).toBeNull());
    expect(screen.getByTestId("workflow-grants-notice").textContent).toContain("已授予「保存产出文档」可写入权限");
    const audit = screen.getAllByTestId("workflow-grants-audit-row");
    await waitFor(() => expect(within(audit[0]!).getByTestId("workflow-grants-audit-actor").textContent).toBe("王管理（我）"));
    expect(audit[0]!.textContent).toContain("只读（默认） → 可写入");
  });

  it("撤销：选「只读」→ 危险样式确认按钮 → 调用撤销 API；等级不变时确认按钮禁用", async () => {
    api.listWorkflowCapabilityGrants.mockResolvedValue(data({ "artifact.write": "write", "notify.inapp": "write" }));
    api.revokeWorkflowCapabilityGrant.mockResolvedValue({});
    render(<OrgAdminWorkflowGrantsPage />);
    const row = await screen.findByTestId("workflow-grant-row-artifact.write");
    fireEvent.click(within(row).getByTestId("workflow-grant-edit"));
    const dialog = await screen.findByTestId("workflow-grant-dialog");
    expect((within(dialog).getByTestId("workflow-grant-confirm") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(dialog).getByTestId("workflow-grant-level-read"));
    expect(within(dialog).getByTestId("workflow-grant-impact").textContent).toContain("会在对应步骤暂停");
    const confirm = within(dialog).getByTestId("workflow-grant-confirm");
    expect(confirm.textContent).toContain("确认撤销");
    fireEvent.click(confirm);
    await waitFor(() => expect(api.revokeWorkflowCapabilityGrant).toHaveBeenCalledWith("artifact.write"));
  });

  it("授予失败：确认框内显示人话错误，不关闭、不显示错误码", async () => {
    api.listWorkflowCapabilityGrants.mockResolvedValue(data());
    api.setWorkflowCapabilityGrant.mockRejectedValue(new ApiError(503, "DEPENDENCY_UNAVAILABLE", {}));
    render(<OrgAdminWorkflowGrantsPage />);
    const row = await screen.findByTestId("workflow-grant-row-artifact.write");
    fireEvent.click(within(row).getByTestId("workflow-grant-edit"));
    fireEvent.click(within(await screen.findByTestId("workflow-grant-dialog")).getByTestId("workflow-grant-confirm"));
    const alert = await within(screen.getByTestId("workflow-grant-dialog")).findByRole("alert");
    expect(alert.textContent).toContain("权限服务暂时不可用");
    expect(alert.textContent).not.toContain("DEPENDENCY_UNAVAILABLE");
  });

  it("按工作流视图：?workflow=<key> 聚焦该工作流并标出缺少的权限", async () => {
    window.history.replaceState(null, "", "/org-admin/workflow-grants?workflow=problem-to-prd");
    try {
      api.listWorkflowCapabilityGrants.mockResolvedValue(data({ "notify.inapp": "write" }));
      render(<OrgAdminWorkflowGrantsPage />);
      const card = await screen.findByTestId("workflow-grants-workflow-W029");
      expect(card.getAttribute("data-focused")).toBe("true");
      expect(card.textContent).toContain("会在中途暂停");
      expect(card.textContent).toContain("保存产出文档");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("?workflow=W029（id）同样定位：滚动到卡片、获得焦点、显示「已定位到」；标题是中文显示名", async () => {
    window.history.replaceState(null, "", "/org-admin/workflow-grants?workflow=W029");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      api.listWorkflowCapabilityGrants.mockResolvedValue(data());
      render(<OrgAdminWorkflowGrantsPage />);
      const card = await screen.findByTestId("workflow-grants-workflow-W029");
      expect(card.getAttribute("data-focused")).toBe("true");
      expect(card.textContent).toContain("问题定义到 PRD");
      expect(card.textContent).not.toContain("Problem-to-PRD");
      expect(screen.getByTestId("workflow-grants-focus-chip").textContent).toContain("已定位到「问题定义到 PRD」");
      await waitFor(() => expect(scroll).toHaveBeenCalled());
      expect(document.activeElement).toBe(card);
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("?workflow=<未知> 显示「找不到该工作流」，不静默", async () => {
    window.history.replaceState(null, "", "/org-admin/workflow-grants?workflow=W999");
    try {
      api.listWorkflowCapabilityGrants.mockResolvedValue(data());
      render(<OrgAdminWorkflowGrantsPage />);
      expect((await screen.findByTestId("workflow-grants-focus-missing")).textContent).toContain("找不到该工作流");
      expect(screen.getByTestId("workflow-grants-workflow-W029").getAttribute("data-focused")).toBeNull();
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("变更记录：操作人显示成员显示名，不显示内部 id；时间补零", async () => {
    api.listWorkflowCapabilityGrants.mockResolvedValue(data({ "artifact.write": "write" }, [
      { eventId: "e1", capabilityCategory: "artifact.write", action: "granted", fromCap: "read", toCap: "write", actorId: "u-other", at: "2026-09-03T01:04:05Z" },
      { eventId: "e2", capabilityCategory: "notify.inapp", action: "revoked", fromCap: "write", toCap: "read", actorId: "u-gone", at: "2026-09-03T01:04:05Z" },
    ]));
    render(<OrgAdminWorkflowGrantsPage />);
    const rows = await screen.findAllByTestId("workflow-grants-audit-row");
    await waitFor(() => expect(within(rows[0]!).getByTestId("workflow-grants-audit-actor").textContent).toBe("李运营"));
    expect(within(rows[1]!).getByTestId("workflow-grants-audit-actor").textContent).toBe("已离开组织的成员");
    expect(document.body.textContent).not.toMatch(/u-other|u-gone/);
    expect(rows[0]!.textContent).toMatch(/2026\/09\/03/);
  });

  it("非管理员：显示组织层无权限说明，不请求数据", async () => {
    sessionState.orgRole = "member";
    render(<OrgAdminWorkflowGrantsPage />);
    expect(screen.getByTestId("denied").textContent).toContain("仅组织管理员");
    expect(api.listWorkflowCapabilityGrants).not.toHaveBeenCalled();
  });

  it("加载失败：显示依赖失败与重试", async () => {
    api.listWorkflowCapabilityGrants.mockRejectedValueOnce(new ApiError(503, "DEPENDENCY_UNAVAILABLE", {})).mockResolvedValueOnce(data());
    render(<OrgAdminWorkflowGrantsPage />);
    expect(await screen.findByText(/权限服务暂时不可用/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(await screen.findByTestId("workflow-grant-row-artifact.write")).toBeTruthy();
  });
});
