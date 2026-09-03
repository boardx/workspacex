import { describe, it, expect } from 'vitest';
import {
  parsePersonaText,
  personaToModel,
  serializePersona,
  PERSONA_SECTIONS,
} from '../src/diagrams/persona';
import { extractMermaidBlocks } from '../src/markdown';

const SAMPLE = `姓名: 陈志强
职位: 生产计划员
收入水平: 8000-12000元/月

## 用户描述
他每天清晨七点半到岗参加生产晨会，
随后核对物料和产能数据

## 目标和需求
- 确保订单准时交付率稳定在95%以上
- 减少因插单导致的计划重排次数

## 痛点和挑战
- 插单频繁导致计划反复推翻重做`;

describe('parsePersonaText', () => {
  it('parses header fields and sections', () => {
    const { fields, sections } = parsePersonaText(SAMPLE);
    expect(fields.get('姓名')).toBe('陈志强');
    expect(fields.get('收入水平')).toBe('8000-12000元/月');
    expect(sections.get('目标和需求')).toEqual([
      '确保订单准时交付率稳定在95%以上',
      '减少因插单导致的计划重排次数',
    ]);
  });

  it('merges bare consecutive lines into one paragraph sticky', () => {
    const { sections } = parsePersonaText(SAMPLE);
    expect(sections.get('用户描述')).toHaveLength(1);
    expect(sections.get('用户描述')![0]).toContain('生产晨会');
  });
});

describe('personaToModel', () => {
  it('builds the template: six boxes + fields + stickies', () => {
    const model = personaToModel(SAMPLE);
    expect(model.kind).toBe('template');
    expect(model.meta?.templateKey).toBe('persona');
    const boxes = model.nodes.filter((n) => n.data?.role === 'section');
    expect(boxes.map((b) => b.data?.name)).toEqual([...PERSONA_SECTIONS]);
    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    expect(stickies).toHaveLength(4);
    // Stickies start inside their section box.
    const goals = boxes.find((b) => b.data?.name === '目标和需求')!;
    const goalStickies = stickies.filter(
      (s) => Math.abs(s.x - goals.x) <= goals.width / 2 && Math.abs(s.y - goals.y) <= goals.height / 2,
    );
    expect(goalStickies).toHaveLength(2);
    // Field value nodes carry their key; empty ones show a placeholder.
    const fields = model.nodes.filter((n) => n.data?.role === 'field');
    expect(fields.find((f) => f.data?.key === '姓名')?.label).toBe('陈志强');
    expect(fields.find((f) => f.data?.key === '性别')?.label).toBe('——');
  });

  it('adds one locked sectionBar per section box', () => {
    const model = personaToModel(SAMPLE);
    const boxes = model.nodes.filter((n) => n.data?.role === 'section');
    const bars = model.nodes.filter((n) => n.data?.role === 'sectionBar');
    expect(bars).toHaveLength(boxes.length);
    for (const bar of bars) {
      expect(bar.data?.locked).toBe(true);
      expect(bar.data?.stroke).toBe('transparent');
    }
    // Printed templates are black/white/gray: bars are a uniform light gray.
    expect(new Set(bars.map((b) => b.data?.color))).toEqual(new Set(['#e2e8f0']));
  });

  it('keeps stickies a uniform yellow (no per-section color rotation)', () => {
    const model = personaToModel(SAMPLE);
    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    expect(stickies.length).toBeGreaterThan(0);
    // No color override → the fabric layer's default sticky yellow applies.
    for (const s of stickies) expect(s.data?.color).toBeUndefined();
  });

  it('grays out empty-field placeholders and highlights the name', () => {
    const model = personaToModel(SAMPLE);
    const fields = model.nodes.filter((n) => n.data?.role === 'field');
    const empty = fields.find((f) => f.label === '——')!;
    const filled = fields.find((f) => f.data?.key === '姓名')!;
    expect(empty.data?.color).not.toBe(filled.data?.color);
    const title = model.nodes.find((n) => n.data?.role === 'title')!;
    expect(title.data?.fontSize).toBe(20);
  });
});

