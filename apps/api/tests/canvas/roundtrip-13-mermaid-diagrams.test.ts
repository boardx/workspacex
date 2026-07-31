/**
 * F103 · round-trip 断言 —— 13 种 mermaid 图（D-08 数据链的 mermaid ⇄ Markdown 段）。
 *
 * 技术约束（R12 + uc-7-3 R10「分层运行环境」）：mermaid 文本 → DiagramModel 的解析方向
 * (`mermaidToModel`) 依赖 `mermaid.render()` 做真实浏览器文本测量（`getBBox`），连 jsdom
 * 都不满足（已实测：jsdom 缺 `getBBox`，`mermaid.render` 内部直接抛错）——不是本仓配置
 * 问题，是 mermaid 库本身的运行时要求。真实浏览器路径由 apps/web 承载，人工/E2E 验证。
 *
 * 这份纯函数层测试覆盖 D-08 数据链里**不需要浏览器**的两段：
 *   DiagramModel → mermaid 文本（`modelToMermaid`，逻辑序列化，可确定性验证）
 *   mermaid 文本 ⇄ Markdown 围栏（`wrapAsMermaidBlock` / `extractMermaidBlocks`，纯字符串）
 * 对 13 种图各取一份最小夹具，逐一断言：
 *   ① 序列化输出包含正确的图头与关键逻辑内容（节点/边标签，不含坐标）；
 *   ② 序列化是确定性的（同一 model 两次序列化字节相同）——这是「round-trip 稳定」的可执行形式；
 *   ③ 包进 Markdown 围栏再抽取出来，code 与原文本逐字相同（Markdown ⇄ mermaid 文本层的真实 round-trip）。
 */
import { describe, it, expect } from 'vitest';
import {
  modelToMermaid,
  wrapAsMermaidBlock,
  extractMermaidBlocks,
  type DiagramModel,
  type DiagramNode,
  type DiagramEdge,
} from '@repo/fabric-markdown';

function node(id: string, extra: Partial<DiagramNode> = {}): DiagramNode {
  return { id, label: id, shape: 'rect', x: 0, y: 0, width: 100, height: 50, ...extra };
}

function edge(id: string, source: string, target: string, extra: Partial<DiagramEdge> = {}): DiagramEdge {
  return { id, source, target, kind: 'arrow', ...extra };
}

interface Fixture {
  name: string;
  header: string;
  contains: string[];
  model: DiagramModel;
}

