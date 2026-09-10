import { describe, it, expect } from 'vitest';
import { templateToModel } from '../src/diagrams/template-engine';
import '../src/diagrams/templates-user';

/**
 * 2026-09-10 人类实测：journey-map 整张画布 20 格全空。
 *
 * 内置 journey-map 的分区名是**两个维度的交叉**——`行为 · 阶段1`（泳道 × 阶段）。
 * 模型产出的围栏写的是 `## 阶段1行为`、`## 阶段一触点`：分隔符没了、两段顺序反了、
 * 阶段号还写成了中文数字。`lookupSectionItems` 此前的四级兜底（精确 / 去空格标点 /
 * 剥英文后缀 / 剥尾括号）没有任何一级能把它认回来，于是每一格都静默 fallback 成
 * 空数组——框照画、内容全丢，与 #2549 / #2576 / #2653 / #3374 同一种「静默丢内容」。
 *
 * ## 这两条判据为什么这么写
 *
 * 判的是**贴纸真的画出来了**（`DiagramModel` 里能按 label 找到节点），不是
 * `parseTemplateText` 解析出了几条——解析一直是对的，丢内容发生在解析之后的匹配那一步。
 *
 * 阳性对照：同一份围栏里**故意留一段谁也对不上的分区名**（`## 完全不相干的名字`），
 * 断言它确实一条贴纸都没画出来。否则「找得到贴纸」可能只是因为引擎把所有要点
 * 一股脑画到了画布上、根本没按分区分配。
 *
 * 反证：把 `lookupSectionItems` 的第 ⑤ 级（分段乱序）连同
 * `arabicizeCjkNumerals` 一起 stash 掉，本文件两条用例立刻红
 * （`stickyLabels` 从 4 条变成 0 条）。
 */

function labelsOf(code: string): string[] {
  const model = templateToModel(code);
  return model.nodes.filter((n) => n.shape === 'sticky').map((n) => n.label);
}

describe('分区名容错：交叉命名的模板（journey-map）', () => {
  it('两段顺序反了、分隔符丢了 —— 仍然落到正确的分区', () => {
    const labels = labelsOf([
      '模板: journey-map',
      '阶段1: 到店前',
      '',
      '## 阶段1行为',
      '- 在大众点评搜索餐馆',
      '- 电话预订座位',
      '',
      '## 完全不相干的名字',
      '- 这条谁也匹配不上，必须一条都画不出来',
    ].join('\n'));

    expect(labels).toContain('在大众点评搜索餐馆');
    expect(labels).toContain('电话预订座位');
    // 阳性对照：匹配不上的分区确实是空的（不是"所有要点都被画上去了"）。
    expect(labels).not.toContain('这条谁也匹配不上，必须一条都画不出来');
  });

  it('阶段号写成中文数字 —— 仍然落到正确的分区', () => {
    const labels = labelsOf([
      '模板: journey-map',
      '',
      '## 阶段一触点',
      '- 第三方平台的评分与评论',
      '',
      '## 触点 · 阶段2',
      '- 门店招牌与等位区环境',
    ].join('\n'));

    expect(labels).toContain('第三方平台的评分与评论');
    // 逐字写对的那一条本来就该命中，一起断言，证明兜底没有把原路径挤掉。
    expect(labels).toContain('门店招牌与等位区环境');
  });

  it('段的集合不同的两个名字不会被折叠到一起（`阶段1` ≠ `阶段2`）', () => {
    const labels = labelsOf([
      '模板: journey-map',
      '',
      '## 阶段2行为',
      '- 只属于阶段2的一条',
    ].join('\n'));
    // 只断言它画出来了一次：如果乱序兜底判得太松（比如只比段的交集），
    // `行为 · 阶段1`~`行为 · 阶段5` 会全部认领这一条，画出 5 张同样的贴纸。
    expect(labels.filter((l) => l === '只属于阶段2的一条')).toHaveLength(1);
  });
});