describe('serializePersona', () => {
  it('round-trips fields and section bullets', () => {
    const text = serializePersona(personaToModel(SAMPLE));
    expect(text).toContain('姓名: 陈志强');
    expect(text).toContain('## 目标和需求');
    expect(text).toContain('- 确保订单准时交付率稳定在95%以上');
    expect(text).toContain('## 痛点和挑战');
    // Placeholder fields are omitted.
    expect(text).not.toContain('性别:');
  });

  it('reassigns a sticky dragged into another box', () => {
    const model = personaToModel(SAMPLE);
    const boxes = model.nodes.filter((n) => n.data?.role === 'section');
    const motivation = boxes.find((b) => b.data?.name === '动机')!;
    const sticky = model.nodes.find(
      (n) => n.data?.role === 'sticky' && n.label.includes('插单频繁'),
    )!;
    sticky.x = motivation.x;
    sticky.y = motivation.y;
    const text = serializePersona(model);
    expect(text).toContain('## 动机\n- 插单频繁导致计划反复推翻重做');
    expect(text).not.toContain('## 痛点和挑战');
  });

  it('assigns stickies outside all boxes to the nearest one', () => {
    const model = personaToModel(SAMPLE);
    const sticky = model.nodes.find((n) => n.data?.role === 'sticky')!;
    sticky.x = -500;
    sticky.y = -500;
    const text = serializePersona(model);
    expect(text).toContain(sticky.label.slice(0, 8));
  });
});

describe('section-name matching tolerance (issue #2549)', () => {
  it('still renders a section whose heading uses a near-synonym connector', () => {
    // 模型把「痛点和挑战」写成「痛点与挑战」——此前 sections.get(sec.name) 精确匹配 miss，
    // 该分区静默渲染成空。
    const sample = `姓名: 王建国

## 痛点与挑战
- 让企业突破增长瓶颈`;
    const model = personaToModel(sample);
    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    expect(stickies.map((s) => s.label)).toContain('让企业突破增长瓶颈');
  });

  it('still renders a section whose heading has stray whitespace/punctuation', () => {
    const sample = `姓名: 王建国

##   痛点和挑战：
- 让企业突破增长瓶颈`;
    const model = personaToModel(sample);
    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    expect(stickies.map((s) => s.label)).toContain('让企业突破增长瓶颈');
  });

  it('keeps an exact-name section separate from an unrelated one (no over-matching)', () => {
    const sample = `姓名: 王建国

## 动机
- 为两个儿子留下一个可持续的企业

## 痛点和挑战
- 让企业突破增长瓶颈`;
    const model = personaToModel(sample);
    const boxes = model.nodes.filter((n) => n.data?.role === 'section');
    const motivation = boxes.find((b) => b.data?.name === '动机')!;
    const pains = boxes.find((b) => b.data?.name === '痛点和挑战')!;
    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    const inBox = (box: (typeof boxes)[number]) =>
      stickies.filter(
        (s) => Math.abs(s.x - box.x) <= box.width / 2 && Math.abs(s.y - box.y) <= box.height / 2,
      );
    expect(inBox(motivation).map((s) => s.label)).toEqual(['为两个儿子留下一个可持续的企业']);
    expect(inBox(pains).map((s) => s.label)).toEqual(['让企业突破增长瓶颈']);
  });
});

describe('header field label alignment (issue #2550)', () => {
  it('right-aligns field labels so the label→value gap stays tight and constant', () => {
    const model = personaToModel(SAMPLE);
    const labels = model.nodes.filter((n) => n.data?.role === 'fieldLabel');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label.data?.align).toBe('right');
  });
});

describe('markdown persona fences', () => {
  it('extracts persona blocks alongside mermaid ones', () => {
    const md = '# doc\n\n```persona\n姓名: 张三\n```\n\n```mermaid\nflowchart TD\n  A --> B\n```\n';
    const blocks = extractMermaidBlocks(md);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.lang).toBe('persona');
    expect(blocks[1]!.lang).toBe('mermaid');
  });
});
