/**
 * #1493（UC-7.3 第二块）—— 渲染/导出两张纯投影面的单测（不需要 Postgres）。
 *
 * 三件事：
 *   1. `projectSource` 的解析语义与引擎 `parseTemplateText` 逐条相等（防止「带行号视图」
 *      与权威解析器漂移——source-projection.ts 文件头承诺的那条断言）。
 *   2. I-8 反证：收紧白名单后，被挡的块在 `ignoredBlocks` 里点名（type + 精确
 *      rawLineRange），且**没有任何输出路径把 markdown 改掉**——render 面根本不返回
 *      markdown，断言输入串引用未被触碰即可。
 *   3. I-9 反证 + 归区：导出输出无坐标数字、nearestFallback 语义、无几何模板恒等映射。
 */
import { describe, expect, it } from "vitest";
import { parseTemplateText } from "@repo/fabric-markdown/templates";
import { projectRenderFace } from "../../src/application/canvas/render-canvas";
import { projectExportFace } from "../../src/application/canvas/export-canvas-source";
import { projectSource } from "../../src/application/canvas/source-projection";
import type { TemplateSectionFacts } from "../../src/application/canvas/instance-ports";

const SECTIONS: readonly TemplateSectionFacts[] = [
  { sectionId: "s1", name: "优势", order: 0, required: true, capacity: null },
  { sectionId: "s2", name: "劣势", order: 1, required: false, capacity: 5 },
];

const MD = [
  "# SWOT 画布",
  "",
  "## 优势",
  "",
  "- 团队执行力强",
  "- 独家渠道 #blue",
  "跨行的",
  "段落便签",
  "",
  "## 劣势",
  "",
  "- 现金流紧张",
  "",
  "```mermaid",
  "flowchart TD",
  "  A-->B",
  "```",
  "",
  "```mermaid",
  "pie",
  '  "x" : 1',
  "```",
  "",
].join("\n");

