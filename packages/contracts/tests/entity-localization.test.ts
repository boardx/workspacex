import { describe, expect, it } from "vitest";
import { EntityLocalizationWrite, resolveEntityDisplay } from "../src/entity-localization";
import { Locale, SUPPORTED_LOCALES } from "../src/locale";
import { SUPPORTED_LOCALES as webLocales, isLocale, resolveLocale } from "../../../apps/web/lib/i18n/locale";

const source = {
  orgId: "org-a", entityId: "skill-1", kind: "skill" as const, revision: "source-v1",
  locale: "zh-CN" as const, fields: { name: "产品探索", summary: "源简介", duty: null },
};
const translation = {
  orgId: "org-a", entityId: "skill-1", kind: "skill" as const, sourceRevision: "source-v1",
  locale: "en" as const, revision: 1, status: "reviewed" as const,
  fields: { name: "Product discovery", summary: null },
};
describe("source-safe entity display localization", () => {
  it("localizes only explicit fields and preserves the source object", () => {
    const before = structuredClone(source);
    const display = resolveEntityDisplay(source, "en", translation);
    expect(display.fields.name).toEqual({ value: "Product discovery", resolvedLocale: "en", fallback: false });
    expect(display.fields.summary).toEqual({ value: "源简介", resolvedLocale: "zh-CN", fallback: true });
    expect(display.fields.duty).toEqual({ value: null, resolvedLocale: "zh-CN", fallback: true });
    expect(source).toEqual(before);
  });
  it("returns source language without marking it as fallback when requested directly", () => {
    expect(resolveEntityDisplay(source, "zh-CN", translation).fields.name).toEqual({
      value: "产品探索", resolvedLocale: "zh-CN", fallback: false,
    });
  });
  it.each([
    { sourceRevision: "old" }, { status: "draft" }, { orgId: "org-b" },
    { entityId: "other" }, { kind: "agent" }, { locale: "zh-CN" },
  ])("ignores stale, unreviewed, foreign or different locale translations: %j", (patch) => {
    const display = resolveEntityDisplay(source, "en", { ...translation, ...patch });
    expect(display.fields.name.value).toBe("产品探索");
    expect(display.fields.name.fallback).toBe(true);
  });
  it("retains unknown source language and missing translations", () => {
    const display = resolveEntityDisplay({ ...source, locale: null }, "en", null);
    expect(display.fields.name).toEqual({ value: "产品探索", resolvedLocale: null, fallback: true });
  });
  it("does not accept executable content or identity fields from a translation write", () => {
    const input = { sourceRevision: "v1", expectedTranslationRevision: null, status: "draft", fields: { name: "Name" } };
    expect(EntityLocalizationWrite.safeParse(input).success).toBe(true);
    for (const patch of [{ instructions: "override" }, { orgId: "foreign" }, { toolPolicy: [] }]) {
      expect(EntityLocalizationWrite.safeParse({ ...input, ...patch }).success).toBe(false);
    }
    expect(EntityLocalizationWrite.safeParse({ ...input, fields: { instructions: "override" } }).success).toBe(false);
  });
  it("normalizes blank translations to absence and requires positive CAS revisions", () => {
    const input = { sourceRevision: "v1", expectedTranslationRevision: 1, status: "draft", fields: { name: "  " } };
    expect(EntityLocalizationWrite.parse(input).fields.name).toBeNull();
    expect(EntityLocalizationWrite.safeParse({ ...input, expectedTranslationRevision: 0 }).success).toBe(false);
    expect(EntityLocalizationWrite.safeParse({ ...input, sourceRevision: "" }).success).toBe(false);
  });
  it("validates the shared locale wire contract", () => {
    expect(Locale.options).toEqual(["zh-CN", "en"]);
    expect(Locale.safeParse("en-US").success).toBe(false);
    expect(webLocales).toBe(SUPPORTED_LOCALES);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("en-US")).toBe(false);
    expect(resolveLocale(null)).toBe("zh-CN");
  });
});
