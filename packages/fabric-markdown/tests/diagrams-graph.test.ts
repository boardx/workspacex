import { describe, it, expect } from 'vitest';
import { parseEr, serializeEr } from '../src/diagrams/er';
import {
  parseMindmap,
  serializeMindmap,
  layoutMindmap,
  mindmapBranchColors,
  reparent,
} from '../src/diagrams/mindmap';
import type { DiagramModel, DiagramNode } from '../src/model';
import { parseGitgraph, serializeGitgraph } from '../src/diagrams/gitgraph';
import type { DiagramParseContext } from '../src/diagrams/registry';

function ctx(db: Record<string, unknown>): DiagramParseContext {
  return { db, geometry: new Map() };
}

// ---------------------------------------------------------------------------
// er
// ---------------------------------------------------------------------------

const erEntities = {
  CUSTOMER: {
    id: 'entity-CUSTOMER-0',
    label: 'CUSTOMER',
    attributes: [
      { type: 'string', name: 'name', keys: [], comment: '' },
      { type: 'int', name: 'custId', keys: ['PK'], comment: '' },
    ],
    alias: '',
  },
  ORDER: {
    id: 'entity-ORDER-1',
    label: 'ORDER',
    attributes: [{ type: 'int', name: 'orderNumber', keys: ['PK'], comment: '' }],
    alias: '',
  },
};

const erRelationships = [
  {
    entityA: 'entity-CUSTOMER-0',
    roleA: 'places',
    entityB: 'entity-ORDER-1',
    relSpec: { cardA: 'ZERO_OR_MORE', relType: 'IDENTIFYING', cardB: 'ONLY_ONE' },
  },
];

function erDb(entities: unknown = erEntities): Record<string, unknown> {
  return {
    getEntities: () => entities,
    getRelationships: () => erRelationships,
    getDirection: () => 'TB',
  };
}

