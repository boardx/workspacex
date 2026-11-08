import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ConfirmDialog, Toast } from "@/components/admin/panel";
import { MembersTab, InviteMemberForm, OneTimeActivationLink } from "@/components/org-admin/org-admin-screen";

function LocaleControl() {
  const { setLocale } = useI18n();
  return <button onClick={() => setLocale("zh-CN")}>Switch Chinese</button>;
}
function bilingual(children: React.ReactNode) {
  return render(<I18nProvider initialLocale="en"><LocaleControl />{children}</I18nProvider>);
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
afterEach(() => vi.unstubAllGlobals());

describe("organization member and invitation localization", () => {
  it("switches member roles without changing names or refetching membership", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ members: [
      { userId: "u-original", displayName: "管理员 {name} · 林可", email: "lin@example.test", orgRole: "consultant", teamId: null, joinedAt: "2026-01-03", status: "active" },
    ] }));
    vi.stubGlobal("fetch", fetch);
    bilingual(<MembersTab orgId="org-locale" isAdmin={false} />);
    const row = await screen.findByTestId("org-admin-member-u-original");
    expect(row).toHaveTextContent("Member");
    expect(row).toHaveTextContent("管理员 {name} · 林可");
    expect(screen.queryByTestId("org-admin-member-u-original-org-role")).toBeNull();
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(row).toHaveTextContent("成员");
    expect(row).toHaveTextContent("管理员 {name} · 林可");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("combines search, role and status filters without fetching again", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ members: [
      { userId: "one", displayName: "Alice", email: "alice@example.test", orgRole: "admin", joinedAt: "2026-01-03", status: "active" },
      { userId: "two", displayName: "Bob", email: "bob@example.test", orgRole: "consultant", joinedAt: "2026-01-04", status: "suspended" },
    ] }));
    vi.stubGlobal("fetch", fetch);
    bilingual(<MembersTab orgId="org-filter" isAdmin={false} />);
    await screen.findByTestId("org-admin-member-one");
    fireEvent.change(screen.getByLabelText("Search name or email"), { target: { value: "bob@" } });
    expect(screen.queryByTestId("org-admin-member-one")).toBeNull();
    expect(screen.getByTestId("org-admin-member-two")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "active" } });
    expect(screen.queryByTestId("org-admin-member-two")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("paginates actual records and resets filters to page one with an explicit no-match state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({members: Array.from({length: 11}, (_, i) => ({userId: `page-${i}`, displayName: `Person ${i}`, email: `person${i}@example.test`, orgRole: "consultant", joinedAt: "2026-01-03", status: "active"}))})));
    bilingual(<MembersTab orgId="org-pages" isAdmin={false} />);
    await screen.findByTestId("org-admin-member-page-0");
    expect(screen.queryByTestId("org-admin-member-page-10")).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Next"}));
    expect(screen.getByTestId("org-admin-member-page-10")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search name or email"), {target: {value: "missing"}});
    expect(screen.getByText("No matching records")).toBeVisible();
    expect(screen.getByRole("button", {name: "Previous"})).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Search name or email"), {target: {value: "person0@"}});
    expect(screen.getByTestId("org-admin-member-page-0")).toBeVisible();
  });

  it("isolates member statistics and records when the organization changes to a forbidden tenant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json({members:[{userId:"old-user",displayName:"Old tenant",email:"old@example.test",orgRole:"admin",joinedAt:"2026-01-01",status:"active"}]})).mockResolvedValueOnce(json({error:"forbidden"},403)));
    const view=render(<I18nProvider initialLocale="en"><MembersTab orgId="org-a" isAdmin={false}/></I18nProvider>);
    await screen.findByTestId("org-admin-member-old-user");
    view.rerender(<I18nProvider initialLocale="en"><MembersTab orgId="org-b" isAdmin={false}/></I18nProvider>);
    expect(screen.queryByTestId("org-admin-member-old-user")).toBeNull();
    await waitFor(()=>expect(screen.queryByLabelText("Search name or email")).toBeNull());
  });

  it("submits original email and role keys from an English invitation form", async () => {
    const fetch = vi.fn().mockResolvedValue(json({ inviteId: "inv-locale", activationToken: "token-original", status: "pending", quotaReserved: 1, tokenIssued: true }));
    vi.stubGlobal("fetch", fetch);
    const onLink = vi.fn();
    const onFailed = vi.fn();
    const onSucceeded = vi.fn();
    bilingual(<InviteMemberForm orgId="org-locale" onSucceeded={onSucceeded} onFailed={onFailed} onLink={onLink} />);
    expect(screen.getByLabelText("Invitee email")).toBeVisible();
    fireEvent.change(screen.getByTestId("org-admin-invite-email"), { target: { value: " Author+原文@example.test " } });
    fireEvent.click(screen.getByTestId("org-admin-invite-submit"));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSucceeded).toHaveBeenCalledWith("Invitation email sent. The invitation link is valid for 7 days."));
    expect(onLink).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body))).toEqual({ orgId: "org-locale", email: "Author+原文@example.test", orgRole: "consultant", teamId: "" });
  });

  it("keeps one-time URL original, translates copy fallback, and dismisses it", async () => {
    const dismiss = vi.fn();
    const clipboard = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { clipboard: { writeText: clipboard } });
    bilingual(<OneTimeActivationLink link={{ email: "林可@example.test", url: "https://example.test/join?t=original", kind: "resent" }} onDismiss={dismiss} />);
    const field = screen.getByTestId<HTMLInputElement>("org-admin-invite-link-url");
    expect(field.value).toBe("https://example.test/join?t=original");
    expect(screen.getByTestId("org-admin-invite-link-once-note")).toHaveTextContent("only once");
    fireEvent.click(screen.getByTestId("org-admin-invite-link-copy"));
    expect(await screen.findByTestId("org-admin-invite-link-copy-failed")).toHaveTextContent("Ctrl/Cmd+C");
    expect(clipboard).toHaveBeenCalledWith(field.value);
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(screen.getByTestId("org-admin-invite-link-copy")).toHaveTextContent("复制");
    expect(field.value).toBe("https://example.test/join?t=original");
    fireEvent.click(screen.getByTestId("org-admin-invite-link-dismiss"));
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
  it("translates an existing field error without submitting or replacing user input", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    bilingual(<InviteMemberForm orgId="org-locale" onSucceeded={vi.fn()} onFailed={vi.fn()} onLink={vi.fn()} />);
    fireEvent.change(screen.getByTestId("org-admin-invite-email"), { target: { value: "原文 {name}" } });
    fireEvent.click(screen.getByTestId("org-admin-invite-submit"));
    expect(screen.getByTestId("err-invite-email")).toHaveTextContent("not a valid email");
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(screen.getByTestId("err-invite-email")).toHaveTextContent("不是合法邮箱");
    expect(screen.getByTestId("org-admin-invite-email")).toHaveValue("原文 {name}");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the last-admin denial and original role after switching language", async () => {
    const fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return Promise.resolve(json({ reasonCode: "LAST_ADMIN" }, 409));
      if (String(url).includes("skill-reviewer-functions")) return Promise.resolve(json({ assignments: [] }));
      return Promise.resolve(json({ members: [{ userId: "last-admin", displayName: "管理员原文", email: "admin@example.test", orgRole: "admin", joinedAt: "2026-01-03", status: "active", teamId: null }] }));
    });
    vi.stubGlobal("fetch", fetch);
    bilingual(<MembersTab orgId="org-locale" isAdmin />);
    const picker = await screen.findByTestId("org-admin-member-last-admin-org-role");
    fireEvent.click(picker);
    fireEvent.click(screen.getByTestId("org-admin-member-last-admin-org-role-option-consultant"));
    expect(await screen.findByTestId("org-admin-member-last-admin-org-role-error")).toHaveTextContent("last administrator");
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(screen.getByTestId("org-admin-member-last-admin-org-role-error")).toHaveTextContent("最后一名管理员");
    expect(picker).toHaveTextContent("管理员");
    expect(fetch).toHaveBeenCalledTimes(2); // membership GET + role PATCH; retired reviewer GET is absent
    const update = fetch.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(update?.[1]?.body))).toEqual({ orgId: "org-locale", userId: "last-admin", orgRole: "consultant" });
  });

  it("translates the shared confirmation labels while retaining reason gating and input", () => {
    bilingual(<ConfirmDialog testid="locale-confirm" title="原始标题" impact="影响原文" confirmLabel="Confirm" requireReason onCancel={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByTestId("locale-confirm-cancel")).toHaveTextContent("Cancel");
    expect(screen.getByTestId("locale-confirm-confirm")).toBeDisabled();
    const reason = screen.getByTestId("locale-confirm-reason");
    expect(screen.getByLabelText("Reason (required, recorded in audit)")).toBe(reason);
    fireEvent.change(reason, { target: { value: "理由 原文 {name}" } });
    expect(screen.getByTestId("locale-confirm-confirm")).not.toBeDisabled();
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(screen.getByTestId("locale-confirm-cancel")).toHaveTextContent("取消");
    expect(reason).toHaveValue("理由 原文 {name}");
    expect(screen.getByTestId("locale-confirm-confirm")).not.toBeDisabled();
  });

  it("translates the toast close control without changing the feedback payload", () => {
    const close = vi.fn();
    bilingual(<Toast message="原始提示 {name}" onDismiss={close} testid="locale-toast" />);
    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBe(screen.getByTestId("locale-toast-close"));
    fireEvent.click(screen.getByText("Switch Chinese"));
    expect(screen.getByRole("button", { name: "关闭提示" })).toBe(screen.getByTestId("locale-toast-close"));
    expect(screen.getByTestId("locale-toast")).toHaveTextContent("原始提示 {name}");
    fireEvent.click(screen.getByTestId("locale-toast-close"));
    expect(close).toHaveBeenCalledTimes(1);
  });

});