/** 13 种 mermaid 原生图（不含 template/usecase 两种自定义围栏语言），每种一份最小夹具。 */
const FIXTURES: Fixture[] = [
  {
    name: 'flowchart',
    header: 'flowchart',
    contains: ['致命假设', '验证'],
    model: {
      kind: 'flowchart',
      direction: 'LR',
      nodes: [node('n1', { label: '致命假设：EMC 可复制' }), node('n2', { label: '验证：3 个园区试点' })],
      edges: [edge('e1', 'n1', 'n2', { label: '需验证' })],
    },
  },
  {
    name: 'class',
    header: 'classDiagram',
    contains: ['Animal', 'Dog', '--|>'],
    model: {
      kind: 'class',
      direction: 'TD',
      nodes: [
        node('Animal', { shape: 'class', members: ['+int age'], methods: ['+eat() void'] }),
        node('Dog', { shape: 'class' }),
      ],
      edges: [edge('e1', 'Dog', 'Animal', { kind: 'inheritance' })],
    },
  },
  {
    name: 'state',
    header: 'stateDiagram-v2',
    contains: ['[*]', '运行中'],
    model: {
      kind: 'state',
      direction: 'TD',
      nodes: [
        node('start', { shape: 'stateStart' }),
        node('run', { label: '运行中', shape: 'round' }),
        node('end', { shape: 'stateEnd' }),
      ],
      edges: [edge('e1', 'start', 'run'), edge('e2', 'run', 'end', { label: '完成' })],
    },
  },
  {
    name: 'sequence',
    header: 'sequenceDiagram',
    contains: ['participant', '你好'],
    model: {
      kind: 'sequence',
      direction: 'TD',
      nodes: [node('A', { shape: 'participant' }), node('B', { shape: 'participant' })],
      edges: [
        edge('m1', 'A', 'B', { label: '你好', order: 0 }),
        edge('m2', 'B', 'A', { label: '收到', kind: 'dotted', order: 1 }),
      ],
    },
  },
  {
    name: 'er',
    header: 'erDiagram',
    contains: ['CUSTOMER', 'ORDER', 'places'],
    model: {
      kind: 'er',
      direction: 'TD',
      nodes: [
        node('CUSTOMER', { data: { attributes: [{ type: 'string', name: 'name', keys: ['PK'] }] } }),
        node('ORDER', { data: { attributes: [{ type: 'int', name: 'total' }] } }),
      ],
      edges: [
        edge('r1', 'CUSTOMER', 'ORDER', {
          label: 'places',
          data: { cardA: 'ZERO_OR_MORE', cardB: 'ONLY_ONE', relType: 'IDENTIFYING' },
        }),
      ],
    },
  },
  {
    name: 'mindmap',
    header: 'mindmap',
    contains: ['根主题', '子主题'],
    model: {
      kind: 'mindmap',
      direction: 'TD',
      nodes: [node('root', { label: '根主题' }), node('child', { label: '子主题' })],
      edges: [edge('e1', 'root', 'child')],
    },
  },
  {
    name: 'gitgraph',
    header: 'gitGraph',
    contains: ['commit', 'c1'],
    model: {
      kind: 'gitgraph',
      direction: 'LR',
      nodes: [
        node('c1', { data: { branch: 'main', seq: 0 } }),
        node('c2', { data: { branch: 'main', seq: 1 } }),
      ],
      edges: [edge('e1', 'c1', 'c2')],
    },
  },
  {
    name: 'gantt',
    header: 'gantt',
    contains: ['需求分析', '2026-01-01'],
    model: {
      kind: 'gantt',
      direction: 'LR',
      nodes: [
        node('t1', {
          label: '需求分析',
          data: { role: 'task', section: '阶段一', taskId: 't1', start: '2026-01-01', end: '2026-01-05', order: 0 },
        }),
      ],
      edges: [],
      meta: { title: '项目计划', dateFormat: 'YYYY-MM-DD', sections: ['阶段一'] },
    },
  },
  {
    name: 'journey',
    header: 'journey',
    contains: ['下单', '5'],
    model: {
      kind: 'journey',
      direction: 'LR',
      nodes: [
        node('t1', {
          label: '下单',
          data: { role: 'task', task: '下单', score: 5, people: ['用户'], section: '购买', order: 0 },
        }),
      ],
      edges: [],
      meta: { title: '购物旅程', sections: ['购买'] },
    },
  },
  {
    name: 'timeline',
    header: 'timeline',
    contains: ['2024', '发布'],
    model: {
      kind: 'timeline',
      direction: 'LR',
      nodes: [
        node('p1', { label: '2024', data: { role: 'period', order: 0 } }),
        node('ev1', { label: '发布', data: { role: 'event', period: '2024', eventOrder: 0 } }),
      ],
      edges: [],
      meta: { title: '大事记', sectionOf: {} },
    },
  },
  {
    name: 'pie',
    header: 'pie',
    contains: ['苹果', '42'],
    model: {
      kind: 'pie',
      direction: 'TD',
      nodes: [
        node('s1', { shape: 'pieSlice', data: { name: '苹果', value: 42, order: 0 } }),
        node('s2', { shape: 'pieSlice', data: { name: '香蕉', value: 8, order: 1 } }),
      ],
      edges: [],
      meta: { title: '水果占比', showData: false },
    },
  },
  {
    name: 'quadrant',
    header: 'quadrantChart',
    contains: ['产品A'],
    model: {
      kind: 'quadrant',
      direction: 'TD',
      nodes: [node('pt1', { label: '产品A', data: { role: 'point', name: '产品A', x: 0.3, y: 0.7 } })],
      edges: [],
      meta: { title: '竞品分析', xAxisLeft: '低', xAxisRight: '高', yAxisBottom: '弱', yAxisTop: '强' },
    },
  },
  {
    name: 'xychart',
    header: 'xychart-beta',
    contains: ['bar'],
    model: {
      kind: 'xychart',
      direction: 'TD',
      nodes: [
        node('v1', { data: { role: 'value', plot: 0, type: 'bar', cat: 'Q1', col: 0, value: 10 } }),
        node('v2', { data: { role: 'value', plot: 0, type: 'bar', cat: 'Q2', col: 1, value: 20 } }),
      ],
      edges: [],
      meta: { title: '营收', categories: ['Q1', 'Q2'], yTitle: '金额', yMin: 0, yMax: 100 },
    },
  },
];

describe('F103 · 13 种 mermaid 图的 round-trip（Node 纯函数层）', () => {
  it('has exactly 13 fixtures (one per whitelisted mermaid kind, UC-7.1 R7)', () => {
    expect(FIXTURES.length).toBe(13);
    expect(new Set(FIXTURES.map((f) => f.model.kind)).size).toBe(13);
  });

  for (const fx of FIXTURES) {
    describe(`${fx.name}`, () => {
      it('① model → mermaid text carries the correct header and logical content', () => {
        const out = modelToMermaid(fx.model);
        expect(out.trim()).not.toBe('');
        expect(out.split('\n')[0]).toContain(fx.header);
        for (const s of fx.contains) {
          expect(out, `${fx.name} output should contain "${s}"`).toContain(s);
        }
      });

      it('② serialization is deterministic (round-trips byte-identical across repeat calls)', () => {
        const a = modelToMermaid(fx.model);
        const b = modelToMermaid(fx.model);
        expect(b).toBe(a);
      });

      it('③ mermaid text ⇄ Markdown fence round-trips byte-identical (extractMermaidBlocks(wrap(x)) === x)', () => {
        const code = modelToMermaid(fx.model);
        const wrapped = wrapAsMermaidBlock(code);
        const blocks = extractMermaidBlocks(wrapped);
        expect(blocks.length).toBe(1);
        expect(blocks[0]!.code).toBe(code.replace(/\n$/, ''));
        expect(blocks[0]!.lang).toBe('mermaid');
      });
    });
  }

  it('R7 ②「坐标不写回 Markdown」：flowchart 节点的画布坐标不出现在序列化文本里', () => {
    const model: DiagramModel = {
      kind: 'flowchart',
      direction: 'TD',
      nodes: [
        node('a', { label: '开始', x: 12345, y: 67890, width: 240, height: 96 }),
        node('b', { label: '结束', x: -4242, y: 13579, width: 240, height: 96 }),
      ],
      edges: [edge('e1', 'a', 'b')],
    };
    const out = modelToMermaid(model);
    for (const n of model.nodes) {
      expect(out, `x=${n.x} leaked into serialized mermaid`).not.toContain(String(n.x));
      expect(out, `y=${n.y} leaked into serialized mermaid`).not.toContain(String(n.y));
    }
  });
});
