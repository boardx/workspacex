import { describe, it, expect } from 'vitest';
import {
  templateToModel,
  serializeTemplate,
  parseTemplateText,
  getTemplate,
} from '../src/diagrams/template-engine';
import '../src/diagrams/templates-user';
import { USER_SAMPLES } from '../src/diagrams/templates-user';

interface Case {
  key: string;
  sectionCount: number;
  /** Section used in the probe document. */
  section: string;
  /** Header field lines, e.g. '执行者: 张三'. */
  fieldLines?: string[];
}

const CASES: Case[] = [
  { key: 'empathy', sectionCount: 6, section: '痛点' },
  {
    key: 'jtbd',
    sectionCount: 6,
    section: '核心任务',
    fieldLines: ['执行者: 一线运营专员', '关键约束: 预算不超过5000元'],
  },
  { key: 'journey-map', sectionCount: 20, section: '触点 · 阶段1' },
  { key: 'value-proposition', sectionCount: 6, section: '用户任务' },
  { key: 'adlib', sectionCount: 6, section: '想要实现' },
  {
    key: 'hmw',
    sectionCount: 8,
    section: '想法3',
    fieldLines: ['我们可以如何: 简化报销流程', '以便: 专注服务客户'],
  },
];

function probeDoc(c: Case): string {
  const head = [`模板: ${c.key}`, ...(c.fieldLines ?? [])].join('\n');
  return `${head}\n\n## ${c.section}\n- 内容A\n- 内容B`;
}

describe.each(CASES)('template $key', (c) => {
  const code = probeDoc(c);

  it('builds a model with the right sections and in-box stickies', () => {
    const model = templateToModel(code);
    expect(model.kind).toBe('template');
    expect(model.meta?.templateKey).toBe(c.key);

    const boxes = model.nodes.filter((n) => n.data?.role === 'section');
    expect(boxes).toHaveLength(c.sectionCount);
    expect(boxes.map((b) => b.data?.name)).toEqual(getTemplate(c.key)!.sections.map((s) => s.name));

    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    expect(stickies).toHaveLength(2);
    const box = boxes.find((b) => b.data?.name === c.section)!;
    for (const s of stickies) {
      expect(Math.abs(s.x - box.x)).toBeLessThanOrEqual(box.width / 2);
      expect(Math.abs(s.y - box.y)).toBeLessThanOrEqual(box.height / 2);
    }
  });

  it('serializes back to the same text shape', () => {
    const text = serializeTemplate(templateToModel(code));
    expect(text).toContain(`模板: ${c.key}`);
    for (const line of c.fieldLines ?? []) expect(text).toContain(line);
    expect(text).toContain(`## ${c.section}`);
    expect(text).toContain('- 内容A');
    expect(text).toContain('- 内容B');
  });
});

describe('empathy layout', () => {
  it('has six section boxes with no pairwise overlap (AABB)', () => {
    const sections = getTemplate('empathy')!.sections;
    expect(sections).toHaveLength(6);
    for (let i = 0; i < sections.length; i++) {
      for (let j = i + 1; j < sections.length; j++) {
        const a = sections[i]!;
        const b = sections[j]!;
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
        const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2;
        expect(
          overlapX && overlapY,
          `sections "${a.name}" and "${b.name}" overlap`,
        ).toBe(false);
      }
    }
  });
});

describe('header field parsing', () => {
  it('jtbd parses and exports its four fields', () => {
    const code = [
      '模板: jtbd',
      '执行者: 运营专员',
      '决策者: 运营总监',
      '付费者: 预算部门',
      '关键约束: 每月5000元',
      '',
      '## 情境触发',
      '- 每周一汇报数据',
    ].join('\n');
    const parsed = parseTemplateText(code);
    expect(parsed.templateKey).toBe('jtbd');
    expect(parsed.fields.get('决策者')).toBe('运营总监');
    expect(parsed.fields.get('关键约束')).toBe('每月5000元');

    const model = templateToModel(code);
    const fields = model.nodes.filter((n) => n.data?.role === 'field');
    expect(fields.find((f) => f.data?.key === '付费者')?.label).toBe('预算部门');

    const text = serializeTemplate(model);
    expect(text).toContain('执行者: 运营专员');
    expect(text).toContain('决策者: 运营总监');
    expect(text).toContain('付费者: 预算部门');
    expect(text).toContain('关键约束: 每月5000元');
  });

  it('hmw parses its three prompt fields and omits empty ones on export', () => {
    const code = ['模板: hmw', '我们可以如何: 简化报销流程', '为给: 出差的销售', '', '## 想法1', '- 拍照识别发票'].join(
      '\n',
    );
    const parsed = parseTemplateText(code);
    expect(parsed.fields.get('我们可以如何')).toBe('简化报销流程');
    expect(parsed.fields.get('为给')).toBe('出差的销售');

    const model = templateToModel(code);
    const fields = model.nodes.filter((n) => n.data?.role === 'field');
    expect(fields.find((f) => f.data?.key === '以便')?.label).toBe('——');

    const text = serializeTemplate(model);
    expect(text).toContain('我们可以如何: 简化报销流程');
    expect(text).toContain('为给: 出差的销售');
    expect(text).not.toContain('以便:');
  });

  it('还没写出任何要点前手滑冒出一个空标题，后面的字段行仍然解析成表头（回归 2026-08-30）', () => {
    // 复现真实症状：模型把某个字段也格式化成了一个空的 `## 标题`（没有任何要点跟着），
    // 这不该锁死后续「字段名: 字段值」的解析——旧实现一旦见过第一个标题就永久切换
    // 到"当前分区的段落文字"模式,这些字段行会被悄悄吞进一个渲染引擎根本不认识的
    // section 里,界面上完全看不出来,也没有任何报错。
    const code = [
      '模板: jtbd',
      '## 执行者',
      '执行者: 运营专员',
      '决策者: 运营总监',
      '付费者: 预算部门',
      '关键约束: 每月5000元',
      '',
      '## 情境触发',
      '- 每周一汇报数据',
    ].join('\n');
    const parsed = parseTemplateText(code);
    expect(parsed.fields.get('执行者')).toBe('运营专员');
    expect(parsed.fields.get('决策者')).toBe('运营总监');
    expect(parsed.fields.get('付费者')).toBe('预算部门');
    expect(parsed.fields.get('关键约束')).toBe('每月5000元');

    const model = templateToModel(code);
    const fields = model.nodes.filter((n) => n.data?.role === 'field');
    expect(fields.find((f) => f.data?.key === '决策者')?.label).toBe('运营总监');
  });
});

describe('USER_SAMPLES', () => {
  it('covers all six templates with valid canvas blocks', () => {
    const keys = new Set<string>();
    for (const md of Object.values(USER_SAMPLES)) {
      const m = /```canvas\n([\s\S]*?)```/.exec(md);
      expect(m).not.toBeNull();
      const model = templateToModel(m![1]!);
      keys.add(String(model.meta?.templateKey));
      expect(model.nodes.filter((n) => n.data?.role === 'sticky').length).toBeGreaterThanOrEqual(4);
    }
    expect([...keys].sort()).toEqual(
      ['adlib', 'empathy', 'hmw', 'journey-map', 'jtbd', 'value-proposition'].sort(),
    );
  });
});
