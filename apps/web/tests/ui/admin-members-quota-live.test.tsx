import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { MemberQuotaTab } from "@/components/admin/member-quota-tab";

const api = vi.hoisted(() => ({ getMemberCreditQuotas: vi.fn(), getTokenQuotas: vi.fn() }));
vi.mock("@/lib/live-member-credit-quota", () => api);
vi.mock("@/lib/live-org-admin", () => api);
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org-credit" } }),
}));

afterEach(cleanup);
it.each([true, false])("uses the Credit API and reflects enterprise eligibility (%s)", async (enterprise) => {
  api.getMemberCreditQuotas.mockResolvedValue({
    enterprise, month: "2026-11", defaultMonthlyLimit: 5000,
    members: enterprise ? [{ userId: "member", displayName: "Member", email: "", monthlyLimit: 5000, overridden: false, usedCredits: 2000, heldCredits: 0 }] : [],
  });
  render(<I18nProvider initialLocale="en"><MemberQuotaTab /></I18nProvider>);
  if (enterprise) {
    expect(await screen.findByRole("button", { name: "Adjust limits in bulk" })).toBeEnabled();
    expect(screen.getByTestId("member-credit-adjust-member")).toBeEnabled();
  } else {
    expect(await screen.findByTestId("admin-member-credit-unavailable")).toHaveTextContent("Members use personal Credits.");
  }
  expect(api.getMemberCreditQuotas).toHaveBeenCalledWith("org-credit");
  expect(api.getTokenQuotas).not.toHaveBeenCalled();
  expect(screen.queryByTestId("admin-quota-budget-open")).toBeNull();
});
