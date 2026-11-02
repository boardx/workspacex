import { describe, expect, it } from "vitest";
import { zhCN } from "@/lib/i18n/messages/zh-CN";
import { en } from "@/lib/i18n/messages/en";
import { translate } from "@/lib/i18n/messages";
import { formatRelativeTime } from "@/lib/home-format";
describe("language resources", () => {
 it("covers the same messages and interpolation parameters", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(zhCN).sort());
  for (const key of Object.keys(zhCN) as (keyof typeof zhCN)[]) {
   expect(en[key].trim(), key).not.toBe("");
   expect((en[key].match(/\{\w+\}/g) ?? []).sort(), key).toEqual((zhCN[key].match(/\{\w+\}/g) ?? []).sort());
  }
 });
 it("never recursively interpolates user text", () => {
  expect(translate("en", "home.greeting", { name: "{name}<b>" })).toBe("Hello, {name}<b>");
 });
 it("formats relative dates in the active language without changing the default", () => {
  const now = Date.parse("2026-11-03T00:05:00Z");
  expect(formatRelativeTime("2026-11-03T00:00:00Z", now, "en")).toBe("5 minutes ago");
  expect(formatRelativeTime("2026-11-03T00:00:00Z", now)).toBe("5 分钟前");
 });
});
