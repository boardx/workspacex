import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import type { WorkflowCapabilityGrantsOut } from "@/lib/live-workflow-capability-grants";
import { capabilityCopy, describeWorkflowGrantFailure, targetSystemText } from "@/lib/workflow-capability-grant-copy";
const api = vi.hoisted(() => ({ listWorkflowCapabilityGrants: vi.fn(), setWorkflowCapabilityGrant: vi.fn(), revokeWorkflowCapabilityGrant: vi.fn(), listOrgMembers: vi.fn(), role: "admin" }));
vi.mock("@/lib/live-workflow-capability-grants", () => api);
vi.mock("@/lib/live-org-admin", () => ({ listOrgMembers: api.listOrgMembers }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: { userId: "admin-raw", currentOrgId: "org-raw" }, identity: { orgRole: api.role } }) }));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/admin/admin-nav", () => ({ AdminNav: () => null }));
import { WorkflowGrantsScreen } from "@/components/org-admin/workflow-grants-screen";
function LocaleToggle() { const { locale, setLocale } = useI18n(); return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Toggle language</button>; }
function Page() { return <I18nProvider initialLocale="en"><LocaleToggle /><WorkflowGrantsScreen /></I18nProvider>; }
// Provider test control remains callable while Radix correctly hides the underlying app.
const toggle = () => fireEvent.click(screen.getByText("Toggle language"));
function data(write = false): WorkflowCapabilityGrantsOut {
  return {
    workflows: [
      { workflowId: "W029", workflowKey: "problem-to-prd", title: "目录原文 {title}", capabilities: [{ capabilityCategory: "artifact.write", requiredCap: "write", stageIds: ["persist"] }] },
      { workflowId: "custom-raw", workflowKey: "custom-raw-key", title: "团队原文 {count}", capabilities: [{ capabilityCategory: "artifact.write", requiredCap: "external_send", stageIds: ["raw-stage"] }] },
    ],
    grants: [{ capabilityCategory: "artifact.write", authorized: true, configured: write, sideEffectCap: write ? "write" : "read", updatedAt: write ? "2026-09-03T01:04:05Z" : null, updatedBy: write ? "admin-raw" : null }],
    audit: write ? [
      { eventId: "event-raw", capabilityCategory: "artifact.write", action: "granted", fromCap: "read", toCap: "write", actorId: "admin-raw", at: "2026-09-03T01:04:05Z" },
      { eventId: "event-former", capabilityCategory: "artifact.write", action: "revoked", fromCap: "external_send", toCap: "read", actorId: "former-raw", at: "2026-09-03T01:04:05Z" },
    ] : [],
  };
}
beforeEach(() => {
  api.role = "admin"; for (const key of ["listWorkflowCapabilityGrants", "setWorkflowCapabilityGrant", "revokeWorkflowCapabilityGrant", "listOrgMembers"] as const) api[key].mockReset();
  api.listWorkflowCapabilityGrants.mockResolvedValue(data());
  api.listOrgMembers.mockResolvedValue({ members: [{ userId: "admin-raw", displayName: "王管理 {me}", email: "raw@example.com" }] });
  window.history.replaceState(null, "", "/org-admin/workflow-grants");
});
afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });
it("renders English capability view, keeps authored workflow text and switches without refetch", async () => {
  render(<Page />); const row = await screen.findByTestId("workflow-grant-row-artifact.write");
  expect(screen.getByRole("heading", { name: "Workflow permissions" })).toBeVisible();
  expect(row).toHaveTextContent("Save output documents");
  fireEvent.click(within(row).getByRole("button",{name:"Details"}));
  const details=screen.getByRole("dialog");
  expect(details).toHaveTextContent("Problem to PRD"); expect(details).toHaveTextContent("团队原文 {count}");
  expect(api.setWorkflowCapabilityGrant).not.toHaveBeenCalled(); expect(api.revokeWorkflowCapabilityGrant).not.toHaveBeenCalled();
  fireEvent.click(within(details).getByTestId("dialog-close"));
  expect(screen.getByRole("tab", { name: "By capability" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByTestId("workflow-grants-summary")).toHaveTextContent("2");
  expect(screen.getByTestId("workflow-grants-audit-empty")).toHaveTextContent("No workflow permission changes yet");
  toggle(); expect(row).toHaveTextContent("保存产出文档"); toggle(); expect(row).toHaveTextContent("Save output documents");
  expect(api.listWorkflowCapabilityGrants).toHaveBeenCalledTimes(1); expect(api.listOrgMembers).toHaveBeenCalledTimes(1);
});
it("keeps selected dialog level through locale switches and exposes localized impact and confirm", async () => {
  render(<Page />); const row = await screen.findByTestId("workflow-grant-row-artifact.write"); fireEvent.click(within(row).getByTestId("workflow-grant-edit"));
  const dialog = screen.getByRole("dialog"); expect(within(dialog).getByRole("heading", { name: "Adjust permission for Save output documents" })).toBeVisible();
  fireEvent.click(within(dialog).getByTestId("workflow-grant-level-write")); toggle();
  expect(within(dialog).getByTestId("workflow-grant-level-write")).toBeChecked(); expect(within(dialog).getByTestId("workflow-grant-impact")).toHaveTextContent("团队原文 {count}"); toggle();
  expect(within(dialog).getByTestId("workflow-grant-level-write")).toBeChecked(); expect(within(dialog).getByTestId("workflow-grant-confirm")).toHaveTextContent("Confirm grant");
  expect(api.setWorkflowCapabilityGrant).not.toHaveBeenCalled(); expect(api.listWorkflowCapabilityGrants).toHaveBeenCalledTimes(1);
});
it("submits canonical grant values and retranslates the stored success notice and audit", async () => {
  api.listWorkflowCapabilityGrants.mockResolvedValueOnce(data()).mockResolvedValue(data(true)); api.setWorkflowCapabilityGrant.mockResolvedValue({});
  render(<Page />); fireEvent.click(within(await screen.findByTestId("workflow-grant-row-artifact.write")).getByTestId("workflow-grant-edit"));
  fireEvent.click(screen.getByTestId("workflow-grant-level-write")); fireEvent.click(screen.getByTestId("workflow-grant-confirm"));
  await waitFor(() => expect(api.setWorkflowCapabilityGrant).toHaveBeenCalledWith("artifact.write", "write")); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.getByTestId("workflow-grants-notice")).toHaveTextContent("Granted"); expect(screen.getByTestId("workflow-grants-notice")).toHaveTextContent("Save output documents");
  toggle(); expect(screen.getByTestId("workflow-grants-notice")).toHaveTextContent("已授予「保存产出文档」可写入权限"); toggle(); expect(screen.getByTestId("workflow-grants-notice")).toHaveTextContent("Granted");
  expect(api.listWorkflowCapabilityGrants).toHaveBeenCalledTimes(2); expect(api.setWorkflowCapabilityGrant).toHaveBeenCalledTimes(1);
});
it("submits revoke category unchanged and disables unchanged confirmation", async () => {
  api.listWorkflowCapabilityGrants.mockResolvedValue(data(true)); api.revokeWorkflowCapabilityGrant.mockResolvedValue({}); render(<Page />);
  fireEvent.click(within(await screen.findByTestId("workflow-grant-row-artifact.write")).getByTestId("workflow-grant-edit"));
  fireEvent.click(screen.getByTestId("workflow-grant-level-write")); expect(screen.getByTestId("workflow-grant-confirm")).toBeDisabled();
  fireEvent.click(screen.getByTestId("workflow-grant-level-read")); expect(screen.getByTestId("workflow-grant-confirm")).toHaveTextContent("Confirm revoke"); fireEvent.click(screen.getByTestId("workflow-grant-confirm"));
  await waitFor(() => expect(api.revokeWorkflowCapabilityGrant).toHaveBeenCalledWith("artifact.write")); await waitFor(() => expect(screen.getByTestId("workflow-grants-notice")).toHaveTextContent("Revoked"));
  toggle(); expect(screen.getByTestId("workflow-grants-notice")).toHaveTextContent("已撤销「保存产出文档」，恢复为只读");
});
it("retranslates a retained API error without leaking its body or resetting the selected level", async () => {
  api.setWorkflowCapabilityGrant.mockRejectedValue(new ApiError(503, "DEPENDENCY_UNAVAILABLE", { message: "私密错误 {code}" })); render(<Page />);
  fireEvent.click(within(await screen.findByTestId("workflow-grant-row-artifact.write")).getByTestId("workflow-grant-edit")); fireEvent.click(screen.getByTestId("workflow-grant-level-write")); fireEvent.click(screen.getByTestId("workflow-grant-confirm"));
  const dialog = screen.getByRole("dialog"); await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Permission service"));
  toggle(); expect(within(dialog).getByRole("alert")).toHaveTextContent("权限服务暂时不可用"); toggle(); expect(within(dialog).getByRole("alert")).toHaveTextContent("Permission service");
  expect(within(dialog).getByTestId("workflow-grant-level-write")).toBeChecked(); expect(dialog.textContent).not.toMatch(/DEPENDENCY_UNAVAILABLE|私密错误/); expect(api.setWorkflowCapabilityGrant).toHaveBeenCalledTimes(1);
});
it("localizes audit actions, date and member fallback without translating raw names", async () => {
  api.listWorkflowCapabilityGrants.mockResolvedValue(data(true)); render(<Page />); const rows = await screen.findAllByTestId("workflow-grants-audit-row");
  await waitFor(() => expect(within(rows[0]!).getByTestId("workflow-grants-audit-actor")).toHaveTextContent("王管理 {me} (me)"));
  expect(within(rows[1]!).getByTestId("workflow-grants-audit-actor")).toHaveTextContent("Former organization member"); expect(rows[0]).toHaveTextContent("Granted");
  const iso = "2026-09-03T01:04:05Z"; const options = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false } as const;
  expect(rows[0]).toHaveTextContent(new Intl.DateTimeFormat("en", options).format(new Date(iso))); toggle();
  expect(rows[0]).toHaveTextContent(new Intl.DateTimeFormat("zh-CN", options).format(new Date(iso))); expect(rows[0]).toHaveTextContent("王管理 {me}（我）"); expect(document.body.textContent).not.toMatch(/admin-raw|former-raw|event-raw/);
});
it("keeps deep-link focus while localizing workflow view", async () => {
  window.history.replaceState(null, "", "/org-admin/workflow-grants?workflow=W029"); render(<Page />);
  const card = await screen.findByTestId("workflow-grants-workflow-W029"); expect(card).toHaveAttribute("data-focused", "true");
  expect(screen.getByTestId("workflow-grants-focus-chip")).toHaveTextContent("Located"); expect(card).toHaveTextContent("Save output documents");
  toggle(); expect(card).toHaveAttribute("data-focused", "true"); toggle(); expect(card).toHaveAttribute("data-focused", "true"); expect(api.listWorkflowCapabilityGrants).toHaveBeenCalledTimes(1);
});
it("localizes missing workflow and empty capability states", async () => {
  window.history.replaceState(null, "", "/org-admin/workflow-grants?workflow=missing-raw"); api.listWorkflowCapabilityGrants.mockResolvedValue({ workflows: [], grants: [], audit: [] }); render(<Page />);
  expect(await screen.findByTestId("workflow-grants-focus-missing")).toHaveTextContent("Workflow not found"); fireEvent.click(screen.getByTestId("workflow-grants-tab-capability"));
  expect(screen.getByTestId("workflow-grants-empty")).toHaveTextContent("No built-in workflow operations currently need permission");
});
it("localizes denied state without reading admin data", () => {
  api.role = "member"; render(<Page />); expect(screen.getByTestId("denied-layer")).toHaveTextContent("Only organization administrators"); toggle(); expect(screen.getByTestId("denied-layer")).toHaveTextContent("仅组织管理员"); expect(api.listWorkflowCapabilityGrants).not.toHaveBeenCalled(); expect(api.listOrgMembers).not.toHaveBeenCalled();
});
it("retranslates load errors and retries only through explicit action", async () => {
  api.listWorkflowCapabilityGrants.mockRejectedValueOnce(new ApiError(403, "NOT_ORG_ADMIN", {})); render(<Page />);
  expect(await screen.findByText(/Only organization administrators can view and adjust workflow permissions/)).toBeVisible(); toggle(); expect(screen.getByText(/只有组织管理员可以查看和调整工作流权限/)).toBeVisible(); expect(api.listWorkflowCapabilityGrants).toHaveBeenCalledTimes(1);
});
it("keeps legacy Chinese helpers and localizes unknown capabilities and targets", () => {
  expect(capabilityCopy("artifact.write").label).toBe("保存产出文档"); expect(capabilityCopy("artifact.write", "en").label).toBe("Save output documents");
  expect(capabilityCopy("raw-unknown", "en").label).toBe("Other operation permissions"); expect(targetSystemText("smtp", "en")).toBe("Email service"); expect(targetSystemText("raw-unknown", "en")).toBe("Other organization systems");
});
it("localizes closed API errors and safe network/unknown fallbacks", () => {
  expect(describeWorkflowGrantFailure(new ApiError(400, "UNKNOWN_CAPABILITY", {}), "en")).toMatch(/built-in workflow catalog/);
  expect(describeWorkflowGrantFailure(new TypeError("raw network secret"), "en")).toMatch(/connect/); expect(describeWorkflowGrantFailure(new Error("raw secret"), "en")).not.toContain("raw secret");
  expect(describeWorkflowGrantFailure(new ApiError(429, "RATE_LIMITED", {}), "en")).toMatch(/Too many|too many/);
});
it("keeps a pending canonical mutation busy through locale switches until its original result arrives", async () => {
  let finish!: (value: unknown) => void;
  api.setWorkflowCapabilityGrant.mockImplementation(() => new Promise(resolve => { finish = resolve; })); render(<Page />);
  fireEvent.click(within(await screen.findByTestId("workflow-grant-row-artifact.write")).getByTestId("workflow-grant-edit")); fireEvent.click(screen.getByTestId("workflow-grant-level-write")); fireEvent.click(screen.getByTestId("workflow-grant-confirm"));
  expect(screen.getByTestId("workflow-grant-confirm")).toBeDisabled(); expect(screen.getByTestId("workflow-grant-confirm")).toHaveTextContent("Saving");
  toggle(); expect(screen.getByTestId("workflow-grant-confirm")).toBeDisabled(); expect(screen.getByTestId("workflow-grant-confirm")).toHaveTextContent("正在保存"); toggle();
  expect(screen.getByTestId("workflow-grant-level-write")).toBeChecked(); expect(api.setWorkflowCapabilityGrant).toHaveBeenCalledTimes(1); finish({}); await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("cancels an edited dialog without issuing a grant or revoke", async () => {
  render(<Page />); fireEvent.click(within(await screen.findByTestId("workflow-grant-row-artifact.write")).getByTestId("workflow-grant-edit"));
  expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible(); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); expect(screen.queryByRole("dialog")).toBeNull();
  expect(api.setWorkflowCapabilityGrant).not.toHaveBeenCalled(); expect(api.revokeWorkflowCapabilityGrant).not.toHaveBeenCalled();
});
