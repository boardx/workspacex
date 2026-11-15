import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { apiRequest } from "@/lib/api-client";
import { PersonalTopupHistory } from "@/components/billing/personal-topup-history";

vi.mock("@/lib/api-client", () => ({ apiRequest: vi.fn() }));

it("shows a prior 10-credit recharge using the authenticated purchase ledger", async () => {
  vi.mocked(apiRequest).mockResolvedValue({
    items: [{
      txnId: "txn-10", type: "purchase", direction: 1, credits: 10, balanceAfter: -10.33,
      sourceType: "payment_order", sourceId: "order-10", operatorId: null, reason: null,
      createdAt: "2026-11-15T05:20:00.000Z",
    }],
    nextCursor: null,
  });
  render(<PersonalTopupHistory userId="user-a" sessionToken="session-a" />);
  const section = screen.getByRole("region", { name: "充值记录" });
  expect(await within(section).findByText("+10 Credits")).toBeInTheDocument();
  expect(within(section).getByText("订单号 order-10")).toBeInTheDocument();
  expect(apiRequest).toHaveBeenCalledWith("/billing/transactions", expect.objectContaining({
    sessionToken: "session-a", query: { ownerType: "user", type: "purchase", limit: "10" },
  }));
});
