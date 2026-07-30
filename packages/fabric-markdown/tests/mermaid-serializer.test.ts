import { describe, it, expect } from 'vitest';
import { modelToMermaid, sanitizeNodeId } from '../src/mermaid-serializer';
import { extractClusterGeometry } from '../src/mermaid-parser';
import type { DiagramModel, DiagramNode } from '../src/model';

function baseModel(): DiagramModel {
  return {
    kind: 'flowchart',
    direction: 'TD',
    nodes: [
      { id: 'A', label: 'Start', shape: 'stadium', x: 0, y: 0, width: 80, height: 40 },
      { id: 'B', label: 'Do it?', shape: 'diamond', x: 0, y: 100, width: 90, height: 60 },
      { id: 'C', label: 'Work', shape: 'rect', x: 0, y: 200, width: 80, height: 40 },
      { id: 'D', label: 'End', shape: 'circle', x: 0, y: 300, width: 50, height: 50 },
    ],
    edges: [
      { id: 'e0', source: 'A', target: 'B', kind: 'arrow' },
      { id: 'e1', source: 'B', target: 'C', label: 'yes', kind: 'arrow' },
      { id: 'e2', source: 'B', target: 'D', label: 'no', kind: 'dotted' },
      { id: 'e3', source: 'C', target: 'D', kind: 'thick' },
    ],
  };
}

describe('modelToMermaid', () => {
  it('emits direction, node shapes and edge kinds', () => {
    const src = modelToMermaid(baseModel());
    expect(src).toContain('flowchart TD');
    expect(src).toContain('A(["Start"])');
    expect(src).toContain('B{"Do it?"}');
    expect(src).toContain('C["Work"]');
    expect(src).toContain('D(("End"))');
    expect(src).toContain('A --> B');
    expect(src).toContain('B -->|"yes"| C');
    expect(src).toContain('B -.->|"no"| D');
    expect(src).toContain('C ==> D');
  });

  it('escapes quotes and newlines in labels', () => {
    const model = baseModel();
    model.nodes[0]!.label = 'Say "hi"\ntwice';
    const src = modelToMermaid(model);
    expect(src).toContain('A(["Say #quot;hi#quot;<br/>twice"])');
  });

  it('sanitizes unsafe node ids consistently between decl and edges', () => {
    const model: DiagramModel = {
      kind: 'flowchart',
      direction: 'LR',
      nodes: [
        { id: 'my node', label: 'X', shape: 'rect', x: 0, y: 0, width: 10, height: 10 },
        { id: '2nd', label: 'Y', shape: 'rect', x: 0, y: 0, width: 10, height: 10 },
      ],
      edges: [{ id: 'e0', source: 'my node', target: '2nd', kind: 'arrow' }],
    };
    const src = modelToMermaid(model);
    expect(src).toContain('my_node["X"]');
    expect(src).toContain('n2nd["Y"]');
    expect(src).toContain('my_node --> n2nd');
  });

  it('emits open edges without arrowheads', () => {
    const model = baseModel();
    model.edges = [{ id: 'e0', source: 'A', target: 'B', kind: 'open' }];
    expect(modelToMermaid(model)).toContain('A --- B');
  });
});

describe('sanitizeNodeId', () => {
  it('deduplicates collisions', () => {
    const taken = new Set<string>();
    expect(sanitizeNodeId('a b', taken)).toBe('a_b');
    expect(sanitizeNodeId('a-b', taken)).toBe('a_b2');
  });
});

