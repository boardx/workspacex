import { describe, it, expect } from 'vitest';
import { templateToModel, serializeTemplate, getTemplate } from '../src/diagrams/template-engine';
import '../src/diagrams/templates-story';
import type { DiagramModel, DiagramNode } from '../src/model';

/** Stickies whose center falls inside the given section box. */
function stickiesInBox(model: DiagramModel, sectionName: string): DiagramNode[] {
  const box = model.nodes.find(
    (n) => n.data?.role === 'section' && n.data?.name === sectionName,
  );
  expect(box, `section box "${sectionName}" exists`).toBeDefined();
  return model.nodes.filter(
    (n) =>
      n.data?.role === 'sticky' &&
      Math.abs(n.x - box!.x) <= box!.width / 2 &&
      Math.abs(n.y - box!.y) <= box!.height / 2,
  );
}

interface TemplateCase {
  key: string;
  sectionCount: number;
  text: string;
  /** section name → expected sticky count (geometric containment). */
  stickies: Record<string, number>;
}

const CASES: TemplateCase[] = [
  {
    key: 'freytag',
    sectionCount: 8,
    text: `模板: freytag

## 开场
- 小镇青年在旧书店打工
- 一封匿名信寄到店里

## 高光点
- 主角当众揭开真相

## 故事主题
- 真相也许迟到但不会缺席
- 平凡人也有改写命运的勇气`,
    stickies: { 开场: 2, 高光点: 1, 故事主题: 2 },
  },
  {
    key: 'burger',
    sectionCount: 5,
    text: `模板: burger

## 开场引入
- 客服响应时长同比上升40%
- 满意度跌破年度目标线

## 核心洞察 WHY
- 服务体验是复购的第一驱动力

## 解决方案 WHAT
- 上线智能工单分流系统
- 组建7x24小时值班小组`,
    stickies: { 开场引入: 2, '核心洞察 WHY': 1, '解决方案 WHAT': 2 },
  },
  {
    key: 'golden-circle',
    sectionCount: 3,
    text: `模板: golden-circle

## WHY
- 让每个孩子平等获得优质教育

## HOW
- AI拆解名师课程为个性化路径
- 与县域学校共建双师课堂

## WHAT
- 一款自适应练习App`,
    stickies: { WHY: 1, HOW: 2, WHAT: 1 },
  },
  {
    key: 'three-lenses',
    sectionCount: 3,
    text: `模板: three-lenses

## 人本期望 Desirability
- 独居老人希望一键联系子女
- 子女想随时了解父母安全

## 技术可行 Feasibility
- 毫米波雷达可无感监测跌倒

## 商业可行 Viability
- 与社区养老服务按月订阅打包`,
    stickies: {
      '人本期望 Desirability': 2,
      '技术可行 Feasibility': 1,
      '商业可行 Viability': 1,
    },
  },
  {
    key: 'storyboard',
    sectionCount: 6,
    text: `模板: storyboard
故事主角: 快递员老周

## 1 开场
- 清晨五点老周开始装车
- 车厢塞满双十一的包裹

## 2 冲突
- 暴雨突至部分包裹被淋湿

## 4 高光点
- 独居老人为他撑伞送来姜茶`,
    stickies: { '1 开场': 2, '2 冲突': 1, '4 高光点': 1 },
  },
];

describe.each(CASES)('template $key', ({ key, sectionCount, text, stickies }) => {
  it('builds the model with the right sections and sticky placement', () => {
    const model = templateToModel(text);
    expect(model.kind).toBe('template');
    expect(model.meta?.templateKey).toBe(key);

    const boxes = model.nodes.filter((n) => n.data?.role === 'section');
    expect(boxes).toHaveLength(sectionCount);

    const totalExpected = Object.values(stickies).reduce((a, b) => a + b, 0);
    expect(model.nodes.filter((n) => n.data?.role === 'sticky')).toHaveLength(totalExpected);
    for (const [name, count] of Object.entries(stickies)) {
      expect(stickiesInBox(model, name), `stickies inside "${name}"`).toHaveLength(count);
    }
  });

  it('round-trips through serializeTemplate', () => {
    const out = serializeTemplate(templateToModel(text));
    expect(out.startsWith(`模板: ${key}`)).toBe(true);
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith('##') || t.startsWith('-')) expect(out).toContain(t);
    }
    // Serialization is stable: a second round yields identical text.
    expect(serializeTemplate(templateToModel(out))).toBe(out);
  });
});

