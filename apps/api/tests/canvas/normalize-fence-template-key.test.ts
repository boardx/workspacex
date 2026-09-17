import { describe, expect, it } from "vitest";
import { normalizeCanvasFenceTemplateKeys, resolveFenceTemplateKey } from "../../src/domain/canvas/normalize-fence-template-key";

const T = [
  { key: "persona", displayName: "用户画像" },
  { key: "bmc", displayName: "商业模式画布" },
  { key: "ai-bmc", displayName: "AI 商业模型画布" },
  { key: "swot", displayName: "SWOT 分析" },
];

describe("resolveFenceTemplateKey", () => {
  it("keeps valid keys, and fixes what the 4B model actually produced (Mac实测 2026-09-17)", () => {
    expect(resolveFenceTemplateKey("persona", T)).toBe("persona");
    expect(resolveFenceTemplateKey("<personality>", T)).toBe("persona");
    expect(resolveFenceTemplateKey("user-portrait", T)).toBe("persona");
    expect(resolveFenceTemplateKey("user-demographics-and-psychographics", T)).toBe("persona");
    expect(resolveFenceTemplateKey("用户画像", T)).toBe("persona");
    expect(resolveFenceTemplateKey("Business Model Canvas", T)).toBe("bmc");
    expect(resolveFenceTemplateKey("SWOT analysis", T)).toBe("swot");
    expect(resolveFenceTemplateKey("AI-BMC", T)).toBe("ai-bmc");
  });
  it("does not guess: unknown or ambiguous names stay unresolved", () => {
    expect(resolveFenceTemplateKey("competitor-matrix", T)).toBeNull();
    expect(resolveFenceTemplateKey("", T)).toBeNull();
    // two templates sharing a display name -> ambiguous -> null
    expect(resolveFenceTemplateKey("同名", [{ key: "a", displayName: "同名" }, { key: "b", displayName: "同名" }])).toBeNull();
  });
});

describe("normalizeCanvasFenceTemplateKeys", () => {
  it("rewrites only the 模板 line of unknown-but-resolvable fences, both colon widths, and reports each correction", () => {
    const text = "前言\n```canvas\n模板：user-portrait\n## 用户描述\n- 老李\n```\n中间\n```canvas\n模板: bmc\n## 客户细分\n- x\n```\n```canvas\n模板: competitor-matrix\n## a\n```";
    const r = normalizeCanvasFenceTemplateKeys(text, T);
    expect(r.corrections).toEqual([{ from: "user-portrait", to: "persona" }]);
    expect(r.text).toContain("```canvas\n模板：persona\n## 用户描述");
    expect(r.text).toContain("模板: bmc\n");              // valid key untouched
    expect(r.text).toContain("模板: competitor-matrix\n"); // unknown stays, web reports it honestly
    expect(r.text.replace("模板：persona", "模板：user-portrait")).toBe(text); // nothing else changed
  });
  it("is a no-op without templates or without fences", () => {
    expect(normalizeCanvasFenceTemplateKeys("no fence", T)).toEqual({ text: "no fence", corrections: [] });
    expect(normalizeCanvasFenceTemplateKeys("```canvas\n模板: user-portrait\n## a\n```", [])).toEqual({ text: "```canvas\n模板: user-portrait\n## a\n```", corrections: [] });
  });
});
