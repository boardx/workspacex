import { describe, it, expect } from 'vitest';
import { modelToMermaid } from '../src/mermaid-serializer';
import { extractSequenceGeometry } from '../src/mermaid-parser';
import type { DiagramModel, DiagramNode } from '../src/model';

describe('modelToMermaid — stateDiagram-v2', () => {
  function stateModel(): DiagramModel {
    return {
      kind: 'state',
      direction: 'TD',
      nodes: [
        { id: '__start__', label: '', shape: 'stateStart', x: 0, y: 0, width: 14, height: 14 },
        { id: 'Idle', label: '空闲状态', shape: 'round', x: 0, y: 100, width: 100, height: 40 },
        { id: 'Running', label: 'Running', shape: 'round', x: 0, y: 200, width: 100, height: 40 },
        { id: '__end__', label: '', shape: 'stateEnd', x: 0, y: 300, width: 18, height: 18 },
      ],
      edges: [
        { id: 'e0', source: '__start__', target: 'Idle', kind: 'arrow' },
        { id: 'e1', source: 'Idle', target: 'Running', kind: 'arrow', label: 'start' },
        { id: 'e2', source: 'Running', target: '__end__', kind: 'arrow' },
      ],
    };
  }

  it('emits header and normalizes TD to TB', () => {
    const src = modelToMermaid(stateModel());
    expect(src).toContain('stateDiagram-v2');
    expect(src).toContain('direction TB');
    expect(src).not.toContain('direction TD');
  });

  it('keeps non-TD directions as-is', () => {
    const model = stateModel();
    model.direction = 'LR';
    expect(modelToMermaid(model)).toContain('direction LR');
  });

  it('references start/end pseudo-states as [*] without declaring them', () => {
    const src = modelToMermaid(stateModel());
    expect(src).toContain('[*] --> Idle');
    expect(src).toContain('Running --> [*]');
    expect(src).not.toContain('__start__');
    expect(src).not.toContain('__end__');
  });

  it('declares aliased states with state "label" as id', () => {
    const src = modelToMermaid(stateModel());
    expect(src).toContain('state "空闲状态" as Idle');
    // label === id needs no declaration line.
    expect(src).not.toContain('state "Running"');
  });

  it('escapes double quotes in state labels', () => {
    const model = stateModel();
    model.nodes[1]!.label = 'say "hi"';
    expect(modelToMermaid(model)).toContain('state "say #quot;hi#quot;" as Idle');
  });

  it('emits transitions with and without titles', () => {
    const src = modelToMermaid(stateModel());
    expect(src).toContain('Idle --> Running : start');
    expect(src).toContain('[*] --> Idle\n');
  });

  // Defensive: composite states (state X { ... }) may be skipped during
  // import (they render as clusters without node geometry), leaving edges
  // that reference ids absent from the node list. Serialization must not
  // throw and must emit a parseable transition with a sanitized token.
  it('does not throw when edges reference missing (composite) states', () => {
    const model = stateModel();
    model.edges.push(
      { id: 'e3', source: 'Running', target: 'Composite State', kind: 'arrow' },
      { id: 'e4', source: 'Composite State', target: 'Idle', kind: 'arrow', label: 'exit' },
    );
    let src = '';
    expect(() => {
      src = modelToMermaid(model);
    }).not.toThrow();
    expect(src).toContain('Running --> Composite_State');
    expect(src).toContain('Composite_State --> Idle : exit');
  });
});

