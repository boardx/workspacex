import { describe, it, expect } from 'vitest';
import { templateToModel } from '../src/diagrams/template-engine';
import '../src/diagrams/templates-user';

/**
 * issue #3542：journey-map「阶段名」表头字段偶发空白。
 *
 * 分区名查找（`lookupSectionItems`）有五级兜底（#2549/#2576/#2653/#3374/#3379），
 * 但表头字段（`spec.fields`，journey-map 的 `阶段1`~`阶段5`）此前走的是完全不同的
 * 一条路径——`fields.get(key) || EMPTY_FIELD`，纯字符串精确匹配，一级兜底都没有。
 * 模型在表头行把字段名写得跟 canonical 名有一丁点出入（多一个空格、中文数字、
 * 语序颠倒……）就会静默 fallback 成 `EMPTY_FIELD`（`——`），画布上看到一条空表头，
 * 不报错。
 *
 * 这里复用 `lookupSectionItems` 已经验证过的同一套规范化判据（现在抽成
 * `resolveTolerant`，见 `lookupFieldValue`），不发明新兜底策略。
 *
 * ## 这些用例为什么这么写
 *
 * 断言的是**表头字段文本节点的值**（`data.role === 'field'` 且 `data.key` 是
 * canonical 名），不是 `parseTemplateText` 解析出了什么——丢内容发生在解析之后的
 * 匹配那一步，跟分区名的教训一样。
 *
 * 阳性对照：一个真正没写的字段仍然显示 `——`——不能把"没写"和"写走样了"混为一谈，
 * 这正是 issue 里明确写的完成判据。
 *
 * 反证：把 `template-engine.ts` 里两处 `lookupFieldValue(fields, key)` stash 回
 * 原来的 `fields.get(key)`，本文件前三条用例立刻红（值从 canonical 文本变成
 * `——`），第四条（阳性对照）保持绿——证明对照不是空转。
 */

function fieldValue(code: string, key: string): string | undefined {
  const model = templateToModel(code);
  const node = model.nodes.find((n) => n.data?.role === 'field' && n.data?.key === key);
  return node?.label;
}

describe('表头字段容错：journey-map 的「阶段名」列', () => {
  it('字段名多了个空格 —— 仍然命中该字段', () => {
    const value = fieldValue(
      ['模板: journey-map', '阶段 1: 发现需求'].join('\n'),
      '阶段1',
    );
    expect(value).toBe('发现需求');
  });

  it('阶段号写成中文数字 —— 仍然命中该字段', () => {
    const value = fieldValue(
      ['模板: journey-map', '阶段一: 对比选型'].join('\n'),
      '阶段1',
    );
    expect(value).toBe('对比选型');
  });

  it('字段名带多余标点 —— 仍然命中该字段', () => {
    const value = fieldValue(
      ['模板: journey-map', '阶段2。: 签约下单'].join('\n'),
      '阶段2',
    );
    expect(value).toBe('签约下单');
  });

  it('阳性对照：真正没写的字段仍如实显示占位符，不会被兜底认领', () => {
    const value = fieldValue(
      ['模板: journey-map', '阶段1: 发现需求'].join('\n'),
      '阶段3',
    );
    expect(value).toBe('——');
  });

  it('段的集合不同的两个字段不会被互相认领（阶段1 ≠ 阶段2）', () => {
    const model = templateToModel(
      ['模板: journey-map', '阶段1: 只属于阶段1的值'].join('\n'),
    );
    const stage2 = model.nodes.find((n) => n.data?.role === 'field' && n.data?.key === '阶段2');
    expect(stage2?.label).toBe('——');
  });
});
