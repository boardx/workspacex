import { describe, it, expect } from 'vitest';
import { templateToModel, serializeTemplate, getTemplate } from '../src/diagrams/template-engine';
import '../src/diagrams/templates-strategy';
import { STRATEGY_SAMPLES } from '../src/diagrams/templates-strategy';

/** Pull the ```canvas fence body out of a sample markdown document. */
function fenceBody(md: string): string {
  const m = /```canvas\n([\s\S]*?)```/.exec(md);
  if (!m) throw new Error('sample has no ```canvas fence');
  return m[1]!;
}

interface Case {
  key: string;
  sample: string;
  sectionCount: number;
  /** A section used in the sample: [name, sticky count, one bullet text]. */
  check: [string, number, string];
}

const CASES: Case[] = [
  {
    key: 'pestel',
    sample: 'PESTEL 分析',
    sectionCount: 6,
    check: ['经济因素', 2, '铜铝等原材料价格上涨挤压毛利'],
  },
  {
    key: 'swot',
    sample: 'SWOT 分析',
    sectionCount: 4,
    check: ['机会', 2, '以旧换新补贴刺激置换需求'],
  },
  {
    key: 'bmc',
    sample: '商业模式画布',
    sectionCount: 9,
    check: ['价值主张', 2, '一站式全屋智能解决方案'],
  },
  {
    key: 'mvp',
    sample: 'MVP 实验画布',
    sectionCount: 8,
    check: ['实验设计', 2, '两周免费试用后逐一电话回访'],
  },
  {
    key: 'three-horizons',
    sample: '三地平线模型',
    sectionCount: 6,
    check: ['H1 焦点领域', 2, '优化现有门店坪效与损耗'],
  },
  {
    key: 'ai-strategy',
    sample: 'AI 战略画布',
    sectionCount: 9,
    check: ['AI角色定位', 2, '专业而亲切的外贸顾问'],
  },
  {
    key: 'ai-bmc',
    sample: 'AI 商业模型画布',
    sectionCount: 12,
    check: ['技术能力', 2, '自研行业术语微调模型'],
  },
];

describe('strategy templates', () => {
  for (const { key, sample, sectionCount, check } of CASES) {
    const [checkName, checkCount, checkBullet] = check;

    describe(key, () => {
      it('parses its sample into the template model', () => {
        const model = templateToModel(fenceBody(STRATEGY_SAMPLES[sample]!));
        expect(model.kind).toBe('template');
        expect(model.meta?.templateKey).toBe(key);

        const boxes = model.nodes.filter((n) => n.data?.role === 'section');
        expect(boxes).toHaveLength(sectionCount);

        // Every sticky lands inside its own section box.
        const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
        expect(stickies.length).toBeGreaterThan(0);
        const box = boxes.find((b) => b.data?.name === checkName)!;
        expect(box).toBeDefined();
        const inside = stickies.filter(
          (s) => Math.abs(s.x - box.x) <= box.width / 2 && Math.abs(s.y - box.y) <= box.height / 2,
        );
        expect(inside).toHaveLength(checkCount);
        expect(inside.some((s) => s.label === checkBullet)).toBe(true);
      });

      it('serializes back to the text syntax', () => {
        const model = templateToModel(fenceBody(STRATEGY_SAMPLES[sample]!));
        const text = serializeTemplate(model);
        expect(text).toContain(`模板: ${key}`);
        expect(text).toContain(`## ${checkName}`);
        expect(text).toContain(`- ${checkBullet}`);
      });
    });
  }

  it('swot spec is black/white/gray with a center figure decoration', () => {
    const spec = getTemplate('swot')!;
    expect(spec).toBeDefined();
    // B/W/G revision: no per-quadrant palette colors.
    expect(spec.sectionColors).toBeUndefined();
    const ids = (spec.decorations ?? []).map((d) => d.id);
    expect(ids).toContain('swot-center');
    expect(ids).toContain('swot-center-icon');
  });

  it('every sample fence names its own template key', () => {
    for (const { key, sample } of CASES) {
      expect(fenceBody(STRATEGY_SAMPLES[sample]!)).toMatch(new RegExp(`^模板: ${key}\\n`));
    }
  });
});