describe('three-lenses bilingual section-name drift (issue #2576)', () => {
  it('still fills sections when the model drops the English suffix', () => {
    const text = `模板: three-lenses

## 人本期望
- 独居老人希望一键联系子女

## 技术可行
- 毫米波雷达可无感监测跌倒

## 商业可行
- 与社区养老服务按月订阅打包`;

    const model = templateToModel(text);
    const boxes = model.nodes.filter((n) => n.data?.role === 'section');
    expect(boxes).toHaveLength(3);
    // Section boxes always carry the canonical bilingual name...
    expect(boxes.map((b) => b.data?.name)).toEqual([
      '人本期望 Desirability',
      '技术可行 Feasibility',
      '商业可行 Viability',
    ]);
    // ...but must not be left empty just because the model wrote the Chinese-only heading.
    expect(stickiesInBox(model, '人本期望 Desirability')).toHaveLength(1);
    expect(stickiesInBox(model, '技术可行 Feasibility')).toHaveLength(1);
    expect(stickiesInBox(model, '商业可行 Viability')).toHaveLength(1);
  });

  it('does not cross-merge pure-English sections it should leave alone', () => {
    // golden-circle's WHY/HOW/WHAT have no bilingual suffix to strip; a stray "WHY"-only
    // heading in a different section context must never be treated as equivalent to it.
    const text = `模板: golden-circle

## WHY
- 让每个孩子平等获得优质教育

## HOW
- AI拆解名师课程为个性化路径

## WHAT
- 一款自适应练习App`;
    const model = templateToModel(text);
    expect(stickiesInBox(model, 'WHY')).toHaveLength(1);
    expect(stickiesInBox(model, 'HOW')).toHaveLength(1);
    expect(stickiesInBox(model, 'WHAT')).toHaveLength(1);
  });
});

describe('burger layout', () => {
  it('is plain full-width bands with no decoration art', () => {
    const spec = getTemplate('burger')!;
    expect(spec.decorations ?? []).toHaveLength(0);
    expect(spec.sections).toHaveLength(5);
    for (const sec of spec.sections) {
      expect(sec.w).toBe(1520);
      expect(sec.x).toBe(820);
    }
  });

  it('issue #2605 — long bilingual title box is wide enough not to wrap, left edge stays at x=60', () => {
    const model = templateToModel('模板: burger\n\n## 开场引入\n- a');
    const title = model.nodes.find((n) => n.id === 'tpl-title')!;
    expect(title.label).toBe('汉堡沟通模型 Burger Communication Model');
    // The old flat 380px box was narrower than this title actually needs
    // (reported as a two-line wrap in the issue's screenshot) — the box must
    // now be wider than that, and the left edge (x - width/2) must still
    // land on 60, same anchor every other frame element lines up against.
    expect(title.width).toBeGreaterThan(380);
    expect(title.x - title.width / 2).toBeCloseTo(60, 5);
  });

  it("a short title (e.g. golden-circle's) keeps the old 380px box unchanged", () => {
    const model = templateToModel('模板: golden-circle\n\n## WHY\n- a');
    const title = model.nodes.find((n) => n.id === 'tpl-title')!;
    expect(title.width).toBe(380);
    expect(title.x).toBe(250);
  });
});

describe('storyboard header fields', () => {
  const text = CASES.find((c) => c.key === 'storyboard')!.text;

  it('parses 故事主角 into a field node and placeholders the missing one', () => {
    const model = templateToModel(text);
    const fields = model.nodes.filter((n) => n.data?.role === 'field');
    expect(fields).toHaveLength(2);
    expect(fields.find((f) => f.data?.key === '故事主角')?.label).toBe('快递员老周');
    expect(fields.find((f) => f.data?.key === '故事主题')?.label).toBe('——');
  });

  it('exports filled fields and omits empty ones', () => {
    const out = serializeTemplate(templateToModel(text));
    expect(out).toContain('故事主角: 快递员老周');
    expect(out).not.toContain('故事主题:');
  });

  it('reassigns a dragged sticky to the box it lands in', () => {
    const model = templateToModel(text);
    const target = model.nodes.find(
      (n) => n.data?.role === 'section' && n.data?.name === '6 收尾',
    )!;
    const sticky = model.nodes.find(
      (n) => n.data?.role === 'sticky' && n.label.includes('姜茶'),
    )!;
    sticky.x = target.x;
    sticky.y = target.y;
    const out = serializeTemplate(model);
    expect(out).toContain('## 6 收尾\n- 独居老人为他撑伞送来姜茶');
    expect(out).not.toContain('## 4 高光点');
  });
});
