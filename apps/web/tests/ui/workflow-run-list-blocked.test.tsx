import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const role = vi.hoisted(() => ({ value: "member" as string }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { userId: "u1", currentOrgId: "o1" }, identity: { orgRole: role.value } }),
}));
vi.mock("@/lib/use-org-member-names", () => ({ useOrgMemberNames: () => ({}), memberLabel: () => "张三" }));
vi.mock("@/lib/workflow-runtime-api", () => ({
  listMyWorkflowInstances: async () => ({
    items: [{
      instanceId: "wi-1", workflowKey: "wf-a", definitionVersion: 1, agentId: "a", initiatorUserId: "u1",
      goal: "g", status: "blocked_permission", stateVersion: 1, reasonCode: null,
      createdAt: new Date(2026, 8, 30, 13, 29).toISOString(), updatedAt: new Date(2026, 8, 30, 13, 29).toISOString(),
    }],
  }),
  workflowErrorCode: () => "x",
}));

import { WorkflowRunList } from "@/components/workflow/workflow-lists";

afterEach(cleanup);

describe("WorkflowRunList 权限阻断行", () => {
  it("管理员看到授权链接，时间零填充", async () => {
    role.value = "admin";
    render(<WorkflowRunList />);
    const link = await waitFor(() => screen.getByTestId("workflow-run-blocked-grant-link"));
    expect(link.getAttribute("href")).toBe("/org-admin/workflow-grants?workflow=wf-a");
    expect(document.querySelector("time")?.textContent).toBe("2026-09-30 13:29");
  });
  it("非管理员只看到联系管理员文案", async () => {
    role.value = "member";
    render(<WorkflowRunList />);
    await waitFor(() => screen.getByTestId("workflow-run-blocked-contact-admin"));
    expect(screen.queryByTestId("workflow-run-blocked-grant-link")).toBeNull();
  });
});
