import { expect, it } from "vitest";
import { BillingTransactionType, BillingTransactionSourceType, CreditPeriodKind } from "../src/billing-credits";
it("declares welcome grant and expiry independently of admin and paid subscription sources", () => {
  expect(BillingTransactionType.parse("welcome_grant")).toBe("welcome_grant");
  expect(BillingTransactionType.parse("welcome_expire")).toBe("welcome_expire");
  expect(BillingTransactionSourceType.parse("welcome_period")).toBe("welcome_period");
  expect(CreditPeriodKind.options).toEqual(["subscription", "welcome"]);
  expect(BillingTransactionType.safeParse("signup_bonus_unlimited").success).toBe(false);
  expect(CreditPeriodKind.safeParse("permanent").success).toBe(false);
});