describe('er plugin', () => {
  it('parses entities as class nodes and relationships as labelled open edges', () => {
    const model = parseEr(ctx(erDb()));
    expect(model.kind).toBe('er');
    expect(model.direction).toBe('TB');
    expect(model.nodes).toHaveLength(2);
    expect(model.edges).toHaveLength(1);

    const customer = model.nodes.find((n) => n.id === 'CUSTOMER')!;
    expect(customer.shape).toBe('class');
    expect(customer.label).toBe('CUSTOMER');
    expect(customer.members).toEqual(['string name', 'int custId PK']);
    expect(customer.methods).toEqual([]);
    expect(customer.height).toBe(60 + 2 * 22);

    const edge = model.edges[0]!;
    // entityA/entityB internal ids resolve back to entity names
    expect(edge.source).toBe('CUSTOMER');
    expect(edge.target).toBe('ORDER');
    expect(edge.kind).toBe('open');
    expect(edge.label).toBe('places');
    // cardB (ONLY_ONE) sits at the CUSTOMER end, cardA (ZERO_OR_MORE) at ORDER
    expect(edge.sourceLabel).toBe('||');
    expect(edge.targetLabel).toBe('o{');
  });

  it('accepts a Map-shaped entities db', () => {
    const asMap = new Map(Object.entries(erEntities));
    const model = parseEr(ctx(erDb(asMap)));
    expect(model.nodes.map((n) => n.id)).toEqual(['CUSTOMER', 'ORDER']);
    expect(model.edges[0]!.source).toBe('CUSTOMER');
  });

  it('serializes attribute blocks and crow-foot relationship lines', () => {
    const src = serializeEr(parseEr(ctx(erDb())));
    expect(src).toContain('erDiagram');
    expect(src).toContain('CUSTOMER {');
    expect(src).toContain('string name');
    expect(src).toContain('int custId PK');
    expect(src).toContain('CUSTOMER ||--o{ ORDER : places');
  });

  // ---- official-syntax parity: comments, multi-keys, NON_IDENTIFYING, quoted labels ----

  const erDb2 = {
    getEntities: () => ({
      DRIVER: {
        id: 'entity-DRIVER-0',
        label: 'DRIVER',
        attributes: [
          {
            type: 'string',
            name: 'license',
            keys: ['PK', 'FK'],
            comment: 'The very long license number comment',
          },
        ],
        alias: '',
      },
      CAR: { id: 'entity-CAR-1', label: 'CAR', attributes: [], alias: '' },
    }),
    getRelationships: () => [
      {
        entityA: 'entity-DRIVER-0',
        roleA: 'places order',
        entityB: 'entity-CAR-1',
        relSpec: { cardA: 'ZERO_OR_MORE', relType: 'NON_IDENTIFYING', cardB: 'ONLY_ONE' },
      },
    ],
    getDirection: () => 'LR',
  };

  it('keeps attribute comments in data and shows them truncated in members', () => {
    const model = parseEr(ctx(erDb2));
    const driver = model.nodes.find((n) => n.id === 'DRIVER')!;
    const attrs = driver.data?.attributes as Array<Record<string, unknown>>;
    expect(attrs[0]!.comment).toBe('The very long license number comment');
    // members line: `type name keys "truncated…"`
    expect(driver.members![0]).toContain('string license PK,FK');
    expect(driver.members![0]).toContain('…"');
  });

  it('renders NON_IDENTIFYING relationships as dotted edges', () => {
    const model = parseEr(ctx(erDb2));
    expect(model.edges[0]!.kind).toBe('dotted');
    // identifying stays open
    expect(parseEr(ctx(erDb())).edges[0]!.kind).toBe('open');
  });

  it('serializes comments, multi-keys, .. lines and quoted multi-word labels', () => {
    const src = serializeEr(parseEr(ctx(erDb2)));
    expect(src).toContain('string license PK, FK "The very long license number comment"');
    expect(src).toContain('DRIVER ||..o{ CAR : "places order"');
    // single-word labels stay unquoted
    expect(serializeEr(parseEr(ctx(erDb())))).toContain(': places');
  });

  it('recovers keys and comment from members when node data was lost', () => {
    const model: DiagramModel = {
      kind: 'er',
      direction: 'TB',
      nodes: [
        {
          id: 'X',
          label: 'X',
          shape: 'class',
          x: 0,
          y: 0,
          width: 170,
          height: 82,
          members: ['string name PK,FK "note"'],
        },
      ],
      edges: [],
    };
    const src = serializeEr(model);
    expect(src).toContain('string name PK, FK "note"');
  });

  it('serializes a dashed edge without data as a non-identifying line', () => {
    const model = parseEr(ctx(erDb2));
    delete model.edges[0]!.data;
    // cardinality enums lived in the lost data (defaults to ||), but the
    // dashed kind still restores the non-identifying `..` line.
    expect(serializeEr(model)).toContain('DRIVER ||..|| CAR');
  });
});

// ---------------------------------------------------------------------------
// mindmap
// ---------------------------------------------------------------------------

const mindmapTree = {
  id: 0,
  nodeId: 'root',
  level: 0,
  descr: '产品规划',
  type: 3,
  isRoot: true,
  children: [
    {
      id: 1,
      nodeId: '功能',
      level: 2,
      descr: '功能',
      type: 0,
      children: [
        { id: 3, nodeId: '导出', level: 4, descr: '导出', type: 2, children: [] },
        { id: 4, nodeId: '导入', level: 4, descr: '导入', type: 0, children: [] },
      ],
    },
    { id: 2, nodeId: '设计', level: 2, descr: '设计', type: 1, children: [] },
  ],
};

const mindmapDb = { getMindmap: () => mindmapTree };

