/**
 * Declarative workshop-canvas template engine.
 *
 * A template (PESTEL, SWOT, BMC, ...) is pure layout DATA — a TemplateSpec.
 * The engine provides the shared behavior for every template:
 *  - text syntax:   `字段: 值` lines, `## 段落名` headings, `- 便利贴` bullets
 *  - canvas:        locked frame (title / header fields / section boxes /
 *                    decorations) + draggable fixed-size sticky notes
 *  - serialization: sticky → section assignment is GEOMETRIC (the box that
 *                    contains the sticky's center wins; nearest box otherwise)
 *
 * Markdown fences: ```canvas with a leading `模板: <key>` line selects the
 * spec; ```persona remains an alias for the persona template.
 */
import { registerDiagram } from './registry';
import type { DiagramModel, DiagramNode } from '../model';
import { LINE, PAPER, STICKY_FILL } from '../theme';

/**
 * Named sticky-note colors selectable from the canvas color menu. 'yellow'
 * is the default (matches STICKY_FILL) and is never written to the text —
 * only a non-default pick gets a trailing `#name` tag, so untouched canvases
 * keep serializing exactly as before (no round-trip fixture churn).
 */
export const STICKY_COLORS: Record<string, string> = {
  yellow: STICKY_FILL,
  blue: '#bfdbfe',
  green: '#bbf7d0',
  pink: '#fbcfe8',
  purple: '#e9d5ff',
  gray: '#e2e8f0',
};

const STICKY_COLOR_BY_HEX = new Map(Object.entries(STICKY_COLORS).map(([name, hex]) => [hex, name]));

/** Strip a trailing ` #colorname` tag from sticky text, if present. */
function extractStickyColor(text: string): { text: string; color?: string } {
  const m = /^(.*?)\s+#(\w+)$/.exec(text);
  if (m && STICKY_COLORS[m[2]!]) {
    return { text: m[1]!.trim(), color: STICKY_COLORS[m[2]!] };
  }
  return { text };
}

export interface TemplateSection {
  /** Heading used in text (`## name`) and as the box title. */
  name: string;
  /** Box center + size in canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Box fill override (e.g. a shaded header row); defaults to white. */
  fill?: string;
  /**
   * Per-section sticky-grid override — issue #2372 (workspacex). A caller
   * that already knows a per-section note density/columns choice (e.g. an
   * explicit drag-based layout editor) sets whichever of `w`/`h`/`perRow` it
   * has an opinion about; unset fields fall back to `TemplateSpec.sticky`
   * (or the built-in default) exactly as before this field existed —
   * templates that never set it are byte-identical to pre-#2372 output.
   */
  sticky?: Partial<{ w: number; h: number; perRow: number }>;
  /**
   * Per-section default sticky fill (any CSS color, not restricted to
   * `STICKY_COLORS`) — issue #2372. A note's own trailing `#name` text tag
   * still wins per-note (that mechanism is unchanged); this only supplies
   * the fallback when a note has no tag, so a whole section can default to
   * a caller-chosen color without hand-tagging every bullet.
   */
  stickyColor?: string;
}

export interface TemplateSpec {
  /** Identifier used in `模板: <key>` lines. */
  key: string;
  /** Canvas title, e.g. "SWOT 分析 SWOT Analysis". */
  title: string;
  /**
   * Footer / attribution line drawn under the lowest section box (workspacex
   * issue #2527: the template editor lets a human type a "页脚署名", the
   * editor preview paints it, but the spec had no slot for it so the real
   * canvas never showed it). Empty / unset = no footer node, byte-identical
   * to pre-#2527 output.
   */
  footer?: string;
  /** Header fields (rendered inside headerRect when present). */
  fields?: string[];
  /** Header band (center + size); required when fields are present. */
  headerRect?: { x: number; y: number; w: number; h: number };
  /** How many field pairs per header row. */
  fieldsPerRow?: number;
  sections: TemplateSection[];
  /**
   * Palette indices for the per-section title bars (PALETTE_SOFT).
   * Defaults to the section order (0, 1, 2, ...) when omitted.
   */
  sectionColors?: number[];
  /** Extra locked nodes (circles, guide lines, imagery) drawn behind boxes. */
  decorations?: DiagramNode[];
  /** Sticky grid inside each box (defaults below). */
  sticky?: { w: number; h: number; perRow: number };
  /**
   * Show an editable name right after the title, seeded from this field
   * (persona uses 标题 with 职位 fallback).
   */
  titleNameFields?: string[];
  /**
   * Draw the gray title bar + name inside each section box (default true).
   * Row/lane layouts (e.g. journey map) disable this and label rows via
   * decorations instead.
   */
  titleBars?: boolean;
  /**
   * Page number of this template in the printed A0 workshop PDF. When a
   * background provider is registered (see setTemplateBackgroundProvider),
   * the rendered PDF page becomes the canvas background — pixel-identical to
   * the attachment — and the engine skips drawing its own frame; sections
   * stay as invisible hit-areas for sticky assignment.
   */
  pdfPage?: number;
}

