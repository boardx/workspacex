// @vitest-environment jsdom
/**
 * F103 · Markdown ⇄ mermaid 文本 ⇄ DiagramModel ⇄ fabric 三段互转（D-08 硬约束）。
 *
 * 运行环境说明（见 uc-7-3 R10「分层运行环境」+ 本文件姊妹篇
 * `roundtrip-13-mermaid-diagrams.test.ts` 顶部注释）：mermaid **文本 → DiagramModel**
 * 的解析方向需要真实浏览器（`mermaid.render()` 内部用 `getBBox` 做文本测量，
 * jsdom 不提供，已实测确认）。这份测试因此以一份**已解析好的 DiagramModel 夹具**
 * 作为链路起点（等价于「真实浏览器已经把 mermaid 文本解析成模型」这一步的替身），
 * 完整覆盖数据链其余三段、且都是双向：
 *
 *   DiagramModel ⇄ fabric 画布对象   （renderToCanvas / extractModel —— fabric.StaticCanvas
 *                                     可在 jsdom 下真实运行，非 mock）
 *   DiagramModel ⇒ mermaid 文本       （modelToMermaid，纯函数）
 *   mermaid 文本 ⇄ Markdown 围栏      （wrapAsMermaidBlock / extractMermaidBlocks / replaceMermaidBlock）
 *
 * 覆盖 R3 步骤 4「三段任一段的修改都能传导到另外两段」的**画布→源码**方向（本测试
 * 制造一次真实的 fabric 对象修改，一路传导回 Markdown），以及 Markdown 结构在往返中
 * 不被破坏（围栏之外的正文保持逐字不变）。
 *
 * 已知空白（记录在 issue #98 评论里，不在本测试断言范围）：「源码手改 mermaid 文本 →
 * 画布重渲染」这个反方向，因为需要真实浏览器解析 mermaid 文本，本仓 vitest 环境无法
 * 断言；由 apps/web 的真实浏览器运行时承载，需人工/E2E 验证。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { StaticCanvas, type Canvas } from 'fabric';
import {
  renderToCanvas,
  extractModel,
  modelToMermaid,
  wrapAsMermaidBlock,
  extractMermaidBlocks,
  replaceMermaidBlock,
  canvasToMermaid,
  canvasToMarkdown,
  FlowNode,
  type DiagramModel,
} from '@repo/fabric-markdown';

/** 起点模型：等价于「浏览器已把下面这份 mermaid 文本解析出来的结果」。 */
const INITIAL_MODEL: DiagramModel = {
  kind: 'flowchart',
  direction: 'LR',
  nodes: [
    { id: 'n1', label: '致命假设：EMC 可复制', shape: 'rect', x: 0, y: 0, width: 220, height: 60 },
    { id: 'n2', label: '验证：3 个园区试点', shape: 'rect', x: 320, y: 0, width: 220, height: 60 },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', kind: 'arrow', label: '需验证' }],
};

const NARRATIVE = `# 谁在买储能 · 假设风暴 (hmw)

## 我们可以怎样
- 怎样把回本测算做进销售话术

`;

function buildMarkdown(mermaidCode: string): string {
  return NARRATIVE + wrapAsMermaidBlock(mermaidCode) + '\n';
}

describe('F103 · 三段互转（Markdown ⇄ mermaid ⇄ DiagramModel ⇄ fabric）', () => {
  // `renderToCanvas` / `extractModel` / `canvasToMermaid` / `canvasToMarkdown` are typed
  // against the interactive `Canvas`, but `StaticCanvas` implements the same object-graph
  // API (add/remove/getObjects/fire) they actually use — this repo's own headless-render
  // probe confirmed it works at runtime under jsdom. The cast documents that gap instead
  // of silencing it with `any`.
  let canvas: Canvas;
  let originalMermaid: string;
  let originalMarkdown: string;

  beforeEach(() => {
    canvas = new StaticCanvas(undefined, { width: 1000, height: 800 }) as unknown as Canvas;
    originalMermaid = modelToMermaid(INITIAL_MODEL);
    originalMarkdown = buildMarkdown(originalMermaid);
  });

  it('DiagramModel → fabric：renderToCanvas 产出与模型一致的可编辑对象', () => {
    renderToCanvas(INITIAL_MODEL, canvas);
    const flowNodes = canvas.getObjects().filter((o) => o instanceof FlowNode) as FlowNode[];
    expect(flowNodes.map((n) => n.nodeId).sort()).toEqual(['n1', 'n2']);
  });

  it('fabric → DiagramModel：extractModel 读回的逻辑结构（节点/边/标签）与原模型等价', () => {
    renderToCanvas(INITIAL_MODEL, canvas);
    const extracted = extractModel(canvas);
    expect(extracted.kind).toBe('flowchart');
    expect(extracted.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2']);
    expect(extracted.nodes.map((n) => n.label).sort()).toEqual(
      ['致命假设：EMC 可复制', '验证：3 个园区试点'].sort(),
    );
    expect(extracted.edges).toHaveLength(1);
    expect(extracted.edges[0]).toMatchObject({ source: 'n1', target: 'n2', label: '需验证' });
  });

  it('DiagramModel ⇒ mermaid 文本 ⇒ Markdown 围栏：抽取出的 code 与序列化结果逐字相同', () => {
    const blocks = extractMermaidBlocks(originalMarkdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.code).toBe(originalMermaid.replace(/\n$/, ''));
  });

  it('画布编辑 → 传导到 mermaid 文本 → 传导到 Markdown（R3 步骤 4，画布→源码方向）', () => {
    renderToCanvas(INITIAL_MODEL, canvas);

    // 真实的一次 fabric 对象修改：把 n1 的标签从「致命假设：EMC 可复制」改成「已验证：EMC 可复制」。
    const n1 = canvas.getObjects().find((o) => o instanceof FlowNode && o.nodeId === 'n1') as FlowNode;
    expect(n1).toBeTruthy();
    n1.set({ label: '已验证：EMC 可复制' });
    canvas.fire('object:modified', { target: n1 });

    const newMermaid = canvasToMermaid(canvas);
    expect(newMermaid).toContain('已验证：EMC 可复制');
    expect(newMermaid).not.toContain('致命假设：EMC 可复制');

    const newMarkdown = canvasToMarkdown(canvas, originalMarkdown);
    expect(newMarkdown).toContain('已验证：EMC 可复制');
    // 传导只替换围栏内的段落，围栏外的正文逐字不变（R3 步骤 4 的「另外两段」之一）。
    expect(newMarkdown).toContain('# 谁在买储能 · 假设风暴 (hmw)');
    expect(newMarkdown).toContain('- 怎样把回本测算做进销售话术');

    // 再次抽取围栏，确认 Markdown ⇄ mermaid 文本的边界仍然一致。
    const reExtracted = extractMermaidBlocks(newMarkdown);
    expect(reExtracted).toHaveLength(1);
    expect(reExtracted[0]!.code).toBe(newMermaid.replace(/\n$/, ''));
  });

  it('画布结构性编辑（新增节点）同样传导到 mermaid 文本与 Markdown', () => {
    renderToCanvas(INITIAL_MODEL, canvas);
    canvas.add(
      new FlowNode({ nodeId: 'n3', label: '新增：现场共识', shape: 'rect', x: 620, y: 0, width: 220, height: 60 }),
    );
    canvas.fire('object:added');

    const model = extractModel(canvas);
    expect(model.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3']);

    const newMarkdown = canvasToMarkdown(canvas, originalMarkdown);
    expect(newMarkdown).toContain('新增：现场共识');
    const block = extractMermaidBlocks(newMarkdown)[0]!;
    expect(block.code).toContain('n3');
  });

  it('Markdown 结构保护：replaceMermaidBlock 只动围栏内容，围栏前后文本字节不变', () => {
    const blocks = extractMermaidBlocks(originalMarkdown);
    const replaced = replaceMermaidBlock(originalMarkdown, blocks[0]!, 'flowchart LR\n  x1[占位] --> x2[占位]');
    const before = originalMarkdown.slice(0, blocks[0]!.start);
    const after = originalMarkdown.slice(blocks[0]!.end);
    expect(replaced.startsWith(before)).toBe(true);
    expect(replaced.endsWith(after)).toBe(true);
    expect(replaced).toContain('占位');
  });
});
