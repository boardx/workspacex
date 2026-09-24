/**
 * 深度 S8（#3988）—— 原型导出 .pptx：一页一张幻灯片，文字是文本框、表格是表格、图表是原生图表。
 *
 * 钉住：排版不出界（排不下就等比缩，不裁内容）；没画出来的页也占一页、如实说；写出来的包拆开看，
 * 页数、每页的字、表格、图表、演讲者备注都在。
 */
import { describe, expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { designPrototype } from "@repo/contracts";
import { SLIDE_H, SLIDE_W, buildPrototypePptx, layoutSlide, prototypePptxFileName } from "@/lib/prototype-pptx-export";
import type { DesignProject } from "@/lib/live-design-workbench";

type N = designPrototype.PrototypeNode;

/** 读 zip 中央目录（不引第三方）：.pptx 就是一个 zip。 */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + csize);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString("utf8"));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return out;
}

const cover: N = { type: "stack", props: { align: "center" }, children: [{ type: "hero", props: { title: "轻账：小微企业的自动财务", subtitle: "A 轮融资 · 2026", cta: "联系我们" } }] };
const market: N = { type: "stack", children: [
  { type: "text", props: { content: "市场规模", variant: "title" } },
  { type: "grid", props: { columns: 3 }, children: [
    { type: "stat", props: { label: "TAM", value: "¥3,200 亿" } },
    { type: "stat", props: { label: "SAM", value: "¥800 亿" } },
    { type: "stat", props: { label: "SOM", value: "¥40 亿", delta: "+35%", tone: "success" } },
  ] },
  { type: "table", props: { columns: ["年份", "营收"], rows: [["2025", "1,200 万"], ["2026", "3,000 万"]] } },
  { type: "chart", props: { kind: "bar", title: "营收", labels: ["2025", "2026"], values: [1200, 3000] } },
] };
/** 一页远远放不下：30 行列表 + 一张图表。 */
const tall: N = { type: "stack", children: [
  { type: "text", props: { content: "很长的一页", variant: "title" } },
  { type: "list", props: { items: Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 条：一句不短的说明文字，用来把这一页撑得很高`) } },
  { type: "chart", props: { kind: "line", labels: ["一", "二"], values: [1, 2] } },
] };

function project(): DesignProject {
  return {
    id: "p1", name: "融资路演", template: "ui", theme: "light", accent: "blue",
    tokens: { brand: "#FF5A1F", font: "sans", radius: "default", density: "default" }, tags: [], refImages: [], share: null,
    problem: "", criteria: [], frames: ["封面", "市场规模", "团队"], frameNotes: ["开场先讲痛点", "", ""],
    prototype: [cover, market, null] as never,
    pushed: false, pushedAt: null, linkedFeedbackId: null, githubIssueUrl: null, githubIssueNumber: null,
    chat: [], ownerId: "u1", ownerName: "我", createdAt: "2026-09-24T00:00:00.000Z", updatedAt: "2026-09-24T00:00:00.000Z",
  };
}

const inside = (s: { x: number; y: number; w: number; h?: number }) =>
  s.x >= -1e-6 && s.y >= -1e-6 && s.x + s.w <= SLIDE_W + 1e-6 && s.y + (s.h ?? 0) <= SLIDE_H + 1e-6;

describe("layoutSlide", () => {
  it("排不下就等比缩：30 行列表 + 图表也全在幻灯片里，一行不丢", () => {
    // ⭐ 反证锚点：去掉等比缩 ⇒ 这条红——内容排出幻灯片底边，PowerPoint 里看不见。
    const shapes = layoutSlide(tall, "长页", "1F2937");
    expect(shapes.every(inside)).toBe(true);
    const list = shapes.find((s) => s.kind === "text" && s.bullets !== undefined);
    expect(list?.kind === "text" && list.bullets?.length).toBe(30);
    expect(shapes.some((s) => s.kind === "chart")).toBe(true);
  });

  it("放得下就不缩：封面标题 36 号、居中；网格三列并排、不重叠", () => {
    const c = layoutSlide(cover, "封面", "FF5A1F");
    const title = c.find((s) => s.kind === "text" && s.text.startsWith("轻账"));
    expect(title?.kind === "text" && [title.pt, title.align]).toEqual([36, "center"]);
    expect(c.find((s) => s.kind === "button")).toMatchObject({ text: "联系我们", fill: "FF5A1F" });
    const values = layoutSlide(market, "市场", "1F2937").filter((s) => s.kind === "text" && /亿$/.test(s.text));
    expect(values).toHaveLength(3);
    expect(new Set(values.map((v) => v.y)).size).toBe(1);
    for (let i = 1; i < values.length; i++) expect(values[i]!.x).toBeGreaterThanOrEqual(values[i - 1]!.x + values[i - 1]!.w);
  });

  it("没画出来的页也占一页，如实说", () => {
    expect(layoutSlide(null, "团队", "1F2937")).toMatchObject([{ kind: "text", text: "「团队」这一页还没画出来" }]);
  });
});

describe("buildPrototypePptx", () => {
  it("一页一张：三页进三页出；字是文本、表格是表格、图表是原生图表；备注进演讲者备注", async () => {
    const files = unzip(Buffer.from(await buildPrototypePptx(project())));
    expect(files.has("[Content_Types].xml")).toBe(true);
    expect([...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort()).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]);
    expect(files.get("ppt/slides/slide1.xml")).toContain("轻账：小微企业的自动财务");
    const s2 = files.get("ppt/slides/slide2.xml")!;
    expect(s2).toContain("¥3,200 亿");
    expect(s2).toContain("<a:tbl>");
    expect(s2).toContain("3,000 万");
    expect([...files.keys()].some((k) => /^ppt\/charts\/chart\d+\.xml$/.test(k))).toBe(true);
    expect(files.get("ppt/slides/slide3.xml")).toContain("这一页还没画出来");
    expect([...files.entries()].some(([k, v]) => k.startsWith("ppt/notesSlides/") && v.includes("开场先讲痛点"))).toBe(true);
  });

  it("文件名 ASCII、.pptx（中文项目名转拼音交给同一套规则）", () => {
    expect(prototypePptxFileName("Deck", new Date(2026, 8, 24))).toBe("Deck-slides-2026-09-24.pptx");
  });
});
