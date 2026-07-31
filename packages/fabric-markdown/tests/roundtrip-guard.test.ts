/**
 * Serialization round-trip guard.
 *
 * Independent regression net for the visual overhaul (VISUAL-SPEC.md §5):
 * pure logic-level tests — no browser, no mermaid rendering. Only IR → text
 * → IR equivalence is asserted. Deliberately insensitive to layout changes:
 * no coordinates, colors, sizes or node counts are asserted, only logical
 * content (section membership, sticky text, field values, mermaid headers).
 */
import { describe, it, expect } from 'vitest';
// Barrel import: self-registers every diagram plugin AND every canvas template.
import '../src/diagrams/index';
import {
  listTemplates,
  parseTemplateText,
  templateToModel,
  serializeTemplate,
  type TemplateSpec,
} from '../src/diagrams/template-engine';
import { modelToMermaid } from '../src/mermaid-serializer';
import type { DiagramModel, DiagramNode, DiagramEdge } from '../src/model';

// ---------------------------------------------------------------------------
// 1. Template layer: full round-trip for every registered template
// ---------------------------------------------------------------------------

/** Synthetic source text: `模板:` line, one value per header field, 2 stickies per section. */
function syntheticText(spec: TemplateSpec): string {
  const lines: string[] = [`模板: ${spec.key}`];
  (spec.fields ?? []).forEach((f, i) => lines.push(`${f}: 测试值${i + 1}`));
  spec.sections.forEach((sec, i) => {
    lines.push('');
    lines.push(`## ${sec.name}`);
    lines.push(`- 测试贴A${i + 1}`);
    lines.push(`- 测试贴B${i + 1}`);
  });
  return lines.join('\n');
}

/**
 * Templates with a known geometry bug that breaks the round-trip (e.g. a
 * section band too short to contain a default sticky's center, so the
 * nearest-center fallback migrates content to another section). Entries run
 * with `it.fails` so this file stays green as a regression net; once a spec
 * is fixed, vitest flags the now-passing test and the entry must be removed.
 * Currently empty — the `mvp` band-height bug was fixed by enlarging
 * 「愿景与假设」/「核心用户旅程」 to h:150.
 */
const KNOWN_BROKEN_TEMPLATES = new Set<string>();

describe('template round-trip guard (text → model → text → parse)', () => {
  const specs = listTemplates();

  it('has templates registered', () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  for (const spec of specs) {
    const testFn = KNOWN_BROKEN_TEMPLATES.has(spec.key) ? it.fails : it;
    testFn(`round-trips template "${spec.key}"`, () => {
      const input = syntheticText(spec);
      const parsedIn = parseTemplateText(input);

      // text → model (fenceKey forces the spec; persona has no 模板: line on
      // re-serialize, so the key must come from the fence anyway)
      const model = templateToModel(input, spec.key);
      expect(model.kind).toBe('template');
      expect(model.meta?.templateKey).toBe(spec.key);

      // model → text → parse
      const out = serializeTemplate(model);
      expect(out.trim()).not.toBe('');
      const parsedOut = parseTemplateText(out);

      // Field values survive (only header fields that had a value are emitted).
      for (const f of spec.fields ?? []) {
        expect(parsedOut.fields.get(f), `field "${f}" of ${spec.key}`).toBe(
          parsedIn.fields.get(f),
        );
      }

      // Section set: every spec section that had stickies must come back,
      // and no unexpected sections may appear.
      const specNames = spec.sections.map((s) => s.name);
      for (const name of parsedOut.sections.keys()) {
        expect(specNames, `unexpected section "${name}" in ${spec.key}`).toContain(name);
      }

      // Per-section sticky count + exact texts, in input order.
      spec.sections.forEach((sec, i) => {
        const got = parsedOut.sections.get(sec.name) ?? [];
        expect(got, `stickies of section "${sec.name}" in ${spec.key}`).toEqual([
          `测试贴A${i + 1}`,
          `测试贴B${i + 1}`,
        ]);
      });

      // Section order in the serialized text follows the spec order.
      const emittedOrder = [...parsedOut.sections.keys()];
      const expectedOrder = specNames.filter((n) => parsedOut.sections.has(n));
      expect(emittedOrder).toEqual(expectedOrder);

      // Stability: a second full cycle produces identical text.
      const model2 = templateToModel(out, spec.key);
      expect(serializeTemplate(model2)).toBe(out);
    });
  }

  it('round-trips empty sections (no stickies) without inventing content', () => {
    const spec = specs[0]!;
    const input = `模板: ${spec.key}`;
    const out = serializeTemplate(templateToModel(input, spec.key));
    const parsed = parseTemplateText(out);
    for (const items of parsed.sections.values()) {
      expect(items).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Mermaid serialization smoke: minimal model per diagram kind
// ---------------------------------------------------------------------------

function node(id: string, extra: Partial<DiagramNode> = {}): DiagramNode {
  return { id, label: id, shape: 'rect', x: 0, y: 0, width: 100, height: 50, ...extra };
}

function edge(id: string, source: string, target: string, extra: Partial<DiagramEdge> = {}): DiagramEdge {
  return { id, source, target, kind: 'arrow', ...extra };
}

interface SmokeCase {
  name: string;
  header: string;
  /** Extra substrings that must appear (logical content only). */
  contains?: string[];
  model: DiagramModel;
}

const cases: SmokeCase[] = [
  {
    name: 'flowchart',
    header: 'flowchart',
    contains: ['开始', '结束'],
    model: {
      kind: 'flowchart',
      direction: 'TD',
      nodes: [node('a', { label: '开始' }), node('b', { label: '结束' })],
      edges: [edge('e1', 'a', 'b', { label: '下一步' })],
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
        node('CUSTOMER', {
          data: { attributes: [{ type: 'string', name: 'name', keys: ['PK'] }] },
        }),
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
          data: {
            role: 'task',
            section: '阶段一',
            taskId: 't1',
            start: '2026-01-01',
            end: '2026-01-05',
            order: 0,
          },
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

describe('modelToMermaid smoke guard (minimal model per kind)', () => {
  for (const c of cases) {
    it(`emits valid-looking ${c.name} source`, () => {
      const out = modelToMermaid(c.model);
      expect(out.trim()).not.toBe('');
      // First line carries the diagram type header.
      expect(out.split('\n')[0]).toContain(c.header);
      for (const s of c.contains ?? []) {
        expect(out, `${c.name} output should contain "${s}"`).toContain(s);
      }
    });
  }
});