describe('modelToMermaid — sequenceDiagram', () => {
  function seqModel(): DiagramModel {
    return {
      kind: 'sequence',
      direction: 'TD',
      nodes: [
        {
          id: 'U', label: '用户', shape: 'participant',
          x: 0, y: 0, width: 100, height: 40, lifelineHeight: 300,
        },
        {
          id: 'S', label: 'S', shape: 'participant',
          x: 200, y: 0, width: 100, height: 40, lifelineHeight: 300,
        },
      ],
      edges: [
        { id: 'e0', source: 'U', target: 'S', kind: 'arrow', label: '登录请求', order: 0 },
        { id: 'e1', source: 'S', target: 'U', kind: 'dotted', label: '登录成功', order: 1 },
      ],
    };
  }

  it('emits participant with alias only when label differs from id', () => {
    const src = modelToMermaid(seqModel());
    expect(src).toContain('sequenceDiagram');
    expect(src).toContain('participant U as 用户');
    expect(src).toContain('participant S\n');
    expect(src).not.toContain('participant S as');
  });

  it('maps arrow to ->> and dotted to -->>', () => {
    const src = modelToMermaid(seqModel());
    expect(src).toContain('U->>S: 登录请求');
    expect(src).toContain('S-->>U: 登录成功');
  });

  it('sorts messages by order even when the array is shuffled', () => {
    const model = seqModel();
    model.edges = [
      { id: 'e2', source: 'U', target: 'S', kind: 'arrow', label: 'third', order: 2 },
      { id: 'e0', source: 'U', target: 'S', kind: 'arrow', label: 'first', order: 0 },
      { id: 'e1', source: 'S', target: 'U', kind: 'dotted', label: 'second', order: 1 },
    ];
    const src = modelToMermaid(model);
    const first = src.indexOf('U->>S: first');
    const second = src.indexOf('S-->>U: second');
    const third = src.indexOf('U->>S: third');
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('falls back to seqY, then array position, when order is missing', () => {
    const model = seqModel();
    model.edges = [
      { id: 'e1', source: 'S', target: 'U', kind: 'dotted', label: 'lower', seqY: 220 },
      { id: 'e0', source: 'U', target: 'S', kind: 'arrow', label: 'upper', seqY: 120 },
    ];
    const src = modelToMermaid(model);
    expect(src.indexOf('U->>S: upper')).toBeGreaterThan(-1);
    expect(src.indexOf('S-->>U: lower')).toBeGreaterThan(src.indexOf('U->>S: upper'));
  });

  it('uses a space placeholder for empty message labels', () => {
    const model = seqModel();
    model.edges = [{ id: 'e0', source: 'U', target: 'S', kind: 'arrow', order: 0 }];
    expect(modelToMermaid(model)).toContain('U->>S:  ');
  });

  function noteNode(
    id: string,
    label: string,
    actors: string[],
    placement: number,
    order: number,
    extra: Partial<DiagramNode> = {},
  ): DiagramNode {
    return {
      id,
      label,
      shape: 'sticky',
      x: 100,
      y: 100,
      width: 150,
      height: 40,
      ...extra,
      data: { role: 'note', actors, placement, order },
    };
  }

  it('serializes over/left/right notes', () => {
    const model = seqModel();
    model.nodes.push(
      noteNode('note:0', '双方都看到', ['U', 'S'], 2, 2),
      noteNode('note:1', '仅用户侧', ['U'], 0, 3),
      noteNode('note:2', '服务侧提示', ['S'], 1, 4),
    );
    const src = modelToMermaid(model);
    expect(src).toContain('Note over U,S: 双方都看到');
    expect(src).toContain('Note left of U: 仅用户侧');
    expect(src).toContain('Note right of S: 服务侧提示');
    // Note sticky nodes must not leak into the participant list.
    expect(src).not.toContain('participant note');
  });

  it('interleaves notes with messages by shared order', () => {
    const model = seqModel(); // messages at order 0 and 1
    model.nodes.push(noteNode('note:0', '中间备注', ['U'], 1, 1));
    model.edges[1]!.order = 2;
    const src = modelToMermaid(model);
    const first = src.indexOf('U->>S: 登录请求');
    const note = src.indexOf('Note right of U: 中间备注');
    const second = src.indexOf('S-->>U: 登录成功');
    expect(first).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(first);
    expect(second).toBeGreaterThan(note);
  });

  it('deduplicates identical note actors and escapes note text', () => {
    const model = seqModel();
    model.nodes.push(noteNode('note:0', '说 "嗨"\n两次', ['U', 'U'], 2, 2));
    const src = modelToMermaid(model);
    expect(src).toContain('Note over U: 说 #quot;嗨#quot;<br/>两次');
  });

  it('drops notes without any anchor actor instead of emitting invalid text', () => {
    const model = seqModel();
    model.nodes.push(noteNode('note:0', '孤立', [], 2, 2));
    const src = modelToMermaid(model);
    expect(src).not.toContain('Note');
    expect(src).toContain('U->>S: 登录请求');
  });
});

describe('extractSequenceGeometry — note rects', () => {
  const FIXTURE = `
<svg xmlns="http://www.w3.org/2000/svg">
  <rect class="actor actor-top" name="U" x="0" y="0" width="100" height="40"></rect>
  <line class="actor-line" x1="50" y1="40" x2="50" y2="300"></line>
  <line class="messageLine0" x1="50" y1="90" x2="200" y2="90"></line>
  <g data-et="note"><rect class="note" x="60" y="120" width="150" height="40"></rect></g>
</svg>`;

  it('returns note rect centers in document order', () => {
    const div = document.createElement('div');
    div.innerHTML = FIXTURE;
    const { noteRects, messageYs, actors } = extractSequenceGeometry(div.querySelector('svg')!);
    expect(actors.get('U')).toBeTruthy();
    expect(messageYs).toEqual([90]);
    expect(noteRects).toEqual([{ x: 135, y: 140, width: 150, height: 40 }]);
  });
});
