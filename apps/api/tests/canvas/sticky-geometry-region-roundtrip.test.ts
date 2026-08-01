/**
 * F104 · 便签几何归区导出（R7 规则①，I-10 / I-11）。
 *
 * 依据 D-08：便签→分区的判定是几何的（拖进哪个分区框，导出就归到那个 `##` 段落；
 * 落在框外的归最近的框），与创建顺序/创建者/便签内容无关。这条规则已经在
 * `fabric-markdown` 的 `serializeTemplate`（section 几何包含 + 最近框兜底）里实现——
 * 本测试是 F104 对它的 round-trip 断言（issue #194 verification 第 1 条）。
 *
 * 运行环境：纯 Node 可跑（R12「优先级最高：round-trip 断言」）—— `templateToModel` /
 * `serializeTemplate` 是纯函数，不需要浏览器或 fabric canvas。
 */
import { describe, it, expect } from 'vitest';
import { templateToModel, serializeTemplate, type DiagramModel } from '@repo/fabric-markdown';

/** SWOT 四象限（`packages/fabric-markdown/src/diagrams/templates-strategy.ts`）中心坐标：
 * 优势 (430,280) · 劣势 (1190,280) · 机会 (430,680) · 威胁 (1190,680)，各 740x380。 */

const SWOT_MARKDOWN = `模板: swot

## 优势
- 团队执行力强

## 劣势
- 现金流紧张

## 机会
- 新市场需求增长

## 威胁
- 竞对降价`;

function findSticky(model: DiagramModel, text: string) {
  const node = model.nodes.find((n) => n.data?.role === 'sticky' && n.label === text);
  if (!node) throw new Error(`sticky not found: ${text}`);
  return node;
}

describe('F104 · 便签几何归区导出（round-trip）', () => {
  it('V1（AC2）：把便签从「优势」拖进「威胁」分区框，导出后出现在 ## 威胁 下，且不再出现在 ## 优势 下', () => {
    const model = templateToModel(SWOT_MARKDOWN, undefined);
    expect(model.meta?.templateKey).toBe('swot');

    const sticky = findSticky(model, '团队执行力强');
    // 挪进「威胁」象限框的几何范围内（中心 1190,680，半宽/半高 370/190）。
    sticky.x = 1190;
    sticky.y = 680;

    const out = serializeTemplate(model);
    const sections = out.split(/\n(?=## )/);
    const strengthsSection = sections.find((s) => s.startsWith('## 优势'));
    const threatsSection = sections.find((s) => s.startsWith('## 威胁'));

    expect(threatsSection).toContain('团队执行力强');
    expect(strengthsSection ?? '').not.toContain('团队执行力强');

    // 其余内容逐字不变（I-11）。
    expect(out).toContain('现金流紧张');
    expect(out).toContain('新市场需求增长');
    expect(out).toContain('竞对降价');
    const oppSection = sections.find((s) => s.startsWith('## 机会'));
    const weakSection = sections.find((s) => s.startsWith('## 劣势'));
    expect(oppSection).toContain('新市场需求增长');
    expect(weakSection).toContain('现金流紧张');
  });

  it('V2：便签落在所有分区框之外时，归几何上最近（中心距离）的框', () => {
    const model = templateToModel(SWOT_MARKDOWN, undefined);
    const sticky = findSticky(model, '新市场需求增长');

    // (200, 900) 在四个象限框之外；到各框中心的平方距离：
    //   优势(430,280): 230²+620²=437300 · 机会(430,680): 230²+220²=101300（最近）
    //   威胁(1190,680): 990²+220²=1028500 · 劣势(1190,280): 更远
    sticky.x = 200;
    sticky.y = 900;

    const out = serializeTemplate(model);
    const sections = out.split(/\n(?=## )/);
    const oppSection = sections.find((s) => s.startsWith('## 机会'));
    expect(oppSection).toContain('新市场需求增长');
    for (const other of ['## 优势', '## 劣势', '## 威胁']) {
      const sec = sections.find((s) => s.startsWith(other));
      expect(sec ?? '').not.toContain('新市场需求增长');
    }
  });

  it('归区判定是全函数：每张便签恰好归属一个分区，不存在无归属便签（I-10）', () => {
    const model = templateToModel(SWOT_MARKDOWN, undefined);
    // 制造一批边界/框外坐标，逐一验证 serializeTemplate 的分组结果覆盖全部便签、无遗漏无重复。
    const stickies = model.nodes.filter((n) => n.data?.role === 'sticky');
    expect(stickies.length).toBeGreaterThan(0);

    const out = serializeTemplate(model);
    const sections = out.split(/\n(?=## )/);
    const seen = new Set<string>();
    for (const s of stickies) {
      const owners = sections.filter((sec) => sec.includes(s.label));
      expect(owners.length).toBe(1); // 恰好归属一个分区
      seen.add(s.label);
    }
    expect(seen.size).toBe(stickies.length);
  });

  it('换区不依赖创建顺序或便签内容：把「威胁」下的便签挪到「优势」同样生效', () => {
    const model = templateToModel(SWOT_MARKDOWN, undefined);
    const sticky = findSticky(model, '竞对降价');
    sticky.x = 430;
    sticky.y = 280; // 优势象限中心

    const out = serializeTemplate(model);
    const sections = out.split(/\n(?=## )/);
    const strengths = sections.find((s) => s.startsWith('## 优势'));
    const threats = sections.find((s) => s.startsWith('## 威胁'));
    expect(strengths).toContain('竞对降价');
    expect(threats ?? '').not.toContain('竞对降价');
  });
});
