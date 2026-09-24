/**
 * 深度 S8（#3988）—— 把原型导出成**能在 PowerPoint / Keynote / WPS 里改的** .pptx。
 *
 * ## 它解决什么
 *
 * 做路演幻灯片的人，最后一站几乎都是 PowerPoint：要套公司模板、要改一个数字、要发给不用我们产品的人。
 * 此前能拿走的只有 PNG（一张图，一个字都改不了）和 HTML。这里每一页出一张幻灯片，**文字是文本框、
 * 表格是表格、图表是原生图表**——在 PowerPoint 里点进去就能改。
 *
 * ## 怎么排
 *
 * 分两步，第一步是纯函数（可测，不碰 zip）：
 * 1. `layoutSlide`：一页原型树 → 一组摆好位置的形状（英寸）。按原型的结构流式排：竖着的一个接一个，
 *    横着的 / 网格平分宽度；估不准字宽，就按中日韩字一字宽、拉丁字半字宽估行数。整页排下来比一张
 *    幻灯片高，就**等比缩**（字号和间距一起），不裁掉任何内容——宁可字小一点，不能丢一句话。
 * 2. `buildPrototypePptx`：把形状交给 pptxgenjs 写成文件（动态加载，不进主包）。
 *
 * 不是像素级还原：幻灯片是 16:9 的纸，原型可能是一部手机。要的是「内容和结构都在、能改」，
 * 要像素级的请用「当前页 PNG」。
 */
import { designPrototype } from "@repo/contracts";
import type { DesignProject } from "@/lib/live-design-workbench";
import { exportFileStem, type Romanize } from "@/lib/export-file-name";
import { localDateStamp } from "@/lib/prototype-export-html";

type Node = designPrototype.PrototypeNode;

/** 16:9 幻灯片（英寸）与页边距。 */
export const SLIDE_W = 10;
export const SLIDE_H = 5.625;
const MARGIN_X = 0.5;
const MARGIN_Y = 0.4;

const INK = "1F2937";
const MUTED = "6B7280";
const LINE = "D1D5DB";
const PANEL = "F3F4F6";

type Align = "left" | "center" | "right";

export type SlideShape =
  | { kind: "text"; x: number; y: number; w: number; h: number; text: string; pt: number; bold?: boolean; color: string; align: Align; bullets?: readonly string[] }
  | { kind: "button"; x: number; y: number; w: number; h: number; text: string; pt: number; fill: string }
  | { kind: "box"; x: number; y: number; w: number; h: number; text: string; pt: number; fill: string; color: string }
  | { kind: "line"; x: number; y: number; w: number }
  | { kind: "table"; x: number; y: number; w: number; h: number; rows: readonly (readonly string[])[]; pt: number }
  | { kind: "chart"; x: number; y: number; w: number; h: number; chart: "bar" | "line"; title: string | null; labels: readonly string[]; values: readonly number[] };

interface Ctx { readonly k: number; readonly align: Align; readonly primary: string }
interface Laid { readonly h: number; readonly shapes: SlideShape[] }

/** 估一段字在 `pt` 号字下的宽（英寸）：中日韩字一字宽，其余半字宽。 */
function textWidth(s: string, pt: number): number {
  let em = 0;
  for (const ch of s) em += /[\u2E80-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.55;
  return (em * pt) / 72;
}
const lineH = (pt: number) => (pt * 1.35) / 72;
function linesOf(s: string, pt: number, w: number): number {
  return s.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(textWidth(para, pt) / Math.max(0.1, w))), 0);
}

function text(s: string, pt0: number, x: number, y: number, w: number, c: Ctx, o: { bold?: boolean; color?: string; align?: Align } = {}): Laid {
  const pt = pt0 * c.k;
  const h = linesOf(s, pt, w) * lineH(pt) + 0.06 * c.k;
  return { h, shapes: [{ kind: "text", x, y, w, h, text: s, pt, bold: o.bold, color: o.color ?? INK, align: o.align ?? c.align }] };
}

/** 竖着一个接一个排；`gap` 是 k=1 时的英寸。 */
function column(parts: readonly ((y: number) => Laid)[], y0: number, gap: number, c: Ctx): Laid {
  const shapes: SlideShape[] = [];
  let y = y0;
  parts.forEach((part, i) => {
    const laid = part(y);
    shapes.push(...laid.shapes);
    y += laid.h + (i < parts.length - 1 ? gap * c.k : 0);
  });
  return { h: y - y0, shapes };
}