describe('mindmap plugin', () => {
  it('flattens the tree with unique numeric-based ids and parent edges', () => {
    const model = parseMindmap(ctx(mindmapDb));
    expect(model.kind).toBe('mindmap');
    expect(model.direction).toBe('LR');
    expect(model.nodes).toHaveLength(5);
    expect(model.edges).toHaveLength(4);

    const root = model.nodes.find((n) => n.id === 'n0')!;
    expect(root.label).toBe('产品规划');
    // root renders as a big stadium; original mermaid type survives in data
    expect(root.shape).toBe('stadium');
    expect(root.width).toBe(170);
    expect(root.height).toBe(56);
    expect(root.data?.fontSize).toBe(16);
    expect(root.data?.mmType).toBe(3);
    // root is the only node with no incoming edge
    const targets = new Set(model.edges.map((e) => e.target));
    expect(targets.has('n0')).toBe(false);
    expect(model.nodes.filter((n) => !targets.has(n.id))).toHaveLength(1);

    // x follows real recursion depth (db level field is unreliable)
    const leaf = model.nodes.find((n) => n.id === 'n3')!;
    expect(leaf.x).toBe(140 + 2 * 240);
    expect(leaf.shape).toBe('round');
    expect(leaf.data?.mmType).toBe(2);
    // width tracks label length, clamped to 90..220
    expect(leaf.width).toBe(90);
    expect(leaf.height).toBe(44);
    // leaves stack in preorder (72px apart); parents sit at their children's mean
    expect(leaf.y).toBe(90);
    expect(model.nodes.find((n) => n.id === 'n4')!.y).toBe(162);
    expect(model.nodes.find((n) => n.id === 'n1')!.y).toBe(126);
    expect(root.y).toBe(180);
    expect(root.x).toBe(140);
  });

  it('assigns each first-level branch its own color, inherited by descendants', () => {
    const model = parseMindmap(ctx(mindmapDb));
    const b0 = model.nodes.find((n) => n.id === 'n1')!;
    const b1 = model.nodes.find((n) => n.id === 'n2')!;
    // first-level branches take distinct soft fills
    expect(b0.data?.color).toBeTruthy();
    expect(b1.data?.color).toBeTruthy();
    expect(b0.data?.color).not.toBe(b1.data?.color);
    // descendants inherit their branch fill
    expect(model.nodes.find((n) => n.id === 'n3')!.data?.color).toBe(b0.data?.color);
    expect(model.nodes.find((n) => n.id === 'n4')!.data?.color).toBe(b0.data?.color);
    // every edge of a branch carries that branch's line color
    const edgeColor = (target: string): unknown =>
      model.edges.find((e) => e.target === target)?.data?.color;
    expect(edgeColor('n1')).toBeTruthy();
    expect(edgeColor('n1')).toBe(edgeColor('n3'));
    expect(edgeColor('n1')).toBe(edgeColor('n4'));
    expect(edgeColor('n2')).toBeTruthy();
    expect(edgeColor('n2')).not.toBe(edgeColor('n1'));
  });

  it('serializes an indented tree with type wrappers', () => {
    const src = serializeMindmap(parseMindmap(ctx(mindmapDb)));
    expect(src).toContain('mindmap');
    expect(src).toContain('  root((产品规划))');
    expect(src).toContain('    功能');
    expect(src).toContain('      [导出]');
    expect(src).toContain('      导入');
    expect(src).toContain('    (设计)');
  });

  it('attaches canvas-added orphan nodes under the root', () => {
    const model = parseMindmap(ctx(mindmapDb));
    model.nodes.push({
      id: 'extra',
      label: '新想法',
      shape: 'round',
      x: 0,
      y: 0,
      width: 80,
      height: 44,
    });
    const src = serializeMindmap(model);
    expect(src).toContain('    新想法');
  });

  // ---- official-shape parity: cloud )x( / bang ))x(( / hexagon {{x}} / icon ----

  const shapeTree = {
    id: 0,
    nodeId: 'Root',
    level: 0,
    descr: 'Root',
    type: 5,
    isRoot: true,
    children: [
      { id: 1, nodeId: '云', level: 1, descr: '云', type: 4, children: [] },
      { id: 2, nodeId: '爆炸', level: 1, descr: '爆炸', type: 5, children: [] },
      { id: 3, nodeId: '六边形', level: 1, descr: '六边形', type: 6, children: [] },
      {
        id: 4,
        nodeId: '图标',
        level: 1,
        descr: '图标',
        type: 0,
        icon: 'fa fa-book',
        class: 'urgent',
        children: [],
      },
    ],
  };
  const shapeDb = { getMindmap: () => shapeTree };

  it('parses cloud/bang/hexagon types, mapping hexagon to a stadium', () => {
    const model = parseMindmap(ctx(shapeDb));
    const at = (id: string) => model.nodes.find((n) => n.id === id)!;
    expect(at('n1').data?.mmType).toBe(4);
    expect(at('n2').data?.mmType).toBe(5);
    const hex = at('n3');
    expect(hex.data?.mmType).toBe(6);
    expect(hex.shape).toBe('stadium'); // no hexagon primitive; type kept in data
  });

  it('round-trips cloud/bang/hexagon bracket syntax on serialize', () => {
    const src = serializeMindmap(parseMindmap(ctx(shapeDb)));
    expect(src).toContain('  root))Root((');
    expect(src).toContain('    )云(');
    expect(src).toContain('    ))爆炸((');
    expect(src).toContain('    {{六边形}}');
  });

  it('survives icon/class node metadata and omits it on serialize', () => {
    const model = parseMindmap(ctx(shapeDb));
    const icon = model.nodes.find((n) => n.id === 'n4')!;
    expect(icon.label).toBe('图标');
    const src = serializeMindmap(model);
    expect(src).toContain('    图标');
    expect(src).not.toContain('::icon');
    expect(src).not.toContain('fa fa-book');
  });
});

