import { expect, it } from "vitest";
import { creditMonthBoundary, paidCreditWindows } from "../../src/domain/billing/personal-credit-calendar";

const date = (iso: string) => new Date(iso);
it("restores the original purchase day after short months for all twelve annual windows", () => {
  const anchor = date("2027-01-31T23:48:59.123Z");
  const windows = paidCreditWindows(anchor, "year", date("2028-02-01T00:00:00.000Z"));
  expect(windows).toHaveLength(12);
  expect(windows[0]).toEqual({ index: 0, start: anchor, end: date("2027-02-28T23:48:59.123Z") });
  expect(windows[1]!.end).toEqual(date("2027-03-31T23:48:59.123Z"));
  expect(windows[11]!.end).toEqual(date("2028-01-31T23:48:59.123Z"));
  for (let i = 1; i < windows.length; i++) expect(windows[i]!.start).toEqual(windows[i - 1]!.end);
});
it("clamps leap-day anniversaries but restores leap-day in a leap year", () => {
  const anchor = date("2024-02-29T06:07:08.009Z");
  expect(creditMonthBoundary(anchor, 12)).toEqual(date("2025-02-28T06:07:08.009Z"));
  expect(creditMonthBoundary(anchor, 48)).toEqual(date("2028-02-29T06:07:08.009Z"));
});
it("never returns a future credit window or grants twelve months on annual purchase", () => {
  const anchor = date("2027-01-31T12:00:00.000Z");
  expect(paidCreditWindows(anchor, "year", date("2027-01-31T11:59:59.999Z"))).toEqual([]);
  expect(paidCreditWindows(anchor, "year", anchor)).toHaveLength(1);
  expect(paidCreditWindows(anchor, "year", date("2027-02-28T11:59:59.999Z"))).toHaveLength(1);
  expect(paidCreditWindows(anchor, "year", date("2027-02-28T12:00:00.000Z"))).toHaveLength(2);
});
it("caps monthly and annual grants at the paid period, including late scheduling", () => {
  const anchor = date("2027-01-31T12:00:00.000Z"), late = date("2030-01-01T00:00:00.000Z");
  expect(paidCreditWindows(anchor, "month", late)).toHaveLength(1);
  expect(paidCreditWindows(anchor, "year", late)).toHaveLength(12);
});
it("rejects invalid dates, unsupported cycles and fractional/negative month offsets", () => {
  const anchor = date("2027-01-31T12:00:00.000Z");
  for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) expect(() => creditMonthBoundary(anchor, offset)).toThrow();
  expect(() => creditMonthBoundary(new Date(NaN), 1)).toThrow();
  expect(() => paidCreditWindows(anchor, "year", new Date(NaN))).toThrow();
  expect(() => paidCreditWindows(anchor, "week" as "month", anchor)).toThrow();
  expect(anchor.toISOString()).toBe("2027-01-31T12:00:00.000Z");
});

it("keeps the original purchase day across monthly and annual renewal boundaries", () => {
  const jan = date("2027-01-31T12:00:00.000Z");
  expect(paidCreditWindows(jan,"month",date("2027-02-28T12:00:00.000Z"),1)).toEqual([{index:0,start:date("2027-02-28T12:00:00.000Z"),end:date("2027-03-31T12:00:00.000Z")}]);
  const leap = date("2024-02-29T06:07:08.009Z");
  const renewed = paidCreditWindows(leap,"year",date("2025-03-29T06:07:08.009Z"),12);
  expect(renewed[0]!.start).toEqual(date("2025-02-28T06:07:08.009Z"));
  expect(renewed[0]!.end).toEqual(date("2025-03-29T06:07:08.009Z"));
});
