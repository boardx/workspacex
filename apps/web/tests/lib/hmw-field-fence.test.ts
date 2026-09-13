import { describe, expect, it } from "vitest";
import { checkCanvasFence } from "@/lib/canvas/canvas-fence";
import { parseTemplateText, templateToModel, serializeTemplate } from "@repo/fabric-markdown";

describe("HMW field-only canvas", () => {
  it.each([["我们可以如何", "为给"], ["我们可以", "为谁"]])("keeps %s/%s values through rendering and export", (how, who) => {
    const code = `模板: hmw\n${how}: 简化报销\n${who}: 出差人员\n以便: 减少等待`;
    expect(checkCanvasFence(code, "canvas")).toEqual({ ok: true, key: "hmw", sectionCount: 0 });
    const model = templateToModel(code);
    const exported = serializeTemplate(model);
    expect(exported).toContain("我们可以如何: 简化报销");
    expect(exported).toContain("为给: 出差人员");
    expect(exported).toContain("以便: 减少等待");
  });
  it("keeps explicit canonical values when an alias is also present", () => {
    const p = parseTemplateText("模板: hmw\n为给: 规范值\n为谁: 别名值");
    expect(p.fields.get("为给")).toBe("规范值");
  });
  it.each(["模板: hmw", "模板: hmw\n我们可以: ", "模板: hmw\n未知: 内容", "模板: swot\n我们可以: 内容", "模板: unknown\n我们可以: 内容"])("rejects empty or unrelated input: %s", code => {
    expect(checkCanvasFence(code, "canvas").ok).toBe(false);
  });
});
