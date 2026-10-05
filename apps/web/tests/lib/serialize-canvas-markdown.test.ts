import { describe, expect, it, vi } from "vitest";
import type { Canvas } from "fabric";
import { extractMermaidBlocks, parseTemplateText, templateToModel, getTemplate, listTemplates, registerTemplate } from "@repo/fabric-markdown";
import { canvas as canvasContracts } from "@repo/contracts";
const { BUILTIN_CANVAS_TEMPLATES } = canvasContracts;
import { checkCanvasFence } from "@/lib/canvas/canvas-fence";
import { serializeCanvasMarkdown } from "@/lib/canvas/serialize-canvas-markdown";

// Keep the real template parser/serializer; isolate only the Fabric extraction boundary.
const boundary = vi.hoisted(() => ({ model: null as unknown }));
vi.mock("@repo/fabric-markdown", async (importOriginal) => ({
  ...await importOriginal<typeof import("@repo/fabric-markdown")>(),
  extractModel: () => boundary.model,
}));
const canvas = {} as Canvas;
const code = "模板: persona\n姓名: 林砚\n职位: 动画教授\n## 用户描述\n- 教学与创作\n## 目标和需求\n- 孵化原创IP";

function movedModel() {
  const model = templateToModel(code);
  const sticky = model.nodes.find(n => n.data?.role === "sticky" && n.label === "教学与创作")!;
  const target = model.nodes.find(n => n.data?.role === "section" && n.data.name === "目标和需求")!;
  sticky.x = target.x;
  sticky.y = target.y;
  return model;
}

describe("template canvas save", () => {
  it.each(["canvas", "persona"] as const)("keeps a moved persona renderable inside its %s fence", lang => {
    boundary.model = movedModel();
    const before = `前文\n\n\`\`\`${lang}\n${code}\n\`\`\`\n\n后文`;
    const saved = serializeCanvasMarkdown(canvas, before);
    const block = extractMermaidBlocks(saved)[0]!;
    expect(block.lang).toBe(lang);
    expect(checkCanvasFence(block.code, lang).ok).toBe(true);
    expect(saved.startsWith("前文\n\n")).toBe(true);
    expect(saved.endsWith("\n\n后文")).toBe(true);
    const parsed = parseTemplateText(block.code);
    expect(parsed.fields.get("姓名")).toBe("林砚");
    expect(parsed.sections.get("目标和需求")).toContain("教学与创作");
    expect(parsed.sections.get("用户描述") ?? []).not.toContain("教学与创作");
    boundary.model = templateToModel(block.code, lang === "persona" ? "persona" : undefined);
    expect(serializeCanvasMarkdown(canvas, saved)).toBe(saved);
    if (lang === "canvas") expect(block.code.startsWith("模板: persona\n")).toBe(true);
  });

  it("preserves other template keys and untargeted blocks", () => {
    boundary.model = templateToModel("模板: swot\n## 优势\n- 专业能力");
    const first = "```mermaid\ngraph TD\nA-->B\n```";
    const saved = serializeCanvasMarkdown(canvas, `${first}\n\n\`\`\`canvas\n模板: swot\n## 优势\n- 旧内容\n\`\`\``, 1);
    expect(saved.startsWith(first)).toBe(true);
    const block = extractMermaidBlocks(saved)[1]!;
    expect(block.code.match(/模板: swot/g)).toHaveLength(1);
    expect(checkCanvasFence(block.code, "canvas").ok).toBe(true);
  });

  it("creates a valid persona alias when no existing block is present", () => {
    boundary.model = movedModel();
    const block = extractMermaidBlocks(serializeCanvasMarkdown(canvas))[0]!;
    expect(block.lang).toBe("persona");
    expect(checkCanvasFence(block.code, "persona").ok).toBe(true);
  });
});


describe("all registered canvas templates", () => {
  it("covers the authoritative built-in template registry", () => {
    expect(listTemplates().map(spec => spec.key).sort()).toEqual(Object.keys(BUILTIN_CANVAS_TEMPLATES).sort());
  });

  it.each(Object.keys(BUILTIN_CANVAS_TEMPLATES))("keeps %s identity, fields and moved notes through repeated saves", key => {
    const spec = getTemplate(key)!;
    const source = [`模板: ${key}`, ...(spec.fields ?? []).map(field => `${field}: 测试字段`),
      ...spec.sections.flatMap(section => [`## ${section.name}`, `- 便签：${section.name}`])].join("\n");
    const model = templateToModel(source);
    const sections = model.nodes.filter(n => n.data?.role === "section");
    const moved = model.nodes.find(n => n.data?.role === "sticky")!;
    const originalLabel = moved.label;
    const target = sections[sections.length - 1]!;
    moved.x = target.x;
    moved.y = target.y;
    boundary.model = model;
    const saved = serializeCanvasMarkdown(canvas, `正文\n\n~~~~canvas\n${source}\n~~~~\n尾文`);
    const block = extractMermaidBlocks(saved)[0]!;
    expect(block.fence).toBe("~~~~");
    expect(block.code.startsWith(`模板: ${key}\n`)).toBe(true);
    expect(checkCanvasFence(block.code, "canvas")).toMatchObject({ ok: true, key });
    const parsed = parseTemplateText(block.code);
    expect(parsed.templateKey).toBe(key);
    expect(parsed.sections.get(String(target.data?.name))?.some(item =>
      item === originalLabel || item.startsWith(`${originalLabel} #`))).toBe(true);
    for (const field of spec.fields ?? []) expect(parsed.fields.get(field)).toBe("测试字段");
    expect([...parsed.sections.values()].flat()).toHaveLength(spec.sections.length);
    const restored = templateToModel(block.code);
    const restoredNote = restored.nodes.find(n => n.data?.role === "sticky" && n.label === originalLabel)!;
    expect(restoredNote.data?.color).toBe(moved.data?.color);
    boundary.model = restored;
    expect(serializeCanvasMarkdown(canvas, saved)).toBe(saved);
  });

  it("uses the same save contract for organization-defined templates", () => {
    registerTemplate({ key: "save-regression-custom", title: "组织模板", sections: [
      { name: "来源", x: 200, y: 200, w: 300, h: 300 },
      { name: "目标", x: 600, y: 200, w: 300, h: 300 },
    ] });
    const model = templateToModel("模板: save-regression-custom\n## 来源\n- 自定义便签");
    const sticky = model.nodes.find(n => n.data?.role === "sticky")!;
    sticky.x = 600;
    sticky.y = 200;
    boundary.model = model;
    const saved = serializeCanvasMarkdown(canvas);
    const block = extractMermaidBlocks(saved)[0]!;
    expect(checkCanvasFence(block.code, "canvas")).toMatchObject({ ok: true, key: "save-regression-custom" });
    expect(parseTemplateText(block.code).sections.get("目标")).toContain("自定义便签");
  });

  it("rejects a model without identity instead of saving an unrenderable canvas", () => {
    const model = movedModel();
    delete model.meta?.templateKey;
    boundary.model = model;
    expect(() => serializeCanvasMarkdown(canvas)).toThrow("without its template key");
  });

  it("does not use the persona alias for a different template", () => {
    boundary.model = templateToModel("模板: swot\n## 优势\n- 专业能力");
    const saved = serializeCanvasMarkdown(canvas, "```persona\n姓名: 林砚\n## 用户描述\n- 教学\n```");
    const block = extractMermaidBlocks(saved)[0]!;
    expect(block.lang).toBe("canvas");
    expect(checkCanvasFence(block.code, "canvas")).toMatchObject({ ok: true, key: "swot" });
  });
});