// ---------------------------------------------------------------------------
// mindmap layout / reparent (pure helpers used by the interactive editor)
// ---------------------------------------------------------------------------

function mmNode(id: string): DiagramNode {
  return { id, label: id, shape: 'round', x: 0, y: 0, width: 90, height: 44 };
}

/** root → (a → a1, a2) + (b) — built by hand, no mermaid db involved. */
function handMadeMindmap(): DiagramModel {
  return {
    kind: 'mindmap',
    direction: 'LR',
    nodes: [mmNode('root'), mmNode('a'), mmNode('a1'), mmNode('a2'), mmNode('b')],
    edges: [
      { id: 'e0', source: 'root', target: 'a', kind: 'open' },
      { id: 'e1', source: 'a', target: 'a1', kind: 'open' },
      { id: 'e2', source: 'a', target: 'a2', kind: 'open' },
      { id: 'e3', source: 'root', target: 'b', kind: 'open' },
    ],
  };
}

describe('layoutMindmap', () => {
  it('places x by depth, stacks leaves and centers parents on their children', () => {
    const model = handMadeMindmap();
    layoutMindmap(model);
    const at = (id: string) => model.nodes.find((n) => n.id === id)!;

    // x = 140 + depth * 240 (root has no incoming edge → depth 0)
    expect(at('root').x).toBe(140);
    expect(at('a').x).toBe(140 + 240);
    expect(at('b').x).toBe(140 + 240);
    expect(at('a1').x).toBe(140 + 2 * 240);
    expect(at('a2').x).toBe(140 + 2 * 240);

    // leaves stack in preorder 72px apart starting at 90
    expect(at('a1').y).toBe(90);
    expect(at('a2').y).toBe(162);
    expect(at('b').y).toBe(234);
    // parents sit at the mean y of their children
    expect(at('a').y).toBe((90 + 162) / 2);
    expect(at('root').y).toBe((at('a').y + at('b').y) / 2);
  });

  it('is a pure relayout: running twice yields identical coordinates', () => {
    const model = handMadeMindmap();
    layoutMindmap(model);
    const snapshot = model.nodes.map((n) => [n.id, n.x, n.y]);
    layoutMindmap(model);
    expect(model.nodes.map((n) => [n.id, n.x, n.y])).toEqual(snapshot);
  });
});