/** 横着平分宽度排；高度取最高的那一个。 */
function row(nodes: readonly Node[], x: number, y: number, w: number, cols: number, c: Ctx): Laid {
  const gap = 0.2 * c.k;
  const cw = (w - gap * (cols - 1)) / cols;
  const shapes: SlideShape[] = [];
  let y1 = y;
  for (let r = 0; r < nodes.length; r += cols) {
    let rh = 0;
    nodes.slice(r, r + cols).forEach((n, i) => {
      const laid = lay(n, x + i * (cw + gap), y1, cw, c);
      shapes.push(...laid.shapes);
      rh = Math.max(rh, laid.h);
    });
    y1 += rh + (r + cols < nodes.length ? gap : 0);
  }
  return { h: y1 - y, shapes };
}

const TEXT_PT: Record<string, number> = { title: 30, subtitle: 20, body: 16, caption: 12, label: 12 };
const SPACER: Record<string, number> = { xs: 0.08, sm: 0.15, md: 0.3, lg: 0.5, xl: 0.7 };
const IMAGE_RATIO: Record<string, number> = { square: 1, video: 9 / 16, wide: 9 / 21, portrait: 4 / 3 };

function lay(n: Node, x: number, y: number, w: number, c: Ctx): Laid {
  const k = c.k;
  switch (n.type) {
    case "stack":
      return n.props?.direction === "row"
        ? row(n.children, x, y, w, Math.max(1, n.children.length), c)
        : column(n.children.map((ch) => (yy: number) => lay(ch, x, yy, w, c)), y, 0.15, c);
    case "grid":
      return row(n.children, x, y, w, n.props?.columns ?? 2, c);
    case "section": {
      const inner = { ...c, align: n.props?.align === "center" ? ("center" as const) : c.align };
      return column(n.children.map((ch) => (yy: number) => lay(ch, x, yy, w, inner)), y, 0.15, c);
    }
    case "card":
    case "overlay": {
      const title = n.props?.title;
      return column([
        ...(title !== undefined ? [(yy: number) => text(title, 18, x, yy, w, c, { bold: true })] : []),
        ...n.children.map((ch) => (yy: number) => lay(ch, x, yy, w, c)),
      ], y, 0.12, c);
    }
    case "text": {
      const p = n.props;
      const align = p.align === "center" ? "center" : p.align === "end" ? "right" : p.align === "start" ? "left" : c.align;
      return text(p.content, TEXT_PT[p.variant ?? "body"] ?? 16, x, y, w, c, { bold: p.variant === "title" || p.variant === "subtitle", color: p.muted === true ? MUTED : INK, align });
    }
    case "navbar":
      return text(n.props.title, 18, x, y, w, c, { bold: true });
    case "hero":
      return column([
        (yy) => text(n.props.title, 36, x, yy, w, c, { bold: true }),
        ...(n.props.subtitle !== undefined ? [(yy: number) => text(n.props.subtitle!, 18, x, yy, w, c, { color: MUTED })] : []),
        ...(n.props.cta !== undefined ? [(yy: number) => button(n.props.cta!, x, yy, w, c)] : []),
      ], y, 0.15, c);
    case "button":
      return button(n.props.label, x, y, w, c);
    case "badge":
    case "chip":
      return text(n.props.label, 12, x, y, w, c, { bold: true, color: c.primary });
    case "avatar":
      return text(n.props.name, 14, x, y, w, c, { bold: true });
    case "input":
    case "select": {
      const p = n.props;
      const shown = n.type === "input" ? (n.props.value ?? n.props.placeholder ?? "") : (n.props.value ?? n.props.placeholder ?? n.props.options[0] ?? "");
      return column([
        ...(p.label !== undefined ? [(yy: number) => text(p.label!, 12, x, yy, w, c, { color: MUTED })] : []),
        (yy) => box(shown, x, yy, w, 0.4 * k, 14 * k, n.type === "input" && n.props.value === undefined ? MUTED : INK),
      ], y, 0.05, c);
    }
    case "switch":
      return text(`${n.props.on === true ? "●" : "○"} ${n.props.label}`, 14, x, y, w, c);
    case "checkbox":
      return text(`${n.props.checked === true ? "☑" : "☐"} ${n.props.label}`, 14, x, y, w, c);
    case "radio":
      return column([
        ...(n.props.label !== undefined ? [(yy: number) => text(n.props.label!, 12, x, yy, w, c, { color: MUTED })] : []),
        (yy) => text(n.props.options.map((o, i) => `${i === (n.props.selected ?? -1) ? "◉" : "○"} ${o}`).join("    "), 14, x, yy, w, c),
      ], y, 0.05, c);
    case "tabs":
      return text(n.props.items.join("    "), 14, x, y, w, c, { bold: true });
    case "bottomnav":
      return text(n.props.items.join("    "), 12, x, y, w, c, { color: MUTED, align: "center" });
    case "progress":
      return text(`${n.props.label !== undefined ? `${n.props.label} ` : ""}${Math.round(n.props.value)}%`, 14, x, y, w, c);
    case "stat":
      return column([
        (yy) => text(n.props.label, 12, x, yy, w, c, { color: MUTED }),
        (yy) => text(n.props.value, 28, x, yy, w, c, { bold: true }),
        ...(n.props.delta !== undefined ? [(yy: number) => text(n.props.delta!, 12, x, yy, w, c, { color: n.props.tone === "danger" ? "DC2626" : n.props.tone === "success" ? "16A34A" : MUTED })] : []),
      ], y, 0.02, c);
    case "list": {
      const p = n.props;
      const items = p.items.map((it, i) => [it, p.detail?.[i]?.trim(), p.trailing?.[i]?.trim()].filter((s) => s !== undefined && s !== "").join("  ·  "));
      const pt = 14 * k;
      const h = items.reduce((s, it) => s + linesOf(it, pt, w - 0.3) * lineH(pt), 0) + 0.1 * k;
      return { h, shapes: [{ kind: "text", x, y, w, h, text: items.join("\n"), pt, color: INK, align: "left", bullets: items }] };
    }
    case "table": {
      const pt = 11 * k;
      const rows = [n.props.columns, ...n.props.rows];
      const h = rows.length * 0.3 * k;
      return { h, shapes: [{ kind: "table", x, y, w, h, rows, pt }] };
    }
    case "chart": {
      const h = 2.4 * k;
      const len = Math.min(n.props.labels.length, n.props.values.length);
      return { h, shapes: [{ kind: "chart", x, y, w, h, chart: n.props.kind ?? "bar", title: n.props.title ?? null, labels: n.props.labels.slice(0, len), values: n.props.values.slice(0, len) }] };
    }
    case "image": {
      const h = Math.min(w * (IMAGE_RATIO[n.props.ratio ?? "video"] ?? 9 / 16), 2.4 * k);
      return { h, shapes: [{ kind: "box", x, y, w, h, text: n.props.alt, pt: 12 * k, fill: PANEL, color: MUTED }] };
    }
    case "footer":
      return column([
        (yy) => text(n.props.brand, 14, x, yy, w, c, { bold: true }),
        ...((n.props.links ?? []).length > 0 ? [(yy: number) => text(n.props.links!.join("  ·  "), 11, x, yy, w, c, { color: MUTED })] : []),
        ...(n.props.note !== undefined ? [(yy: number) => text(n.props.note!, 10, x, yy, w, c, { color: MUTED })] : []),
      ], y, 0.04, c);
    case "divider":
      return { h: 0.12 * k, shapes: [{ kind: "line", x, y: y + 0.06 * k, w }] };
    case "spacer":
      return { h: (SPACER[n.props?.size ?? "md"] ?? 0.3) * k, shapes: [] };
  }
}

