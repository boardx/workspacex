// @vitest-environment jsdom
/**
 * F104 · 坐标不写回 Markdown（R7 规则②，I-9）。
 *
 * mermaid 语法里没有坐标位；写回只保留结构，重新渲染时由 mermaid 自动布局。
 * 因此：
 *   - 同一份 Markdown 两次渲染的节点坐标可以不同，这是正确行为，不是 bug；
 *   - 任何测试都不得以「重开后位置变了」为失败判据 —— 本文件反过来断言：
 *     即使两次渲染坐标完全不同，导出的 mermaid/Markdown 文本必须逐字一致；
 *   - 补偿手段是[另存布局快照]，与本文件的断言范围正交（快照是独立于文本的旁路数据，
 *     由 apps/web 的 `canvas-save-layout` 承载，见 issue #194 verification 第 3 条）。
 *
 * 运行环境说明（同 three-way-transform.test.ts）：本测试从一份「已解析好的
 * DiagramModel」起步（等价于「真实浏览器已经把 mermaid 文本解析成模型」），
 * 覆盖 DiagramModel ⇄ fabric ⇄ mermaid ⇄ Markdown 这几段——都可以在 jsdom 下用
 * `fabric.StaticCanvas` 真实运行，不需要 mock。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StaticCanvas, type Canvas } from 'fabric';
import {
  renderToCanvas,
  extractModel,
  modelToMermaid,
  wrapAsMermaidBlock,
  canvasToMermaid,
  canvasToMarkdown,
  FlowNode,
  type DiagramModel,
} from '@repo/fabric-markdown';

const INITIAL_MODEL: DiagramModel = {
  kind: 'flowchart',
  direction: 'LR',
  nodes: [
    { id: 'n1', label: '致命假设：EMC 可复制', shape: 'rect', x: 0, y: 0, width: 220, height: 60 },
    { id: 'n2', label: '验证：3 个园区试点', shape: 'rect', x: 320, y: 0, width: 220, height: 60 },
    { id: 'n3', label: '结论：进入下一阶段', shape: 'rect', x: 640, y: 0, width: 220, height: 60 },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2', kind: 'arrow', label: '需验证' },
    { id: 'e2', source: 'n2', target: 'n3', kind: 'arrow' },
  ],
};

const NARRATIVE = `# 谁在买储能 · 假设风暴 (hmw)

## 我们可以怎样
- 怎样把回本测算做进销售话术

`;

function buildMarkdown(mermaidCode: string): string {
  return NARRATIVE + wrapAsMermaidBlock(mermaidCode) + '\n';
}

describe('F104 · 坐标不写回 Markdown（round-trip）', () => {
  let canvas: Canvas;
  let originalMermaid: string;
  let originalMarkdown: string;

  beforeEach(() => {
    canvas = new StaticCanvas(undefined, { width: 1200, height: 800 }) as unknown as Canvas;
    originalMermaid = modelToMermaid(INITIAL_MODEL);
    originalMarkdown = buildMarkdown(originalMermaid);
  });

  it('V4：在画布上大幅拖动全部节点后导出，mermaid 文本逻辑等价且不含任何坐标信息', () => {
    renderToCanvas(INITIAL_MODEL, canvas);
    const nodes = canvas.getObjects().filter((o) => o instanceof FlowNode) as FlowNode[];
    expect(nodes).toHaveLength(3);

    // 真实的大幅拖动：把三个节点分别甩到离原位置很远、彼此都不同的坐标。
    const dragTo: Record<string, { left: number; top: number }> = {
      n1: { left: 9999, top: -8888 },
      n2: { left: -5000, top: 4321 },
      n3: { left: 123456, top: -654321 },
    };
    for (const n of nodes) {
      const to = dragTo[n.nodeId]!;
      n.set(to);
      canvas.fire('object:modified', { target: n });
    }

    const newMermaid = canvasToMermaid(canvas);
    // 逻辑内容保留：三个节点标签、连线与标签都还在。
    for (const n of INITIAL_MODEL.nodes) expect(newMermaid).toContain(n.label);
    expect(newMermaid).toContain('需验证');

    // 坐标不泄漏：拖动后的任何坐标数值都不应出现在导出文本里。
    for (const to of Object.values(dragTo)) {
      expect(newMermaid).not.toContain(String(to.left));
      expect(newMermaid).not.toContain(String(to.top));
    }
    // 原始（拖动前）坐标同样不应该出现——mermaid 语法里压根没有坐标位。
    for (const n of INITIAL_MODEL.nodes) {
      expect(newMermaid).not.toContain(String(n.x));
      expect(newMermaid).not.toContain(String(n.y));
    }

    const newMarkdown = canvasToMarkdown(canvas, originalMarkdown);
    // 围栏之外的正文逐字不变（结构保护，与坐标无关但同属「写回只保留结构」）。
    expect(newMarkdown).toContain('# 谁在买储能 · 假设风暴 (hmw)');
    expect(newMarkdown).toContain('- 怎样把回本测算做进销售话术');
    for (const to of Object.values(dragTo)) {
      expect(newMarkdown).not.toContain(String(to.left));
      expect(newMarkdown).not.toContain(String(to.top));
    }
  });

  it('「重开后位置变了」不是失败判据：坐标不同的两个逻辑等价模型，序列化文本必须逐字相同', () => {
    // 模拟「同一份 Markdown 两次渲染」——mermaid 自动布局给出不同坐标，
    // 但节点/边集合、标签、形状完全一致。
    const renderA: DiagramModel = INITIAL_MODEL;
    const renderB: DiagramModel = {
      ...INITIAL_MODEL,
      nodes: INITIAL_MODEL.nodes.map((n, i) => ({ ...n, x: n.x + 777 + i * 33, y: n.y - 555 - i * 11 })),
    };

    expect(renderA.nodes.map((n) => `${n.x},${n.y}`)).not.toEqual(renderB.nodes.map((n) => `${n.x},${n.y}`));

    const outA = modelToMermaid(renderA);
    const outB = modelToMermaid(renderB);
    // 坐标不同不得导致导出文本不同 —— 这就是「不得以重开后位置变了为失败判据」的可执行形式。
    expect(outB).toBe(outA);
  });

  it('导出后重新提取围栏，code 与新的 mermaid 文本逐字一致（Markdown ⇄ mermaid 层不受坐标变化影响）', () => {
    renderToCanvas(INITIAL_MODEL, canvas);
    const n1 = canvas.getObjects().find((o) => o instanceof FlowNode && o.nodeId === 'n1') as FlowNode;
    n1.set({ left: 42424, top: -13131 });
    canvas.fire('object:modified', { target: n1 });

    const model = extractModel(canvas);
    expect(model.nodes.find((n) => n.id === 'n1')?.x).toBe(42424);

    const newMermaid = canvasToMermaid(canvas);
    expect(newMermaid).not.toContain('42424');
    expect(newMermaid).not.toContain('-13131');
  });
});
