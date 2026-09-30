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
});

describe("工作流权限授予页", () => {
  it("渲染：每项能力有中文名称与说明、当前等级、用到它的工作流；摘要提示会暂停；无变更记录时有空态", async () => {
    api.listWorkflowCapabilityGrants.mockResolvedValue(data());
    render(<OrgAdminWorkflowGrantsPage />);
    const row = await screen.findByTestId("workflow-grant-row-artifact.write");
    expect(row.textContent).toContain("保存产出文档");
    expect(row.textContent).toContain("文件库");
    expect(within(row).getByTestId("workflow-grant-current").textContent).toBe("只读（默认）");
    expect(row.textContent).toContain("Problem-to-PRD");
    expect(screen.getByTestId("workflow-grants-summary").textContent).toContain("有 1 个会因权限不足在中途暂停");
    expect(screen.getByTestId("workflow-grants-audit-empty")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/capability_exceeds|NOT_ORG_ADMIN/);
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
    expect(within(dialog).getByTestId("workflow-grant-impact").textContent).toContain("可以继续运行：Problem-to-PRD");
    fireEvent.click(within(dialog).getByTestId("workflow-grant-confirm"));
    await waitFor(() => expect(api.setWorkflowCapabilityGrant).toHaveBeenCalledWith("artifact.write", "write"));
    await waitFor(() => expect(screen.queryByTestId("workflow-grant-dialog")).toBeNull());
    expect(screen.getByTestId("workflow-grants-notice").textContent).toContain("已授予「保存产出文档」可写入权限");
    const audit = screen.getAllByTestId("workflow-grants-audit-row");
    expect(audit[0]!.textContent).toContain("我");
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