describe('modelToMermaid — flowchart subgraphs', () => {
  function sgRect(sgId: string, title: string, geo: Partial<DiagramNode>, members: string[] = []): DiagramNode {
    return {
      id: `subgraph:${sgId}`,
      label: '',
      shape: 'rect',
      x: 0, y: 0, width: 0, height: 0,
      ...geo,
      data: {
        role: 'subgraph', sgId, title, members,
        locked: true, color: '#fefce8', stroke: '#eab308',
      },
    };
  }
  function sgTitle(sgId: string, title: string): DiagramNode {
    return {
      id: `subgraphTitle:${sgId}`,
      label: title,
      shape: 'text',
      x: 0, y: 0, width: 100, height: 18,
      data: { role: 'subgraphTitle', sgId, locked: true, bold: true, fontSize: 13 },
    };
  }

  /** One box (center 100,100 size 200x200) with A,B inside; C outside. */
  function subgraphModel(): DiagramModel {
    return {
      kind: 'flowchart',
      direction: 'TD',
      nodes: [
        sgRect('g1', '准备阶段', { x: 100, y: 100, width: 200, height: 200 }),
        sgTitle('g1', '准备阶段'),
        { id: 'A', label: '开始', shape: 'rect', x: 60, y: 80, width: 60, height: 30 },
        { id: 'B', label: '检查', shape: 'diamond', x: 140, y: 150, width: 60, height: 40 },
        { id: 'C', label: '结束', shape: 'rect', x: 400, y: 100, width: 60, height: 30 },
      ],
      edges: [
        { id: 'e0', source: 'A', target: 'B', kind: 'arrow' },
        { id: 'e1', source: 'B', target: 'C', kind: 'arrow', label: '通过' },
      ],
    };
  }

  it('emits a subgraph block with title, members inside and non-members outside', () => {
    const src = modelToMermaid(subgraphModel());
    const linesArr = src.split('\n');
    expect(linesArr[0]).toBe('flowchart TD');
    expect(src).toContain('subgraph g1["准备阶段"]');
    const sgStart = linesArr.findIndex((l) => l.includes('subgraph g1'));
    const sgEnd = linesArr.findIndex((l) => l.trim() === 'end');
    expect(sgStart).toBeGreaterThan(-1);
    expect(sgEnd).toBeGreaterThan(sgStart);
    const inside = linesArr.slice(sgStart + 1, sgEnd).join('\n');
    expect(inside).toContain('A["开始"]');
    expect(inside).toContain('B{"检查"}');
    expect(inside).not.toContain('C["结束"]');
    // C declared after the block, edges intact.
    expect(linesArr.slice(sgEnd + 1).join('\n')).toContain('C["结束"]');
    expect(src).toContain('A --> B');
    expect(src).toContain('B -->|"通过"| C');
    // The scaffolding nodes are not emitted as ordinary nodes.
    expect(src).not.toContain('subgraph:g1');
    expect(src).not.toContain('subgraphTitle');
    expect(src).not.toContain('[""]');
  });

  it('recomputes membership from geometry when a node is dragged out', () => {
    const model = subgraphModel();
    const b = model.nodes.find((n) => n.id === 'B')!;
    b.x = 500; // dragged far outside the g1 box
    const src = modelToMermaid(model);
    const linesArr = src.split('\n');
    const sgEnd = linesArr.findIndex((l) => l.trim() === 'end');
    const inside = linesArr.slice(0, sgEnd).join('\n');
    expect(inside).not.toContain('B{"检查"}');
    expect(linesArr.slice(sgEnd + 1).join('\n')).toContain('B{"检查"}');
  });

  it('captures a node dragged into the box even if it was never a member', () => {
    const model = subgraphModel();
    const c = model.nodes.find((n) => n.id === 'C')!;
    c.x = 120;
    c.y = 120;
    const src = modelToMermaid(model);
    const linesArr = src.split('\n');
    const sgEnd = linesArr.findIndex((l) => l.trim() === 'end');
    expect(linesArr.slice(0, sgEnd).join('\n')).toContain('C["结束"]');
  });

  it('assigns nodes to the smallest containing box when subgraphs nest', () => {
    const model = subgraphModel();
    model.nodes.unshift(sgRect('outer', '外层', { x: 150, y: 125, width: 400, height: 350 }));
    const src = modelToMermaid(model);
    // A/B sit inside both boxes → belong to the smaller g1; C only in outer.
    const outerStart = src.indexOf('subgraph outer["外层"]');
    const g1Start = src.indexOf('subgraph g1["准备阶段"]');
    expect(outerStart).toBeGreaterThan(-1);
    expect(g1Start).toBeGreaterThan(-1);
    const g1Block = src.slice(g1Start, src.indexOf('end', g1Start));
    expect(g1Block).toContain('A["开始"]');
    expect(g1Block).toContain('B{"检查"}');
    const outerBlock = src.slice(outerStart, src.indexOf('end', outerStart));
    expect(outerBlock).not.toContain('A["开始"]');
  });

  it('falls back to data.members when the box has no usable geometry', () => {
    const model = subgraphModel();
    const rect = model.nodes[0]!;
    rect.width = 0;
    rect.height = 0;
    (rect.data as Record<string, unknown>)['members'] = ['A', 'B'];
    const src = modelToMermaid(model);
    const linesArr = src.split('\n');
    const sgEnd = linesArr.findIndex((l) => l.trim() === 'end');
    const inside = linesArr.slice(0, sgEnd).join('\n');
    expect(inside).toContain('A["开始"]');
    expect(inside).toContain('B{"检查"}');
    expect(inside).not.toContain('C["结束"]');
  });

  it('sanitizes the subgraph id and keeps edges to the box itself', () => {
    const model = subgraphModel();
    (model.nodes[0]!.data as Record<string, unknown>)['sgId'] = 'my group';
    model.edges.push({ id: 'e2', source: 'C', target: 'subgraph:g1', kind: 'arrow' });
    const src = modelToMermaid(model);
    expect(src).toContain('subgraph my_group["准备阶段"]');
    expect(src).toContain('C --> my_group');
  });

  it('emits a bare subgraph header when the title is empty', () => {
    const model = subgraphModel();
    (model.nodes[0]!.data as Record<string, unknown>)['title'] = '';
    model.nodes.splice(1, 1); // drop the title text node
    const src = modelToMermaid(model);
    expect(src).toContain('subgraph g1\n');
    expect(src).not.toContain('subgraph g1[');
  });

  it('prefers the edited title text node over the stored title', () => {
    const model = subgraphModel();
    const titleNode = model.nodes.find((n) => n.data?.['role'] === 'subgraphTitle')!;
    titleNode.label = '新标题';
    const src = modelToMermaid(model);
    expect(src).toContain('subgraph g1["新标题"]');
  });
});