function button(label: string, x: number, y: number, w: number, c: Ctx): Laid {
  const pt = 14 * c.k;
  const bw = Math.min(w, textWidth(label, pt) + 0.6 * c.k);
  const bx = c.align === "center" ? x + (w - bw) / 2 : c.align === "right" ? x + w - bw : x;
  const h = 0.45 * c.k;
  return { h, shapes: [{ kind: "button", x: bx, y, w: bw, h, text: label, pt, fill: c.primary }] };
}

function box(label: string, x: number, y: number, w: number, h: number, pt: number, color: string): Laid {
  return { h, shapes: [{ kind: "box", x, y, w, h, text: label, pt, fill: PANEL, color }] };
}

/** 根容器是 `align: center` 的竖排 ⇒ 整页居中（封面页的常见写法）。 */
function rootAlign(root: Node): Align {
  return root.type === "stack" && root.props?.align === "center" ? "center" : root.type === "section" && root.props?.align === "center" ? "center" : "left";
}

/**
 * 一页原型 → 摆好位置的形状。排不下就等比缩（字号、间距、固定高度一起），整页竖向居中。
 * 这一页没画出来（`null`）⇒ 一行字如实说，页数不因此变少。
 */
export function layoutSlide(root: Node | null, frameName: string, primary: string): SlideShape[] {
  const w = SLIDE_W - MARGIN_X * 2;
  const avail = SLIDE_H - MARGIN_Y * 2;
  if (root === null) return text(`「${frameName}」这一页还没画出来`, 18, MARGIN_X, SLIDE_H / 2 - 0.3, w, { k: 1, align: "center", primary }, { color: MUTED }).shapes;
  const align = rootAlign(root);
  const first = lay(root, MARGIN_X, 0, w, { k: 1, align, primary });
  const k = first.h > avail ? avail / first.h : 1;
  const laid = k === 1 ? first : lay(root, MARGIN_X, 0, w, { k, align, primary });
  const top = MARGIN_Y + Math.max(0, (avail - laid.h) / 2);
  return laid.shapes.map((s) => ({ ...s, y: s.y + top }));
}