/** Supplies a pre-rendered background bitmap for a template (demo wires pdf.js here). */
export type TemplateBackgroundProvider = (
  spec: TemplateSpec,
) => { src: string; width: number; height: number } | undefined;

let backgroundProvider: TemplateBackgroundProvider | undefined;

export function setTemplateBackgroundProvider(p?: TemplateBackgroundProvider): void {
  backgroundProvider = p;
}

const DEFAULT_STICKY = { w: 136, h: 92, perRow: 3 };
const STICKY_GAP = { x: 12, y: 14 };
const EMPTY_FIELD = '——';
const INK = '#1f2937';
const INK_SOFT = '#4b5563';
/** Footer line geometry (issue #2527): width / height / gap below the lowest box. */
const FOOTER_W = 900;
const FOOTER_H = 20;
const FOOTER_GAP = 16;

const templates = new Map<string, TemplateSpec>();

export function registerTemplate(spec: TemplateSpec): void {
  templates.set(spec.key, spec);
}

export function getTemplate(key: string): TemplateSpec | undefined {
  return templates.get(key);
}

export function listTemplates(): TemplateSpec[] {
  return [...templates.values()];
}

// ---------------------------------------------------------------------------
// Text parsing (shared with the original persona syntax)
// ---------------------------------------------------------------------------

export interface ParsedTemplateText {
  templateKey?: string;
  fields: Map<string, string>;
  sections: Map<string, string[]>;
}

