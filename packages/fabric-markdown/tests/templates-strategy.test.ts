import { describe, it, expect } from 'vitest';
import { templateToModel, serializeTemplate, getTemplate, parseTemplateText } from '../src/diagrams/template-engine';
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

  // issue #2653：平台后台 SWOT 画布 chat 模拟无内容产出。
  //
  // 根因：`- 技术创新壁垒：采用…` 这类要点本身带一个中文/英文冒号（不是 `字段: 值`
  // 格式，冒号后面还是同一条要点的一部分）。`parseTemplateText` 原先"先判 key:value，
  // 再判 bullet"，`kv` 正则不排除以 `-`/`*` 开头的行，只要 `## 分区` 下**第一条**要点
  // 带冒号、且 `sawBullet` 还没被前面某条不带冒号的要点翻转过，整行就会被当成表头字段
  // 吞掉（`fields.set('- 技术创新壁垒', ...)`），从不会真正进 `sections`——症状是这个
  // 分区解析出 0 条要点，画布上对应象限一片空白，且没有任何报错。真实复现见 issue：
  // SWOT「优势」象限三条要点全部是「标题：说明」格式，象限完全空白。
  it('parses a "标题：说明" bullet as a bullet, not a header field (issue #2653)', () => {
    const code = [
      '模板: swot',
      '## 优势',
      '- 技术创新壁垒：采用分子共振技术，提升吸收率。',
      '- 独特口感体验：处理工艺使口感更圆润柔和。',
      '## 劣势',
      '- 生产成本较高，规模化生产存在挑战。',
    ].join('\n');
    const parsed = parseTemplateText(code);
    expect(parsed.sections.get('优势')).toEqual([
      '技术创新壁垒：采用分子共振技术，提升吸收率。',
      '独特口感体验：处理工艺使口感更圆润柔和。',
    ]);
    // 两条带冒号的要点都没有被误吞成表头字段。
    expect(parsed.fields.size).toBe(0);

    const model = templateToModel(code);
    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    expect(stickies.some((s) => s.label === '技术创新壁垒：采用分子共振技术，提升吸收率。')).toBe(true);
  });
});