describe('reparent', () => {
  it('re-hangs a node (with its subtree) under the new parent', () => {
    const model = handMadeMindmap();
    expect(reparent(model, 'b', 'a1')).toBe(true);
    const eb = model.edges.find((e) => e.target === 'b')!;
    expect(eb.source).toBe('a1');
    // subtree edges under a stay untouched
    expect(model.edges.find((e) => e.target === 'a1')!.source).toBe('a');
    expect(model.edges.find((e) => e.target === 'a2')!.source).toBe('a');
    // layout after the move: b is now at depth 3
    layoutMindmap(model);
    expect(model.nodes.find((n) => n.id === 'b')!.x).toBe(140 + 3 * 240);
  });

  it('moves a whole subtree and the branch colors follow', () => {
    const model = handMadeMindmap();
    mindmapBranchColors(model);
    const color = (id: string) => model.nodes.find((n) => n.id === id)!.data?.color;
    expect(color('a')).not.toBe(color('b'));

    // move the a-subtree under b → a, a1, a2 all adopt b's branch color
    expect(reparent(model, 'a', 'b')).toBe(true);
    mindmapBranchColors(model);
    expect(color('a')).toBe(color('b'));
    expect(color('a1')).toBe(color('b'));
    expect(color('a2')).toBe(color('b'));
    const edgeColor = (target: string) =>
      model.edges.find((e) => e.target === target)!.data?.color;
    expect(edgeColor('a')).toBe(edgeColor('b'));
    expect(edgeColor('a1')).toBe(edgeColor('b'));
  });

  it('refuses cycles, self, root and no-op moves', () => {
    const model = handMadeMindmap();
    const before = JSON.stringify(model.edges);
    // new parent inside the child's own subtree → cycle
    expect(reparent(model, 'a', 'a1')).toBe(false);
    expect(reparent(model, 'a', 'a2')).toBe(false);
    // self, root (no incoming edge), already-parent, unknown ids
    expect(reparent(model, 'a', 'a')).toBe(false);
    expect(reparent(model, 'root', 'a1')).toBe(false);
    expect(reparent(model, 'a1', 'a')).toBe(false);
    expect(reparent(model, 'ghost', 'a')).toBe(false);
    expect(reparent(model, 'a', 'ghost')).toBe(false);
    expect(JSON.stringify(model.edges)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// gitgraph
// ---------------------------------------------------------------------------

const gitCommits = [
  { id: 'init', message: '', seq: 0, type: 0, tags: [], parents: [], branch: 'main' },
  { id: 'feat', message: '', seq: 1, type: 0, tags: ['v1'], parents: ['init'], branch: 'dev' },
  {
    id: '2-3684019',
    message: 'merged branch dev into main',
    seq: 2,
    parents: ['init', 'feat'],
    branch: 'main',
    type: 3,
    customId: false,
    tags: [],
  },
];

const gitDb = {
  getCommitsArray: () => gitCommits,
  getBranchesAsObjArray: () => [{ name: 'main' }, { name: 'dev' }],
  getDirection: () => 'LR',
};

describe('gitgraph plugin', () => {
  it('parses commits as circles on branch lanes and parents as arrow edges', () => {
    const model = parseGitgraph(ctx(gitDb));
    expect(model.kind).toBe('gitgraph');
    expect(model.direction).toBe('LR');
    const commits = model.nodes.filter((n) => n.data?.role !== 'decoration');
    expect(commits).toHaveLength(3);
    expect(model.edges).toHaveLength(3);
    expect(model.meta?.branches).toEqual(['main', 'dev']);

    const init = model.nodes.find((n) => n.id === 'init')!;
    expect(init.shape).toBe('circle');
    expect(init.x).toBe(110);
    expect(init.y).toBe(90); // main lane

    const feat = model.nodes.find((n) => n.id === 'feat')!;
    expect(feat.y).toBe(200); // dev lane
    expect(feat.data?.tags).toEqual(['v1']);

    // one color per branch: dots take the soft hue, edges the full hue
    expect(init.data?.color).toBeTruthy();
    expect(feat.data?.color).toBeTruthy();
    expect(init.data?.color).not.toBe(feat.data?.color);
    const toFeat = model.edges.find((e) => e.target === 'feat')!;
    const toMerge = model.edges.filter((e) => e.target === '2-3684019');
    expect(toFeat.data?.color).toBeTruthy();
    expect(toMerge[0]!.data?.color).toBeTruthy();
    expect(toFeat.data?.color).not.toBe(toMerge[0]!.data?.color); // dev vs main hues

    // merge commit has two incoming edges and renders as a diamond
    expect(toMerge).toHaveLength(2);
    expect(toMerge.map((e) => e.source).sort()).toEqual(['feat', 'init']);
    const merge = model.nodes.find((n) => n.id === '2-3684019')!;
    expect(merge.data?.isMerge).toBe(true);
    expect(merge.shape).toBe('diamond');
    expect(merge.width).toBe(40);
    expect(merge.height).toBe(40);
    expect(merge.label.length).toBeLessThanOrEqual(12);
  });

  it('adds locked lane band + branch label decorations under the commits', () => {
    const model = parseGitgraph(ctx(gitDb));
    const band = model.nodes.find((n) => n.id === 'lane-main')!;
    expect(band.shape).toBe('rect');
    expect(band.height).toBe(64);
    expect(band.y).toBe(90);
    // spans main's commits (x 110..410) plus 80px margin each side
    expect(band.x).toBe(260);
    expect(band.width).toBe(460);
    expect(band.data?.locked).toBe(true);
    expect(band.data?.role).toBe('decoration');

    const label = model.nodes.find((n) => n.id === 'lane-dev-label')!;
    expect(label.shape).toBe('text');
    expect(label.label).toBe('dev');
    expect(label.y).toBe(200);
    expect(label.data?.bold).toBe(true);
    expect(label.data?.locked).toBe(true);

    // decorations are pushed before any commit node (rendered underneath)
    const firstCommitIdx = model.nodes.findIndex((n) => n.data?.role !== 'decoration');
    const lastDecoIdx = model.nodes.reduce(
      (acc, n, i) => (n.data?.role === 'decoration' ? i : acc),
      -1,
    );
    expect(lastDecoIdx).toBeLessThan(firstCommitIdx);
  });

  it('serializes branch / checkout / commit / merge command sequence', () => {
    const src = serializeGitgraph(parseGitgraph(ctx(gitDb)));
    const lines = src.split('\n');
    expect(lines[0]).toBe('gitGraph');
    expect(src).toContain('    commit id: "init"');
    expect(src).toContain('    branch dev');
    expect(src).toContain('    commit id: "feat" tag: "v1"');
    expect(src).toContain('    checkout main');
    expect(src).toContain('    merge dev');
    // merge commit is replayed as a merge command, not a commit
    expect(src).not.toContain('2-3684019');
    // command order matters
    expect(lines.indexOf('    branch dev')).toBeLessThan(lines.indexOf('    checkout main'));
    expect(lines.indexOf('    checkout main')).toBeLessThan(lines.indexOf('    merge dev'));
  });

  it('keeps lane decorations out of the serialized command sequence', () => {
    const src = serializeGitgraph(parseGitgraph(ctx(gitDb)));
    expect(src).not.toContain('lane-');
    // exactly the two real commits are replayed (merge becomes a merge command)
    expect(src.match(/commit id:/g)).toHaveLength(2);
  });

  // ---- official-syntax parity: tag decoration, commit types, cherry-pick, custom main ----

  it('adds a locked tag text decoration above tagged commits', () => {
    const model = parseGitgraph(ctx(gitDb));
    const tag = model.nodes.find((n) => n.id === 'tag-feat')!;
    expect(tag.shape).toBe('text');
    expect(tag.label).toBe('🏷 v1');
    expect(tag.y).toBe(200 - 36); // 36px above the feat commit on the dev lane
    expect(tag.x).toBe(model.nodes.find((n) => n.id === 'feat')!.x);
    expect(tag.data?.role).toBe('decoration');
    expect(tag.data?.locked).toBe(true);
    expect(tag.data?.fontSize).toBe(11);
    // decoration never leaks into the serialized command sequence
    expect(serializeGitgraph(model)).not.toContain('🏷');
  });

  const typedCommits = [
    { id: 'c0', message: '', seq: 0, type: 0, tags: [], parents: [], branch: 'main' },
    { id: 'hot', message: '', seq: 1, type: 2, tags: ['v2'], parents: ['c0'], branch: 'main' },
    { id: 'rev', message: '', seq: 2, type: 1, tags: [], parents: ['hot'], branch: 'main' },
    // cherry-pick-created commit (type 4): must parse without crashing
    { id: 'cp', message: '', seq: 3, type: 4, tags: [], parents: ['rev'], branch: 'main' },
  ];
  const typedDb = {
    getCommitsArray: () => typedCommits,
    getBranchesAsObjArray: () => [{ name: 'main' }],
    getDirection: () => 'LR',
  };

  it('parses HIGHLIGHT/REVERSE commit types with their visual treatment', () => {
    const model = parseGitgraph(ctx(typedDb));
    const at = (id: string) => model.nodes.find((n) => n.id === id)!;
    expect(at('c0').data?.commitType).toBeUndefined();
    // HIGHLIGHT: commitType kept, amber fill instead of the branch hue
    expect(at('hot').data?.commitType).toBe(2);
    expect(at('hot').data?.color).toBeTruthy();
    expect(at('hot').data?.color).not.toBe(at('c0').data?.color);
    // REVERSE: commitType kept, ✕ label prefix
    expect(at('rev').data?.commitType).toBe(1);
    expect(at('rev').label.startsWith('✕ ')).toBe(true);
    // cherry-pick commit parses as a plain node
    expect(at('cp').shape).toBe('circle');
  });

  it('serializes type: HIGHLIGHT / REVERSE and keeps tag order', () => {
    const src = serializeGitgraph(parseGitgraph(ctx(typedDb)));
    expect(src).toContain('    commit id: "hot" type: HIGHLIGHT tag: "v2"');
    expect(src).toContain('    commit id: "rev" type: REVERSE');
    // untyped commits stay bare
    expect(src).toContain('    commit id: "c0"\n');
    // cherry-pick provenance is not tracked: replays as a plain commit
    expect(src).toContain('    commit id: "cp"');
    expect(src).not.toContain('cherry-pick');
  });

  it('handles a custom main branch name defensively', () => {
    const trunkDb = {
      getCommitsArray: () => [
        { id: 't0', message: '', seq: 0, type: 0, tags: [], parents: [], branch: 'trunk' },
        { id: 't1', message: '', seq: 1, type: 0, tags: [], parents: ['t0'], branch: 'trunk' },
      ],
      getBranchesAsObjArray: () => [{ name: 'trunk' }],
      getDirection: () => 'LR',
    };
    const model = parseGitgraph(ctx(trunkDb));
    expect(model.meta?.branches).toEqual(['trunk']);
    expect(model.nodes.filter((n) => n.data?.role !== 'decoration')).toHaveLength(2);
    const src = serializeGitgraph(model);
    expect(src).toContain('commit id: "t0"');
    expect(src).toContain('commit id: "t1"');
  });
});
