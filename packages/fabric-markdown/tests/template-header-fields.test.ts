/**
 * Header-field geometry of the template engine (workspacex 2026-09-02).
 *
 * Real screenshot: an org-edited persona wraps its 9 header fields into 6 per
 * row (~253px per cell). The engine used to reserve a fixed 96 + 6 + 150 px
 * per field regardless of the cell width, so every value box ended 23px past
 * its cell and was painted underneath the next field's label ("姓名" value
 * over the "性别" label), and the last cell ran off the header band's right
 * edge. Values also never wrapped (CJK has no spaces) and could not shrink.
 */
import { describe, expect, it } from 'vitest';
import { registerTemplate, templateToModel, getTemplate } from '../src/templates-entry';
import type { DiagramNode } from '../src/model';

const FIELDS = ['姓名', '性别', '年龄', '区域', '教育水平', '职位', '行业', '家庭情况', '收入水平'];

function fieldNodes(nodes: DiagramNode[]): { label: DiagramNode; value: DiagramNode }[] {
  const labels = nodes.filter((n) => n.data?.role === 'fieldLabel');
  const values = nodes.filter((n) => n.data?.role === 'field');
  return labels.map((label, i) => ({ label, value: values[i]! }));
}

describe('template engine — header fields stay inside their cell', () => {
  it('narrow cells (6 per row in a 1520px band): every value box ends before the next label and inside the band', () => {
    registerTemplate({
      key: 'hdr-narrow',
      title: '窄格表头',
      fields: FIELDS,
      headerRect: { x: 820, y: 144, w: 1520, h: 120 },
      fieldsPerRow: 6,
      sections: [{ name: '正文', x: 820, y: 500, w: 1520, h: 300 }],
    });
    const model = templateToModel('模板: hdr-narrow\n姓名: 华锐精密（无锡华锐精工科技有限公司，企业机构）\n## 正文\n- x');
    const pairs = fieldNodes(model.nodes);
    expect(pairs).toHaveLength(FIELDS.length);
    const bandLeft = 820 - 760;
    const bandRight = 820 + 760;
    const cellW = 1520 / 6;
    pairs.forEach(({ label, value }, i) => {
      const col = i % 6;
      const cellLeft = bandLeft + col * cellW;
      const cellRight = cellLeft + cellW;
      const labelLeft = label.x - label.width / 2;
      const valueRight = value.x + value.width / 2;
      // label starts inside its own cell, value ends inside its own cell.
      expect(labelLeft).toBeGreaterThanOrEqual(cellLeft);
      expect(valueRight).toBeLessThanOrEqual(cellRight + 1e-6);
      expect(valueRight).toBeLessThanOrEqual(bandRight + 1e-6);
      // label and value do not overlap each other.
      expect(value.x - value.width / 2).toBeGreaterThanOrEqual(label.x + label.width / 2);
      // the value box is still usable (not squeezed to nothing).
      expect(value.width).toBeGreaterThanOrEqual(40);
    });
    // Neighbouring cells on the same row never overlap: value(i) ends before label(i+1) starts.
    for (let i = 0; i + 1 < pairs.length; i += 1) {
      if (i % 6 === 5) continue;
      const valueRight = pairs[i]!.value.x + pairs[i]!.value.width / 2;
      const nextLabelLeft = pairs[i + 1]!.label.x - pairs[i + 1]!.label.width / 2;
      expect(valueRight).toBeLessThanOrEqual(nextLabelLeft + 1e-6);
    }
  });

  it('values wrap per grapheme and carry a fit height bounded by the row pitch', () => {
    const model = templateToModel('模板: hdr-narrow\n姓名: 甲\n## 正文\n- x');
    const rows = Math.ceil(FIELDS.length / 6);
    const rowPitch = 120 / (rows + 1);
    for (const { value } of fieldNodes(model.nodes)) {
      expect(value.data?.wrap).toBe('grapheme');
      expect(value.data?.fitHeight).toBeGreaterThan(0);
      expect(value.data?.fitHeight).toBeLessThan(rowPitch);
      expect(value.height).toBe(value.data?.fitHeight);
    }
    // Rows are spread evenly across the band: row centers at pitch, 2*pitch.
    const ys = [...new Set(fieldNodes(model.nodes).map((p) => p.value.y))].sort((a, b) => a - b);
    expect(ys).toHaveLength(rows);
    ys.forEach((y, r) => expect(y).toBeCloseTo(144 - 60 + rowPitch * (r + 1), 6));
  });

  it('built-in persona (288px cells) keeps the classic 96 + 6 + 150 proportions — byte-identical geometry', () => {
    const spec = getTemplate('persona')!;
    const model = templateToModel('姓名: 陈志强\n## 用户描述\n- a', 'persona');
    const hr = spec.headerRect!;
    const cellW = hr.w / spec.fieldsPerRow!;
    expect(cellW).toBe(288);
    const first = fieldNodes(model.nodes)[0]!;
    const cellLeft = hr.x - hr.w / 2 + 24;
    expect(first.label.width).toBe(96);
    expect(first.label.x).toBe(cellLeft + 48);
    expect(first.value.width).toBe(150);
    expect(first.value.x).toBe(cellLeft + 96 + 6 + 75);
  });
});