/** pptx 的十六进制色（不带 #）。品牌色给了就用它，否则用正文色——不在这里另抄一张强调色表。 */
function primaryOf(project: Pick<DesignProject, "tokens">): string {
  const brand = project.tokens?.brand ?? null;
  return brand !== null && /^#[0-9a-fA-F]{6}$/.test(brand) ? brand.slice(1).toUpperCase() : INK;
}

const FONT_FACE: Record<string, string | undefined> = { sans: undefined, serif: "Georgia", mono: "Courier New" };

/** 写成 .pptx（`ArrayBuffer`）。浏览器与 node 都能跑——导出时交给下载，测试里直接拆开看。 */
export async function buildPrototypePptx(project: DesignProject): Promise<ArrayBuffer> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = project.name;
  const primary = primaryOf(project);
  const fontFace = FONT_FACE[project.tokens?.font ?? "sans"];
  project.frames.forEach((name, i) => {
    const slide = pptx.addSlide();
    const note = project.frameNotes?.[i]?.trim();
    if (note !== undefined && note !== "") slide.addNotes(note);
    for (const s of layoutSlide(project.prototype[i] ?? null, name, primary)) {
      const base = { x: s.x, y: s.y, w: s.w, fontFace };
      switch (s.kind) {
        case "text":
          if (s.bullets !== undefined) {
            slide.addText(s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })), { ...base, h: s.h, fontSize: s.pt, color: s.color, valign: "top", margin: 0 });
          } else {
            slide.addText(s.text, { ...base, h: s.h, fontSize: s.pt, bold: s.bold === true, color: s.color, align: s.align, valign: "top", margin: 0 });
          }
          break;
        case "button":
          slide.addText(s.text, { ...base, h: s.h, fontSize: s.pt, bold: true, color: "FFFFFF", align: "center", valign: "middle", shape: pptx.ShapeType.roundRect, rectRadius: 0.08, fill: { color: s.fill } });
          break;
        case "box":
          slide.addText(s.text, { ...base, h: s.h, fontSize: s.pt, color: s.color, align: "center", valign: "middle", shape: pptx.ShapeType.rect, fill: { color: s.fill }, line: { color: LINE, width: 0.75 } });
          break;
        case "line":
          slide.addShape(pptx.ShapeType.line, { x: s.x, y: s.y, w: s.w, h: 0, line: { color: LINE, width: 0.75 } });
          break;
        case "table":
          slide.addTable(s.rows.map((r, ri) => r.map((cell) => ({ text: cell, options: { bold: ri === 0, fill: ri === 0 ? { color: PANEL } : undefined } }))), {
            ...base, fontSize: s.pt, color: INK, border: { type: "solid", pt: 0.5, color: LINE }, rowH: s.h / s.rows.length,
          });
          break;
        case "chart":
          slide.addChart(s.chart === "line" ? pptx.ChartType.line : pptx.ChartType.bar, [{ name: s.title ?? "数据", labels: [...s.labels], values: [...s.values] }], {
            ...base, h: s.h, chartColors: [primary], showTitle: s.title !== null, title: s.title ?? undefined, titleFontSize: 12, showLegend: false,
          });
          break;
      }
    }
  });
  return (await pptx.write({ outputType: "arraybuffer" })) as ArrayBuffer;
}

/** 文件名：与其它导出同一套规则（中文项目名转拼音、本地日期），后缀 .pptx。 */
export function prototypePptxFileName(name: string, now: Date = new Date(), romanize?: Romanize | null): string {
  return `${exportFileStem(name, "design", romanize)}-slides-${localDateStamp(now)}.pptx`;
}