describe("#1493 · projectSource 与引擎 parseTemplateText 不漂移", () => {
  it("同一文档（围栏区间置空后喂引擎），逐分区逐条相等", () => {
    const projection = projectSource(MD);
    // 引擎面向围栏内部文本：把围栏行替换成空行后语义等价（source-projection 文件头）。
    let blank = false;
    const engineInput = MD.split("\n")
      .map((l) => {
        if (/^ {0,3}(`{3,}|~{3,})[ \t]*(mermaid|persona|canvas|usecase)[ \t]*$/.test(l)) {
          blank = true;
          return "";
        }
        if (blank && /^ {0,3}`{3,}[ \t]*$/.test(l)) {
          blank = false;
          return "";
        }
        return blank ? "" : l;
      })
      .join("\n");
    const engine = parseTemplateText(engineInput);

    const mineByName = new Map<string, string[]>();
    for (const sec of projection.sections) {
      const bucket = mineByName.get(sec.name) ?? [];
      bucket.push(...sec.stickies.map((s) => s.rawText));
      mineByName.set(sec.name, bucket);
    }
    expect([...mineByName.keys()]).toEqual([...engine.sections.keys()]);
    for (const [name, items] of engine.sections) {
      expect(mineByName.get(name), `分区「${name}」的条目`).toEqual(items);
    }
  });

  it("段落块合并为一条便签且行区间精确；stickyId 按文档序", () => {
    const projection = projectSource(MD);
    const 优势 = projection.sections.find((s) => s.name === "优势")!;
    expect(优势.stickies.map((s) => s.stickyId)).toEqual(["st-1", "st-2", "st-3"]);
    expect(优势.stickies[2]!.rawText).toBe("跨行的 段落便签");
    expect(优势.stickies[2]!.lines).toEqual({ from: 7, to: 8 });
    // 颜色标记：#blue 是引擎 STICKY_COLORS 注册名 ⇒ 剥离进 color。
    expect(优势.stickies[1]!.text).toBe("独家渠道");
    expect(优势.stickies[1]!.color).toBe("#bfdbfe");
    expect(优势.stickies[0]!.color).toBeNull();
  });
});

describe("#1493 · I-8 反证：白名单挡下的块点名保留，markdown 一个字不动", () => {
  it("只放行 flowchart ⇒ pie 块进 ignoredBlocks，rawLineRange 精确到围栏行", () => {
    const face = projectRenderFace(MD, SECTIONS, ["flowchart"]);
    expect(face.ignoredSyntaxCount).toBe(1);
    // pie 块：开围栏在第 19 行，闭围栏在第 22 行（MD 数组 0 起第 18..21 项）。
    expect(face.ignoredBlocks).toEqual([
      { type: "pie", rawLineRange: { from: 19, to: 22 } },
    ]);
    // 被挡的块不进渲染面；放行的块照常进。
    const model = JSON.parse(face.diagramModel) as { blocks: Array<{ code: string }> };
    expect(model.blocks).toHaveLength(1);
    expect(model.blocks[0]!.code).toContain("A-->B");
    // 「不丢内容」：渲染面没有任何 markdown 输出通道，便签/分区投影也不受白名单影响。
    expect(face.stickies).toHaveLength(4);
  });

  it("全放行 ⇒ 零 ignored，两个块都进渲染面", () => {
    const face = projectRenderFace(MD, SECTIONS, ["flowchart", "pie"]);
    expect(face.ignoredSyntaxCount).toBe(0);
    expect(JSON.parse(face.diagramModel).blocks).toHaveLength(2);
  });

  it("sections：冻结分区全形状 + 手写 `##` 追加为派生分区", () => {
    const face = projectRenderFace(MD + "\n## 手写段落\n\n- 额外便签\n", SECTIONS, []);
    expect(face.sections.map((s) => s.sectionId)).toEqual(["s1", "s2", "md:手写段落"]);
    expect(face.sections[0]).toEqual(SECTIONS[0]);
    expect(face.sections[2]).toMatchObject({ order: 2, required: false, capacity: null });
    const extra = face.stickies.find((s) => s.text === "额外便签")!;
    expect(extra.sectionId).toBe("md:手写段落");
  });
});

describe("#1493 · I-9 反证与几何归区（导出面）", () => {
  it("拖进劣势框 ⇒ 归 s2 且原文搬到 ## 劣势 下；输出 markdown 无任何坐标数字", () => {
    const out = projectExportFace(MD, "swot", SECTIONS, [
      { stickyId: "st-1", x: 1190, y: 280 }, // 劣势框中心
      { stickyId: "st-2", x: 430, y: 280 },  // 留在优势框内
    ]);
    expect(out.assignments).toEqual([
      { stickyId: "st-1", sectionId: "s2", nearestFallback: false },
      { stickyId: "st-2", sectionId: "s1", nearestFallback: false },
    ]);
    const [, 劣势段] = out.markdown.split("## 劣势");
    expect(劣势段).toContain("- 团队执行力强");
    expect(out.markdown.split("## 劣势")[0]).not.toContain("团队执行力强");
    // I-9：坐标只是判定输入，判定完即丢——入参的每个坐标数字都不许出现在输出里
    // （MD 自身唯一的数字是 pie 块里的 "1"，与坐标无关，故按入参坐标逐个反证）。
    for (const n of ["1190", "280", "430"]) expect(out.markdown).not.toContain(n);
    // 颜色标记与 mermaid 围栏逐字保留。
    expect(out.markdown).toContain("- 独家渠道 #blue");
    expect(out.markdown).toContain("A-->B");
  });

  it("落在所有框外 ⇒ 归最近框 + nearestFallback=true（E2d 的可撤销提示据此弹出）", () => {
    const out = projectExportFace(MD, "swot", SECTIONS, [
      { stickyId: "st-4", x: -9999, y: -9999 }, // 现金流紧张，离优势 (430,280) 最近
    ]);
    expect(out.assignments).toEqual([
      { stickyId: "st-4", sectionId: "s1", nearestFallback: true },
    ]);
    const 优势段 = out.markdown.split("## 优势")[1]!.split("## 劣势")[0]!;
    expect(优势段).toContain("- 现金流紧张");
  });

  it("引擎没有几何的模板 ⇒ 恒等映射：保持原分区、nearestFallback=false、文档不变", () => {
    const out = projectExportFace(MD, "org-custom-template", SECTIONS, [
      { stickyId: "st-1", x: 12345, y: 67890 },
    ]);
    expect(out.assignments).toEqual([
      { stickyId: "st-1", sectionId: "s1", nearestFallback: false },
    ]);
    expect(out.markdown).toBe(MD);
  });

  it("markdown 里不存在的 stickyId ⇒ 跳过，不产生 assignment、不动文档", () => {
    const out = projectExportFace(MD, "swot", SECTIONS, [
      { stickyId: "st-999", x: 0, y: 0 },
    ]);
    expect(out.assignments).toEqual([]);
    expect(out.markdown).toBe(MD);
  });

  it("段落块便签被移动后按引擎序列化约定收敛为单行列表项", () => {
    const out = projectExportFace(MD, "swot", SECTIONS, [
      { stickyId: "st-3", x: 1190, y: 280 }, // 「跨行的 段落便签」→ 劣势
    ]);
    const 劣势段 = out.markdown.split("## 劣势")[1]!;
    expect(劣势段).toContain("- 跨行的 段落便签");
    expect(out.markdown.split("## 劣势")[0]).not.toContain("跨行的");
  });
});
