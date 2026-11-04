import { describe, expect, it } from "vitest";
import { translate } from "@/lib/i18n/messages";

describe("admin quota count copy", () => {
  it.each([1, 2])("uses count-neutral English rule copy for %i", (count) => {
    expect(translate("en", "adminLimitPolicy.count", { count })).toBe(`Rules: ${count}`);
  });

  it.each([1, 2])("preserves unreported usage suffixes for English count %i", (count) => {
    for (const suffix of [" · raw{suffix}", ""]) {
      expect(translate("en", "aiUsage.unknownCount", { count, suffix })).toBe(
        `Calls with unreported usage: ${count}${suffix}`,
      );
    }
  });

  it.each([1, 2])("uses count-neutral English page copy for %i", (count) => {
    expect(translate("en", "aiUsage.pageCount", { count })).toBe(
      `Records on this page: ${count} · Ordered by call start time`,
    );
  });

  it.each([1, 2])("preserves existing Chinese count copy for %i", (count) => {
    expect(translate("zh-CN", "adminLimitPolicy.count", { count })).toBe(`共 ${count} 条规则`);
    expect(translate("zh-CN", "aiUsage.pageCount", { count })).toBe(
      `本页 ${count} 条 · 按调用开始时间展示`,
    );
    for (const suffix of [" · raw{suffix}", ""]) {
      expect(translate("zh-CN", "aiUsage.unknownCount", { count, suffix })).toBe(
        `${count} 次调用未上报用量${suffix}`,
      );
    }
  });
});
