import { describe, expect, it, vi } from "vitest";
import type { Canvas } from "fabric";
import { extractMermaidBlocks, parseTemplateText, templateToModel } from "@repo/fabric-markdown";
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
