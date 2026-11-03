import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { MembersScreen } from "@/components/org-admin/members-screen";
import { orgMembersPreviewZhCN, orgMembersPreviewEn } from "@/lib/i18n/namespaces/org-members-preview";
import { RosterScreen } from "@/components/org-admin/roster-screen";
afterEach(cleanup);
function Switch() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>Switch language</button>; }
describe("organization member previews localization", () => {
  for (const [action, expectedEnglish, expectedChinese] of [
    ["members-export", "Member and quota CSV exported", "已导出成员与配额 CSV"],
    ["members-resend", "Resent to 陈默", "已重发给 陈默"],
    ["roster-copy", "Copied join link for group 1", "已复制第 1 组加入链接"],
    ["roster-qr", "QR code generated", "二维码已生成"],
  ] as const) {
    it(`updates visible ${action} feedback when locale changes`, () => {
      const members = action.startsWith("members");
      render(<I18nProvider initialLocale="en"><Switch />{members ? <MembersScreen state="default" orgRole="admin" /> : <RosterScreen state="default" previewRole="facilitator" />}</I18nProvider>);
      fireEvent.click(screen.getAllByTestId(action)[0]!);
      const toast = screen.getByTestId(members ? "members-toast" : "roster-toast");
      const english = toast.textContent;
      expect(english).toContain(expectedEnglish);
      fireEvent.click(screen.getByText("Switch language"));
      expect(toast.textContent).toContain(expectedChinese);
      if (action === "members-resend") expect(toast.textContent).toContain("陈默");
      if (action === "roster-copy") expect(toast.textContent).toContain("1");
    });
  }
  it("keeps locale keys aligned", () => {
    expect(Object.keys(orgMembersPreviewEn).sort()).toEqual(Object.keys(orgMembersPreviewZhCN).sort());
  });
  it("preserves organization role restrictions and member data in English", () => {
    render(<I18nProvider initialLocale="en"><MembersScreen state="default" orgRole="consultant" /></I18nProvider>);
    expect(screen.getByTestId("members-invite-open").hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("Project lead").length).toBeGreaterThan(0);
    expect(screen.getByText("林可")).toBeTruthy();
    expect(screen.getAllByTestId("members-status-pending")[0]!.textContent).toContain("Awaiting invitation acceptance");
  });
  it("translates invitation roles and switches the open dialog without losing state", () => {
    render(<I18nProvider initialLocale="en"><Switch /><MembersScreen state="default" orgRole="admin" /></I18nProvider>);
    fireEvent.click(screen.getByTestId("members-invite-open"));
    expect(screen.getByText("Work email")).toBeTruthy();
    expect(screen.getByTestId("members-invite-role").textContent).toContain("Administrator");
    fireEvent.click(screen.getByText("Switch language"));
    expect(screen.getByText("工作邮箱")).toBeTruthy();
    expect(screen.getByTestId("members-invite-dialog")).toBeTruthy();
  });
  it("localizes attendance while preserving observer restrictions", () => {
    render(<I18nProvider initialLocale="en"><RosterScreen state="default" previewRole="observer" /></I18nProvider>);
    expect(screen.getByTestId("roster-observer-note").textContent).toContain("anonymized attendance totals");
    expect(screen.queryByTestId("roster-copy")).toBeNull();
    expect(screen.queryByTestId("roster-signin-list")).toBeNull();
  });
});
