import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
const api = vi.hoisted(() => ({
  orgId: "org-quotas-raw" as string | null,
  getTokenQuotas: vi.fn(), setMemberTokenQuota: vi.fn(), setOrgTokenBudget: vi.fn(),
  listOrgMembers: vi.fn(), listOrgInvites: vi.fn(), resendOrgInvite: vi.fn(), inviteOrgMember: vi.fn(),
  getPersonalLayerSummary: vi.fn(), listMyAccessLog: vi.fn(),
}));
vi.mock("@/lib/live-org-admin", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/live-org-admin")>()), ...api }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => api.orgId ? { session: { currentOrgId: api.orgId, userId: "admin-raw" }, identity: { orgRole: "admin", org: { id: api.orgId, name: "组织原名 {name}" } } } : null,
  useSession: () => ({ session: { currentOrgId: api.orgId, userId: "admin-raw" }, identity: { orgRole: "admin", org: { id: api.orgId, name: "组织原名 {name}" } } }),
}));
vi.mock("@/components/shell/app-shell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/admin/admin-nav", () => ({ AdminNav: () => null }));
import { MemberQuotaTab } from "@/components/admin/member-quota-tab";
import { AdminHeader } from "@/components/admin/admin-header";
import { MemberInvitesPanel } from "@/components/admin/member-invites-panel";
import { AdminBoundaryLive } from "@/components/admin/admin-boundary-live";
import { ViewModeToggle, type EntityViewMode } from "@/components/admin/view-mode-toggle";
function ToggleLocale() { const { locale, setLocale } = useI18n(); return <button data-testid="quota-test-locale" onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Test language</button>; }
function Locale({ children }: { children: React.ReactNode }) { return <I18nProvider initialLocale="en"><ToggleLocale />{children}</I18nProvider>; }
const toggle = () => fireEvent.click(screen.getByTestId("quota-test-locale"));
const rawName = "成员原名 {member}";
const member = { userId: "user-raw", displayName: rawName, email: "member+raw@example.test", orgRole: "consultant", teamId: null, monthlyLimit: null, usedTokens: 100, joinedAt: "2026-01-01T00:00:00Z", status: "active" };
const quotas = (overrides: Record<string, unknown> = {}) => ({ orgBudget: 500_000, allocated: 100_000, unallocated: 400_000, orgUsed: 10_000, overspendCount: 1, members: [member], ...overrides });
const invite = { inviteId: "invite-raw", email: "invite+raw@example.test", status: "pending", invitedBy: "邀请人原文 {user}", orgRole: "consultant", teamId: null, invitedAt: "2026-01-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" };
beforeEach(() => {
  api.orgId = "org-quotas-raw";
  for (const value of Object.values(api)) if (typeof value === "function") value.mockReset();
  api.getTokenQuotas.mockResolvedValue(quotas());
  api.listOrgMembers.mockResolvedValue({ members: [member] });
  api.listOrgInvites.mockResolvedValue({ invites: [invite] });
  api.getPersonalLayerSummary.mockResolvedValue({ itemCount: 7 });
  api.listMyAccessLog.mockResolvedValue({ entries: [{ logId: "log-raw", projectId: "项目原文 {project}", objectRef: "对象原文 {object}", readAt: "2026-11-01T03:04:05Z" }] });
});
afterEach(() => cleanup());
it("localizes quota header without replacing raw identity, refetching or inventing a null percentage", async () => {
  api.getTokenQuotas.mockResolvedValue(quotas({ orgBudget: null, unallocated: null }));
  render(<AdminHeader moduleLabel="Member quotas" />, { wrapper: Locale });
  expect(await screen.findByText("Organization monthly budget is not set")).toBeVisible();
  expect(screen.getByTestId("admin-header-org-name")).toHaveTextContent("组织原名 {name}");
  expect(screen.getByTestId("admin-header-org-id")).toHaveTextContent("Organization ID org-quotas-raw");
  expect(screen.queryByRole("progressbar")).toBeNull(); toggle();
  expect(screen.getByTestId("admin-header-quota-unset")).toHaveTextContent("组织本月额度未设置"); toggle();
  expect(api.getTokenQuotas).toHaveBeenCalledTimes(1);
});
it("keeps actual zero as a configured quota and skips quota reads in the platform header", async () => {
  api.getTokenQuotas.mockResolvedValue(quotas({ orgBudget: 0, orgUsed: 0 }));
  const view = render(<AdminHeader moduleLabel="Member quotas" />, { wrapper: Locale });
  expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  expect(screen.getByTestId("admin-header-quota")).toHaveTextContent("Organization budget this month: 0%");
  view.unmount(); api.getTokenQuotas.mockClear();
  render(<AdminHeader moduleLabel="Module" hideOrgIdentity />, { wrapper: Locale });
  expect(screen.getByTestId("admin-header-platform-label")).toHaveTextContent("Platform operations"); toggle(); toggle();
  expect(screen.queryByTestId("admin-header-org-id")).toBeNull(); expect(api.getTokenQuotas).not.toHaveBeenCalled();
});
it("keeps card/list selection and emits no change just for a locale update", () => {
  const changed = vi.fn();
  function Views() { const [mode, setMode] = React.useState<EntityViewMode>("card"); return <ViewModeToggle module="quota-test" mode={mode} onChange={next => { changed(next); setMode(next); }} />; }
  render(<Views />, { wrapper: Locale }); fireEvent.click(screen.getByRole("button", { name: "List" }));
  toggle(); expect(screen.getByTestId("admin-quota-test-view-toggle-list")).toHaveAttribute("aria-pressed", "true"); toggle();
  expect(screen.getByRole("group", { name: "Switch between card and list views" })).toBeVisible(); expect(changed.mock.calls).toEqual([["list"]]);
});
it("renders English quota cards, preserves raw names and distinguishes unallocated from zero", async () => {
  api.getTokenQuotas.mockResolvedValue(quotas({ orgBudget: null, unallocated: null }));
  render(<MemberQuotaTab />, { wrapper: Locale }); const live = await screen.findByTestId("admin-quota-live");
  expect(screen.getByTestId("admin-quota-card-allocated")).toHaveTextContent("Allocated quota");
  expect(screen.getByTestId("admin-quota-card-unallocated")).toHaveTextContent("—"); expect(live).toHaveTextContent("No organization budget is set");
  const row = screen.getByTestId("admin-member-card-user-raw"); expect(row).toHaveTextContent(rawName); expect(row).toHaveTextContent("Member"); expect(row).toHaveTextContent("No quota allocated");
  expect(within(row).queryByRole("progressbar")).toBeNull(); toggle(); expect(row).toHaveTextContent("未分配额度"); toggle(); expect(api.getTokenQuotas).toHaveBeenCalledTimes(1);
});
it.each([400_000, null])("separates the English used and available budget sentences in quota editing help (%s)", async unallocated => {
  api.getTokenQuotas.mockResolvedValue(quotas({ unallocated }));
  render(<MemberQuotaTab />, { wrapper: Locale });
  fireEvent.click(await screen.findByTestId("admin-member-quota-user-raw"));
  const modal = screen.getByTestId("admin-member-quota-modal");
  expect(modal).toHaveTextContent(unallocated === null
    ? /Used this month: 100 tokens\.\s+No organization budget is set; usage is currently unlimited\./
    : /Used this month: 100 tokens\.\s+Unallocated organization budget: 400,000 tokens\./);
});
it("retains an edited member draft across locale switches and submits the original truncated numeric payload", async () => {
  api.setMemberTokenQuota.mockResolvedValue({}); render(<MemberQuotaTab />, { wrapper: Locale });
  fireEvent.click(await screen.findByTestId("admin-member-quota-user-raw")); const modal = screen.getByTestId("admin-member-quota-modal");
  expect(within(modal).getByRole("heading")).toHaveTextContent("Adjust monthly quota for " + rawName);
  fireEvent.change(screen.getByTestId("admin-member-quota-input"), { target: { value: "12345.9" } }); toggle(); toggle();
  expect(screen.getByTestId("admin-member-quota-input")).toHaveValue("12345.9"); expect(api.getTokenQuotas).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByTestId("admin-member-quota-save"));
  await waitFor(() => expect(api.setMemberTokenQuota.mock.calls).toEqual([["org-quotas-raw", "user-raw", 12345]]));
  await waitFor(() => expect(screen.queryByTestId("admin-member-quota-modal")).toBeNull());
  expect(screen.getByTestId("admin-quota-toast")).toHaveTextContent(rawName); expect(screen.getByTestId("admin-quota-toast")).toHaveTextContent("12,345");
  toggle(); expect(screen.getByTestId("admin-quota-toast")).toHaveTextContent("已把"); expect(api.getTokenQuotas).toHaveBeenCalledTimes(2);
});
it("retranslates validation without losing the numeric draft or submitting invalid values", async () => {
  render(<MemberQuotaTab />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-member-quota-user-raw"));
  fireEvent.change(screen.getByTestId("admin-member-quota-input"), { target: { value: "-1" } }); fireEvent.click(screen.getByTestId("admin-member-quota-save"));
  expect(screen.getByTestId("admin-member-quota-error")).toHaveTextContent("Enter a non-negative integer"); toggle();
  expect(screen.getByTestId("admin-member-quota-error")).toHaveTextContent("请输入一个非负整数"); expect(screen.getByTestId("admin-member-quota-input")).toHaveValue("-1"); expect(api.setMemberTokenQuota).not.toHaveBeenCalled();
});
it("keeps actionable server remaining quota details localized and hides private raw errors", async () => {
  api.setMemberTokenQuota.mockRejectedValue(new ApiError(409, "QUOTA_OVERALLOCATED", { remainingTokens: 50_000, message: "private {secret}" }));
  render(<MemberQuotaTab />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-member-quota-user-raw"));
  fireEvent.change(screen.getByTestId("admin-member-quota-input"), { target: { value: "60000" } }); fireEvent.click(screen.getByTestId("admin-member-quota-save"));
  await waitFor(() => expect(screen.getByTestId("admin-member-quota-error")).toHaveTextContent("50,000")); toggle();
  expect(screen.getByTestId("admin-member-quota-error")).toHaveTextContent("超出组织剩余额度"); expect(screen.getByTestId("admin-member-quota-error")).toHaveTextContent("5 万"); toggle();
  expect(screen.getByTestId("admin-member-quota-error")).not.toHaveTextContent(/QUOTA_OVERALLOCATED|private/); expect(api.setMemberTokenQuota).toHaveBeenCalledTimes(1);
});
it("preserves pending organization budget edits through locale updates and retranslates the resulting notice", async () => {
  let finish!: (value: unknown) => void; api.setOrgTokenBudget.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<MemberQuotaTab />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-quota-budget-open"));
  expect(screen.getByTestId("admin-quota-budget-modal")).toHaveTextContent("Organization monthly token budget");
  fireEvent.change(screen.getByTestId("admin-quota-budget-input"), { target: { value: "600000" } }); fireEvent.click(screen.getByTestId("admin-quota-budget-save"));
  toggle(); toggle(); expect(screen.getByTestId("admin-quota-budget-input")).toHaveValue("600000"); expect(api.setOrgTokenBudget.mock.calls).toEqual([["org-quotas-raw", 600000]]);
  await act(async () => finish({})); await waitFor(() => expect(screen.queryByTestId("admin-quota-budget-modal")).toBeNull());
  expect(screen.getByTestId("admin-quota-toast")).toHaveTextContent("600,000"); toggle(); expect(screen.getByTestId("admin-quota-toast")).toHaveTextContent("组织月度额度已设为");
});
it("explains budget-below-allocated in the current language without altering the server detail", async () => {
  api.setOrgTokenBudget.mockRejectedValue(new ApiError(409, "BUDGET_BELOW_ALLOCATED", { allocated: 100_000 }));
  render(<MemberQuotaTab />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-quota-budget-open")); fireEvent.click(screen.getByTestId("admin-quota-budget-save"));
  await waitFor(() => expect(screen.getByTestId("admin-quota-budget-error")).toHaveTextContent("100,000")); toggle(); expect(screen.getByTestId("admin-quota-budget-error")).toHaveTextContent("不能低于已分配之和");
  expect(api.setOrgTokenBudget).toHaveBeenCalledTimes(1);
});
it("shows localized absent-organization and read failures without making locale a read trigger", async () => {
  api.orgId = null; const first = render(<MemberQuotaTab />, { wrapper: Locale }); expect(screen.getByText("No organization selected.")).toBeVisible(); expect(api.getTokenQuotas).not.toHaveBeenCalled(); first.unmount();
  api.orgId = "org-quotas-raw"; api.getTokenQuotas.mockRejectedValue(new ApiError(403, "FORBIDDEN", { message: "private body" })); render(<MemberQuotaTab />, { wrapper: Locale });
  const failed = await screen.findByTestId("admin-quota-load-failed"); expect(failed).toHaveTextContent("Could not load quota data"); expect(failed).not.toHaveTextContent(/FORBIDDEN|private body/); toggle(); expect(failed).toHaveTextContent("配额数据读取失败"); expect(api.getTokenQuotas).toHaveBeenCalledTimes(1);
});
it("localizes invitation summary and status while preserving authored email/inviter and avoiding reload", async () => {
  render(<MemberInvitesPanel />, { wrapper: Locale }); const panel = await screen.findByTestId("admin-members-list");
  expect(panel).toHaveTextContent("Members: 1"); expect(panel).toHaveTextContent("Active: 1"); expect(panel).toHaveTextContent("Pending invitations: 1");
  expect(screen.getByTestId("admin-member-status-pending")).toHaveTextContent("Pending acceptance"); expect(panel).toHaveTextContent(invite.email); expect(panel).toHaveTextContent(invite.invitedBy);
  toggle(); expect(screen.getByTestId("admin-member-status-pending")).toHaveTextContent("待接受"); toggle(); expect(api.listOrgMembers).toHaveBeenCalledTimes(1); expect(api.listOrgInvites).toHaveBeenCalledTimes(1);
});
it("retains pending resend identity and reports email delivery while feedback follows locale", async () => {
  let finish!: (value: unknown) => void; api.resendOrgInvite.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<MemberInvitesPanel />, { wrapper: Locale }); fireEvent.click(await screen.findByTestId("admin-member-resend-invite-raw"));
  expect(screen.getByTestId("admin-member-resend-invite-raw")).toHaveTextContent("Resending"); toggle(); expect(screen.getByTestId("admin-member-resend-invite-raw")).toBeDisabled(); toggle();
  expect(api.resendOrgInvite.mock.calls).toEqual([["org-quotas-raw", "invite-raw"]]);
  await act(async () => finish({ activationToken: null, cooldownSec: 60 }));
  await waitFor(() => expect(screen.getByTestId("admin-members-toast")).toHaveTextContent("Invitation email resent"));
  expect(screen.queryByTestId("org-admin-invite-link-url")).toBeNull();
  toggle(); expect(screen.getByTestId("admin-members-toast")).toHaveTextContent("邀请邮件已重新发送");
  expect(screen.getByTestId("admin-members-toast")).toHaveTextContent("旧链接立即失效");
  expect(api.listOrgInvites).toHaveBeenCalledTimes(2);
});
it("resends a legacy awaiting-review invitation and refreshes send-failed after mail failure", async () => {
  api.listOrgInvites.mockResolvedValueOnce({ invites: [{ ...invite, status: "awaiting-review" }] })
    .mockResolvedValue({ invites: [{ ...invite, status: "send-failed" }] });
  api.resendOrgInvite.mockRejectedValue(new ApiError(503, "MAIL_UNAVAILABLE", {}));
  render(<MemberInvitesPanel />, { wrapper: Locale });
  expect(await screen.findByTestId("admin-member-status-awaiting-review")).toHaveTextContent("Needs resending");
  fireEvent.click(screen.getByTestId("admin-member-resend-invite-raw"));
  expect(await screen.findByTestId("admin-members-toast")).toHaveTextContent("Send failed");
  expect(await screen.findByTestId("admin-member-status-send-failed")).toHaveTextContent("Send failed");
  expect(api.listOrgInvites).toHaveBeenCalledTimes(2);
  expect(screen.queryByTestId("org-admin-invite-link-url")).toBeNull();
  toggle();
  expect(screen.getByTestId("admin-members-toast")).toHaveTextContent("发送失败");
});
it("localizes denied invitation visibility without pretending an unread list is empty", async () => {
  api.listOrgInvites.mockRejectedValue(new ApiError(403, "FORBIDDEN", {})); render(<MemberInvitesPanel />, { wrapper: Locale });
  expect(await screen.findByTestId("admin-members-invites-denied")).toHaveTextContent("Only organization administrators can view pending invitations");
  expect(screen.getByTestId("admin-members-roster-count")).not.toHaveTextContent("Pending invitations: 0"); toggle(); expect(api.listOrgInvites).toHaveBeenCalledTimes(1);
});
it.each([new ApiError(502, "PRIVATE_INVITE_CODE", { message: "private invitation body" }), new Error("private invitation exception")])("keeps unknown invitation failures safe and translatable without closing the edited form: %s", async failure => {
  api.inviteOrgMember.mockRejectedValue(failure); render(<MemberInvitesPanel />, { wrapper: Locale });
  fireEvent.click(await screen.findByTestId("admin-members-invite-open"));
  const form = screen.getByTestId("admin-members-invite-dialog");
  fireEvent.change(screen.getByTestId("org-admin-invite-email"), { target: { value: "invite-draft@example.test" } });
  fireEvent.submit(screen.getByTestId("org-admin-invite-form"));
  const toast = await screen.findByTestId("admin-members-toast");
  expect(toast).not.toHaveTextContent(/PRIVATE_INVITE_CODE|private invitation/); expect(toast).toHaveTextContent(/try again|retry|unavailable/i);
  toggle();
  expect(toast).not.toHaveTextContent(/PRIVATE_INVITE_CODE|private invitation/); expect(toast).toHaveTextContent(/重试|再试|不可用/);
  expect(within(form).getByRole("textbox")).toHaveValue("invite-draft@example.test");
  expect(api.inviteOrgMember).toHaveBeenCalledTimes(1);
});
it("preserves private-layer counts and raw access-log references while translating only the boundary explanation", async () => {
  render(<AdminBoundaryLive />, { wrapper: Locale });
  const row = await screen.findByTestId("admin-member-private-user-raw"); expect(row).toHaveTextContent(rawName); expect(row).toHaveTextContent("Private entries: 7"); expect(row).toHaveTextContent("Content hidden");
  const log = await screen.findByTestId("admin-access-log-log-raw"); expect(log).toHaveTextContent("项目原文 {project}"); expect(log).toHaveTextContent("对象原文 {object}"); expect(log).toHaveTextContent("2026-11-01T03:04:05Z");
  expect(screen.getByRole("heading", { name: "What administrators cannot see" })).toBeVisible(); toggle(); expect(row).toHaveTextContent("内容不可见"); toggle();
  expect(api.getPersonalLayerSummary.mock.calls).toEqual([["org-quotas-raw", "user-raw"]]); expect(api.listMyAccessLog).toHaveBeenCalledTimes(1);
});