export function parseTemplateText(code: string): ParsedTemplateText {
  const fields = new Map<string, string>();
  const sections = new Map<string, string[]>();
  let templateKey: string | undefined;
  let current: string | null = null;
  let paragraph: string[] = [];
  // 表头字段行（`字段名: 值`）按格式约定只出现在第一个 `## 分区` 之前——但模型偶尔会
  // 提前手滑写出一个空标题（例如把某个字段本身也格式化成 `## 姓名`）。一旦把"见过标题"
  // 当成一次性开关，这个手滑会让后面本该进 `fields` 的每一行都被当成当前分区的段落文字
  // 吞掉、静默丢失（真实症状：表头一片空白，且没有任何报错）。用"是否已经出现过真正的
  // 分区内容（bullet）"代替"是否见过标题"来做这个开关：模型只要还没真正开始写要点，
  // 提前出现的空标题就不会锁死字段解析——一旦见过第一条要点，才认定表头部分已经结束，
  // 之后的 `key: value` 行按原样归入当前分区（不破坏既有的分区内容解析）。
  let sawBullet = false;

  const flush = (): void => {
    if (current && paragraph.length > 0) sections.get(current)!.push(paragraph.join(' '));
    paragraph = [];
  };

  for (const raw of code.split('\n')) {
    const line = raw.trim();
    const heading = /^##\s*(.+)$/.exec(line);
    if (heading) {
      flush();
      current = heading[1]!.trim();
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    if (!sawBullet) {
      const kv = /^([^:：]+)[:：]\s*(.*)$/.exec(line);
      if (kv) {
        const key = kv[1]!.trim();
        if ((key === '模板' || key.toLowerCase() === 'template') && !templateKey) {
          templateKey = kv[2]!.trim();
        } else {
          fields.set(key, kv[2]!.trim());
        }
        continue;
      }
      if (current === null) continue;
    }
    if (current === null) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      flush();
      sawBullet = true;
      sections.get(current)!.push(bullet[1]!.trim());
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return { templateKey, fields, sections };
}

// ---------------------------------------------------------------------------
// Model building
// ---------------------------------------------------------------------------

/**
 * Build the canvas model for a template. `fenceKey` forces a spec (used by
 * the ```persona alias); otherwise the text's `模板:` line decides.
 */
export function templateToModel(code: string, fenceKey?: string): DiagramModel {
  const parsed = parseTemplateText(code);
  const key = fenceKey ?? parsed.templateKey ?? '';
  const spec = templates.get(key);
  if (!spec) {
    const known = [...templates.keys()].join(', ');
    throw new Error(`未知画布模板 "${key}"（可用: ${known}）`);
  }
  return buildTemplateModel(spec, parsed);
}

function buildTemplateModel(spec: TemplateSpec, parsed: ParsedTemplateText): DiagramModel {
  const { fields, sections } = parsed;
  const nodes: DiagramNode[] = [];
  const sticky = spec.sticky ?? DEFAULT_STICKY;

  // Background mode: the printed PDF page IS the canvas — pixel-identical to
  // the attachment. The engine then draws no frame of its own; sections stay
  // as invisible hit-areas so sticky assignment keeps working.
  const bg = spec.pdfPage != null ? backgroundProvider?.(spec) : undefined;
  if (bg) {
    nodes.push({
      id: 'tpl-bg',
      label: '',
      shape: 'image',
      x: 40 + bg.width / 2,
      y: 10 + bg.height / 2,
      width: bg.width,
      height: bg.height,
      data: { role: 'background', locked: true, src: bg.src },
    });
  }

  // Decorations render first (behind boxes and stickies); skipped in
  // background mode — the printed page already contains the art.
  if (!bg) {
    for (const d of spec.decorations ?? []) {
      nodes.push({ ...d, data: { locked: true, ...(d.data ?? {}) } });
    }
  }

  // Title (+ optional editable name seeded from titleNameFields). The
  // printed background already carries the title, so skip it in bg mode.
  if (!bg) nodes.push({
    id: 'tpl-title',
    label: spec.titleNameFields ? `${spec.title} —` : spec.title,
    shape: 'text',
    x: 60 + 190,
    y: 24,
    width: 380,
    height: 26,
    data: { role: 'title', locked: true, fontSize: 20, bold: true, color: INK, align: 'left' },
  });
  if (spec.titleNameFields) {
    let name = '';
    for (const f of spec.titleNameFields) {
      name = (fields.get(f) ?? '').trim();
      if (name) break;
    }
    nodes.push({
      id: 'tpl-name',
      label: name || EMPTY_FIELD,
      shape: 'text',
      x: 60 + 380 + 120,
      y: 24,
      width: 220,
      height: 26,
      data: { role: 'templateName', fontSize: 18, bold: true, color: name ? INK_SOFT : LINE, align: 'left' },
    });
  }

  // Header fields.
  if (spec.fields && spec.fields.length > 0 && spec.headerRect) {
    const hr = spec.headerRect;
    if (!bg) nodes.push({
      id: 'tpl-header',
      label: '',
      shape: 'rect',
      x: hr.x,
      y: hr.y,
      width: hr.w,
      height: hr.h,
      data: { role: 'headerBox', locked: true, color: '#ffffff', stroke: INK },
    });
    const perRow = spec.fieldsPerRow ?? Math.min(5, spec.fields.length);
    const rows = Math.ceil(spec.fields.length / perRow);
    const cellW = hr.w / perRow;
    const rowPitch = hr.h / (rows + 1);
    // Every header cell is `cellW` wide; the label box and the value box
    // must both fit INSIDE it. The classic proportions (label 96 + gap 6 +
    // value 150, 24px left inset) are kept whenever the cell is wide enough
    // (the hand-tuned built-in specs: persona 1440/5 = 288 → value 150
    // exactly as before). Narrower cells (org templates whose header wraps
    // into 6 fields per row, ~253px each) shrink the VALUE box so it ends
    // before the next cell's label starts instead of running underneath it —
    // the "姓名 value drawn over the 性别 label" symptom.
    const CELL_INSET_L = 24;
    const CELL_INSET_R = 12;
    const LABEL_GAP = 6;
    const LABEL_W = Math.min(96, Math.max(48, Math.floor(cellW * 0.4)));
    const VALUE_W = Math.max(40, Math.min(150, cellW - CELL_INSET_L - LABEL_W - LABEL_GAP - CELL_INSET_R));
    // A value wraps per grapheme (CJK has no spaces to break on) into its
    // box; the renderer then shrinks the font until the wrapped lines fit
    // the row pitch, so a long value can never spill over the row below.
    const VALUE_FIT_H = Math.max(16, rowPitch - 6);
    spec.fields.forEach((key, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const cellLeft = hr.x - hr.w / 2 + CELL_INSET_L + col * cellW;
      const cy = hr.y - hr.h / 2 + rowPitch * (row + 1);
      if (!bg) nodes.push({
        id: `tpl-flabel-${i}`,
        label: `${key}:`,
        shape: 'text',
        x: cellLeft + LABEL_W / 2,
        y: cy,
        width: LABEL_W,
        height: 20,
        data: { role: 'fieldLabel', locked: true, fontSize: 13, bold: true, color: INK, align: 'left' },
      });
      const value = fields.get(key) || EMPTY_FIELD;
      nodes.push({
        id: `tpl-field-${i}`,
        label: value,
        shape: 'text',
        x: cellLeft + LABEL_W + LABEL_GAP + VALUE_W / 2,
        y: cy,
        width: VALUE_W,
        height: VALUE_FIT_H,
        data: {
          role: 'field',
          key,
          fontSize: 13,
          color: value === EMPTY_FIELD ? LINE : INK_SOFT,
          align: 'left',
          wrap: 'grapheme',
          fitHeight: VALUE_FIT_H,
        },
      });
    });
  }

  // Section boxes + stickies.
  const titleBars = spec.titleBars !== false;
  spec.sections.forEach((sec, i) => {
    // Paint order matters: box → title bar → title TEXT → stickies. The name
    // must be its own node ON TOP of the bar — as the box's built-in label it
    // would be covered by the separately-drawn bar rect.
    nodes.push({
      id: `tpl-section-${i}`,
      label: '',
      shape: 'rect',
      x: sec.x,
      y: sec.y,
      width: sec.w,
      height: sec.h,
      data: {
        role: 'section',
        name: sec.name,
        locked: true,
        // Background mode: invisible hit-area (the printed page draws the box).
        color: bg ? 'transparent' : (sec.fill ?? PAPER),
        stroke: bg ? 'transparent' : INK,
      },
    });
    if (titleBars && !bg) {
      // Section title bar: printed workshop templates are black/white/gray,
      // so the band is a uniform light gray regardless of spec.sectionColors
      // (kept in the interface for compatibility, deliberately unused).
      nodes.push({
        id: `tpl-secbar-${i}`,
        label: '',
        shape: 'rect',
        x: sec.x,
        y: sec.y - sec.h / 2 + 16,
        width: sec.w - 3,
        height: 30,
        data: {
          role: 'sectionBar',
          locked: true,
          color: '#e2e8f0',
          stroke: 'transparent',
        },
      });
      nodes.push({
        id: `tpl-seclabel-${i}`,
        label: sec.name,
        shape: 'text',
        x: sec.x,
        y: sec.y - sec.h / 2 + 16,
        width: sec.w - 24,
        height: 20,
        data: { role: 'sectionLabel', locked: true, fontSize: 14, bold: true, color: INK },
      });
    }
    const items = sections.get(sec.name) ?? [];
    // #2372: a section's own `sticky` (if set) overrides the spec-wide
    // default field-by-field — unset fields still fall back to `sticky`.
    const sectionSticky = { ...sticky, ...sec.sticky };
    const perRow = Math.max(1, Math.min(sectionSticky.perRow, Math.floor((sec.w - 28) / (sectionSticky.w + STICKY_GAP.x))));
    const stickyTop = sec.y - sec.h / 2 + (titleBars ? 44 : 14);
    items.forEach((rawText, j) => {
      const col = j % perRow;
      const row = Math.floor(j / perRow);
      // Default uniform yellow (the B/W/G look), or the section's own
      // `stickyColor` when set (#2372); a user can still override per-note
      // via the canvas color menu, encoded as a trailing `#name` text tag —
      // that per-note tag wins over both defaults.
      const { text, color } = extractStickyColor(rawText);
      nodes.push({
        id: `tpl-sticky-${i}-${j}`,
        label: text,
        shape: 'sticky',
        x: sec.x - sec.w / 2 + 14 + sectionSticky.w / 2 + col * (sectionSticky.w + STICKY_GAP.x),
        y: stickyTop + sectionSticky.h / 2 + row * (sectionSticky.h + STICKY_GAP.y),
        width: sectionSticky.w,
        height: sectionSticky.h,
        data: { role: 'sticky', ...((color ?? sec.stickyColor) ? { color: color ?? sec.stickyColor } : {}) },
      });
    });
  });

  // Footer / attribution line (issue #2527). Anchored under the lowest box
  // (or the header band when there are no sections) so it never overlaps
  // content whatever the layout; left edge lines up with the title (x=60).
  // Skipped in bg mode like the title: the printed page carries its own.
  const footer = (spec.footer ?? '').trim();
  if (footer && !bg) {
    const bottoms = spec.sections.map((s) => s.y + s.h / 2);
    if (spec.headerRect) bottoms.push(spec.headerRect.y + spec.headerRect.h / 2);
    const contentBottom = bottoms.length > 0 ? Math.max(...bottoms) : 60;
    nodes.push({
      id: 'tpl-footer',
      label: footer,
      shape: 'text',
      x: 60 + FOOTER_W / 2,
      y: contentBottom + FOOTER_GAP + FOOTER_H / 2,
      width: FOOTER_W,
      height: FOOTER_H,
      data: { role: 'footer', locked: true, fontSize: 12, color: INK_SOFT, align: 'left' },
    });
  }

  return {
    kind: 'template',
    direction: 'TB',
    nodes,
    edges: [],
    meta: { templateKey: spec.key, title: spec.title },
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export function serializeTemplate(model: DiagramModel): string {
  const key = String(model.meta?.templateKey ?? '');
  const spec = templates.get(key);
  const lines: string[] = [];
  // ```persona fences imply their template; ```canvas blocks carry the key.
  if (key && key !== 'persona') lines.push(`模板: ${key}`);

  const fieldNodes = model.nodes.filter((n) => n.data?.role === 'field');
  // Editable title name → dedicated field (skip when it still equals its
  // fallback source so untouched canvases round-trip cleanly).
  if (spec?.titleNameFields && spec.titleNameFields.length > 0) {
    const nameNode = model.nodes.find((n) => n.data?.role === 'templateName');
    const name = (nameNode?.label ?? '').trim();
    const fallbacks = spec.titleNameFields
      .slice(1)
      .map((f) => (fieldNodes.find((n) => n.data?.key === f)?.label ?? '').trim());
    if (name && name !== EMPTY_FIELD && !fallbacks.includes(name)) {
      lines.push(`${spec.titleNameFields[0]}: ${name}`);
    }
  }

  const fieldOrder = spec?.fields ?? fieldNodes.map((n) => String(n.data?.key ?? ''));
  for (const key2 of fieldOrder) {
    const node = fieldNodes.find((n) => n.data?.key === key2);
    const value = (node?.label ?? '').trim();
    if (value && value !== EMPTY_FIELD) lines.push(`${key2}: ${value}`);
  }

  const boxes = model.nodes.filter((n) => n.data?.role === 'section');
  const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
  const grouped = new Map<string, DiagramNode[]>();
  for (const b of boxes) grouped.set(String(b.data?.name ?? b.label), []);
  for (const s of stickies) {
    let target = boxes.find(
      (b) => Math.abs(s.x - b.x) <= b.width / 2 && Math.abs(s.y - b.y) <= b.height / 2,
    );
    if (!target) {
      let best = Infinity;
      for (const b of boxes) {
        const d = (s.x - b.x) ** 2 + (s.y - b.y) ** 2;
        if (d < best) {
          best = d;
          target = b;
        }
      }
    }
    if (target) grouped.get(String(target.data?.name ?? target.label))!.push(s);
  }

  const order = spec ? spec.sections.map((s) => s.name) : [...grouped.keys()];
  for (const b of boxes) {
    const name = String(b.data?.name ?? b.label);
    if (!order.includes(name)) order.push(name);
  }
  for (const name of order) {
    const items = grouped.get(name);
    if (!items || items.length === 0) continue;
    items.sort((a, b) => (Math.abs(a.y - b.y) > 24 ? a.y - b.y : a.x - b.x));
    lines.push('');
    lines.push(`## ${name}`);
    for (const s of items) {
      const text = s.label.replace(/\s*\n\s*/g, ' ').trim();
      const colorName = STICKY_COLOR_BY_HEX.get(String(s.data?.color ?? ''));
      const tag = colorName && colorName !== 'yellow' ? ` #${colorName}` : '';
      lines.push(`- ${text}${tag}`);
    }
  }
  return lines.join('\n').replace(/^\n/, '');
}

registerDiagram({
  kind: 'template',
  detects: [],
  parse: () => {
    throw new Error('canvas templates are parsed from text, not mermaid');
  },
  serialize: serializeTemplate,
});