describe('extractClusterGeometry', () => {
  const CLUSTER_FIXTURE = `
<svg xmlns="http://www.w3.org/2000/svg">
  <g class="root">
    <g class="cluster undefined" id="one" data-look="classic">
      <rect x="10" y="20" width="200" height="150"></rect>
      <g class="cluster-label" transform="translate(90, 25)">
        <foreignObject width="40" height="18"><div><span class="nodeLabel">分组一</span></div></foreignObject>
      </g>
    </g>
    <g class="cluster" transform="translate(300, 0)">
      <rect x="0" y="0" width="100" height="80"></rect>
      <g class="cluster-label"><foreignObject><div><span class="nodeLabel">二</span></div></foreignObject></g>
    </g>
  </g>
</svg>`;

  it('reads rect geometry (as centers), id attribute and label text', () => {
    const div = document.createElement('div');
    div.innerHTML = CLUSTER_FIXTURE;
    const clusters = extractClusterGeometry(div.querySelector('svg')!);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toEqual({
      idAttr: 'one',
      title: '分组一',
      x: 110,
      y: 95,
      width: 200,
      height: 150,
    });
    // Second cluster: translate(300,0) applied on the group.
    expect(clusters[1]!.idAttr).toBe('');
    expect(clusters[1]!.title).toBe('二');
    expect(clusters[1]!.x).toBe(350);
    expect(clusters[1]!.y).toBe(40);
  });
});

describe('modelToMermaid — classDiagram', () => {
  function classModel(): DiagramModel {
    return {
      kind: 'class',
      direction: 'TB',
      nodes: [
        {
          id: 'Animal', label: 'Animal', shape: 'class', x: 0, y: 0, width: 140, height: 120,
          members: ['+int age'], methods: ['+eat() : void'],
        },
        { id: 'Dog', label: 'Dog', shape: 'class', x: 0, y: 200, width: 120, height: 80, members: [], methods: [] },
        { id: 'Bone', label: 'Bone', shape: 'class', x: 200, y: 200, width: 100, height: 60, members: [], methods: [] },
      ],
      edges: [
        { id: 'e0', source: 'Dog', target: 'Animal', kind: 'inheritance', label: '继承' },
        { id: 'e1', source: 'Dog', target: 'Bone', kind: 'arrow', sourceLabel: '1', targetLabel: '*' },
        { id: 'e2', source: 'Dog', target: 'Bone', kind: 'composition' },
        { id: 'e3', source: 'Dog', target: 'Bone', kind: 'dependency' },
      ],
    };
  }

  it('emits classDiagram with compartments and relations', () => {
    const src = modelToMermaid(classModel());
    expect(src).toContain('classDiagram');
    expect(src).toContain('direction TB');
    expect(src).toContain('class Animal {');
    expect(src).toContain('+int age');
    expect(src).toContain('+eat() : void');
    expect(src).toContain('class Dog');
    expect(src).toContain('Dog --|> Animal : 继承');
    expect(src).toContain('Dog "1" --> "*" Bone');
    expect(src).toContain('Dog --* Bone');
    expect(src).toContain('Dog ..> Bone');
  });

  it('emits <<annotation>> rows from data.annotations before members', () => {
    const model = classModel();
    const animal = model.nodes[0]!;
    animal.data = { annotations: ['interface'] };
    const src = modelToMermaid(model);
    const body = src.slice(src.indexOf('class Animal {'), src.indexOf('}', src.indexOf('class Animal {')));
    expect(body).toContain('<<interface>>');
    expect(body.indexOf('<<interface>>')).toBeLessThan(body.indexOf('+int age'));
  });

  it('recognizes guillemet member rows («abstract») as annotations (round-trip form)', () => {
    const model = classModel();
    const animal = model.nodes[0]!;
    // The parser stores annotations both as data.annotations and as the
    // first member row «abstract» for canvas display; the serializer must
    // not emit the row twice.
    animal.members = ['«abstract»', '+int age'];
    animal.data = { annotations: ['abstract'] };
    const src = modelToMermaid(model);
    expect(src).toContain('<<abstract>>');
    expect(src).not.toContain('«abstract»');
    expect(src.match(/<<abstract>>/g)).toHaveLength(1);
    expect(src).toContain('+int age');
  });

  it('emits a class body when only an annotation is present', () => {
    const model: DiagramModel = {
      kind: 'class',
      direction: 'TB',
      nodes: [{
        id: 'Shape', label: 'Shape', shape: 'class', x: 0, y: 0, width: 100, height: 60,
        members: ['«interface»'], methods: [],
      }],
      edges: [],
    };
    const src = modelToMermaid(model);
    expect(src).toContain('class Shape {');
    expect(src).toContain('<<interface>>');
  });
});
