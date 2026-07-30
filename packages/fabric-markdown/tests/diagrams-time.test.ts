import { describe, it, expect } from 'vitest';
import { parseGantt, serializeGantt } from '../src/diagrams/gantt';
import { parseJourney, serializeJourney } from '../src/diagrams/journey';
import { parseTimeline, serializeTimeline } from '../src/diagrams/timeline';
import type { DiagramParseContext } from '../src/diagrams/registry';
import { paletteAt, paletteSoftAt, LINE, PAPER, PRIMARY_SOFT } from '../src/theme';

function ctx(db: Record<string, unknown>): DiagramParseContext {
  return { db, geometry: new Map() };
}

describe('gantt plugin', () => {
  const ganttDb = {
    getTasks: () => [
      {
        section: '设计',
        task: '原型 ',
        id: 'a1',
        order: 0,
        startTime: new Date('2026-01-01T00:00:00'),
        endTime: new Date('2026-01-06T00:00:00'),
        manualEndTime: false,
      },
      {
        section: '开发',
        task: '编码',
        id: 'b1',
        order: 1,
        startTime: new Date('2026-01-06T00:00:00'),
        endTime: new Date('2026-01-20T00:00:00'),
        manualEndTime: false,
      },
    ],
    getSections: () => ['设计', '开发'],
    getDateFormat: () => 'YYYY-MM-DD',
    getDiagramTitle: () => '项目排期',
  };

  it('parses tasks into rect nodes with date data', () => {
    const model = parseGantt(ctx(ganttDb));
    expect(model.kind).toBe('gantt');
    expect(model.direction).toBe('LR');
    expect(model.edges).toEqual([]);
    const taskNodes = model.nodes.filter((n) => n.data?.role === 'task');
    expect(taskNodes).toHaveLength(2);

    const [proto, code] = taskNodes as [import("../src/model").DiagramNode, import("../src/model").DiagramNode];
    expect(proto.label).toBe('原型');
    expect(proto.shape).toBe('rect');
    expect(proto.data).toMatchObject({
      section: '设计',
      taskId: 'a1',
      start: '2026-01-01',
      end: '2026-01-06',
      order: 0,
    });
    expect(code.label).toBe('编码');
    expect(code.data).toMatchObject({
      section: '开发',
      taskId: 'b1',
      start: '2026-01-06',
      end: '2026-01-20',
      order: 1,
    });
    // Second task starts 5 days after the origin, so it sits further right.
    expect(code.x).toBeGreaterThan(proto.x);
    expect(code.y).toBeGreaterThan(proto.y);

    expect(model.meta?.title).toBe('项目排期');
    expect(model.meta?.dateFormat).toBe('YYYY-MM-DD');
    expect(model.meta?.sections).toEqual(['设计', '开发']);
  });

  it('colors task bars by section rotation', () => {
    const model = parseGantt(ctx(ganttDb));
    const [proto, code] = model.nodes.filter((n) => n.data?.role === 'task');
    // Different sections → different palette slots (soft fill + strong stroke).
    expect(proto!.data).toMatchObject({ color: paletteSoftAt(0), stroke: paletteAt(0) });
    expect(code!.data).toMatchObject({ color: paletteSoftAt(1), stroke: paletteAt(1) });
    expect(proto!.data?.color).not.toBe(code!.data?.color);
  });

  it('emits time-scale ticks, gridlines and section labels as locked decorations', () => {
    const model = parseGantt(ctx(ganttDb));
    const decorations = model.nodes.filter((n) => n.data?.role === 'decoration');
    expect(decorations.length).toBeGreaterThan(0);
    for (const d of decorations) expect(d.data?.locked).toBe(true);

    // 19-day span → weekly ticks at 01-01, 01-08, 01-15 (MM-DD text labels).
    const ticks = decorations.filter((n) => n.shape === 'text' && /^\d{2}-\d{2}$/.test(n.label));
    expect(ticks.map((n) => n.label)).toEqual(['01-01', '01-08', '01-15']);
    // Each tick pairs with a thin vertical gridline at the same x.
    const grids = decorations.filter((n) => n.shape === 'rect');
    expect(grids).toHaveLength(ticks.length);
    expect(grids.map((g) => g.x)).toEqual(ticks.map((t) => t.x));
    // Section group labels sit on the left, bold, in the section's color.
    const labels = decorations.filter((n) => n.shape === 'text' && n.data?.bold);
    expect(labels.map((n) => n.label)).toEqual(['设计', '开发']);
    expect(labels[0]!.data).toMatchObject({ align: 'left', color: paletteAt(0) });
    expect(labels[1]!.data).toMatchObject({ color: paletteAt(1) });
  });

  it('serializes back to gantt source from data/meta', () => {
    const src = serializeGantt(parseGantt(ctx(ganttDb)));
    expect(src).toContain('gantt');
    expect(src).toContain('title 项目排期');
    expect(src).toContain('dateFormat YYYY-MM-DD');
    expect(src).toContain('section 设计');
    expect(src).toContain('section 开发');
    expect(src).toContain('原型 :a1, 2026-01-01, 2026-01-06');
    expect(src).toContain('编码 :b1, 2026-01-06, 2026-01-20');
  });

  it('never serializes decoration nodes (ticks/gridlines/labels)', () => {
    const src = serializeGantt(parseGantt(ctx(ganttDb)));
    // Exact output: decorations must leave no trace in the source.
    expect(src).toBe(
      [
        'gantt',
        '    title 项目排期',
        '    dateFormat YYYY-MM-DD',
        '    section 设计',
        '    原型 :a1, 2026-01-01, 2026-01-06',
        '    section 开发',
        '    编码 :b1, 2026-01-06, 2026-01-20',
      ].join('\n'),
    );
  });

  // Official task tags: milestone / crit / active / done + `after` deps.
  const taggedDb = {
    getTasks: () => [
      {
        section: '阶段',
        task: '关键任务',
        id: 'a1',
        order: 0,
        crit: true,
        done: true,
        startTime: new Date('2026-01-01T00:00:00'),
        endTime: new Date('2026-01-04T00:00:00'),
      },
      {
        section: '阶段',
        task: '进行中',
        id: 'a2',
        order: 1,
        active: true,
        startTime: new Date('2026-01-04T00:00:00'),
        endTime: new Date('2026-01-08T00:00:00'),
        raw: { startTime: { startData: 'after a1' } },
      },
      {
        section: '阶段',
        task: '里程碑',
        id: 'm1',
        order: 2,
        milestone: true,
        startTime: new Date('2026-01-08T00:00:00'),
        endTime: new Date('2026-01-08T00:00:00'),
      },
    ],
    getSections: () => ['阶段'],
    getDateFormat: () => 'YYYY-MM-DD',
    getDiagramTitle: () => '',
  };

  it('parses official task tags into data.flags with tag styling', () => {
    const model = parseGantt(ctx(taggedDb));
    const [critDone, active, milestone] = model.nodes.filter((n) => n.data?.role === 'task');

    // crit+done: red border, gray done fill + gray ink.
    expect(critDone!.data?.flags).toEqual(['crit', 'done']);
    expect(critDone!.data).toMatchObject({ stroke: '#f87171', color: '#e2e8f0' });
    expect(critDone!.data?.textColor).toBe('#94a3b8');

    // active: deepened section border (not the plain palette stroke).
    expect(active!.data?.flags).toEqual(['active']);
    expect(active!.data?.stroke).not.toBe(paletteAt(0));
    // `after a1` raw start token is preserved for serialization.
    expect(active!.data?.rawStart).toBe('after a1');

    // milestone: small diamond centered on its date point.
    expect(milestone!.data?.flags).toEqual(['milestone']);
    expect(milestone!.shape).toBe('diamond');
    expect(milestone!.width).toBe(28);
    expect(milestone!.height).toBe(28);
    // 7 days after origin at 26 px/day, LEFT=180 → x = 180 + 7*26 = 362.
    expect(milestone!.x).toBe(362);
  });

  it('serializes tags in official order and restores `after` starts', () => {
    const src = serializeGantt(parseGantt(ctx(taggedDb)));
    expect(src).toContain('关键任务 :crit, done, a1, 2026-01-01, 2026-01-04');
    expect(src).toContain('进行中 :active, a2, after a1, 2026-01-08');
    expect(src).toContain('里程碑 :milestone, m1, 2026-01-08, 2026-01-08');
  });

  it('still serializes legacy task nodes without a role field', () => {
    const model = parseGantt(ctx(ganttDb));
    // Simulate pre-role data: strip role from task nodes, drop decorations.
    const legacy = {
      ...model,
      nodes: model.nodes
        .filter((n) => n.data?.role === 'task')
        .map((n) => ({ ...n, data: { ...n.data, role: undefined } })),
    };
    const src = serializeGantt(legacy);
    expect(src).toContain('原型 :a1, 2026-01-01, 2026-01-06');
    expect(src).toContain('编码 :b1, 2026-01-06, 2026-01-20');
  });
});

describe('journey plugin', () => {
  const journeyDb = {
    getTasks: () => [
      { section: '浏览', people: ['用户'], task: '搜索商品', score: 5 },
      { section: '浏览', people: ['用户'], task: '查看详情', score: 3 },
      { section: '购买', people: ['用户', '系统'], task: '下单', score: 4 },
    ],
    getSections: () => ['浏览', '购买'],
    getDiagramTitle: () => '购物旅程',
  };

  it('parses tasks into round nodes with score/people data', () => {
    const model = parseJourney(ctx(journeyDb));
    expect(model.kind).toBe('journey');
    expect(model.edges).toEqual([]);
    const taskNodes = model.nodes.filter((n) => n.data?.role === 'task');
    expect(taskNodes).toHaveLength(3);

    // Cards display name + score/actors; data.task keeps the raw name.
    expect(taskNodes.map((n) => String(n.data?.task))).toEqual(['搜索商品', '查看详情', '下单']);
    expect(taskNodes[0]!.label).toBe('😀 搜索商品\n⭐ 5 · 用户');
    expect(taskNodes[0]!.shape).toBe('round');
    // Task cards use the compact card font size.
    expect(taskNodes[0]!.data?.fontSize).toBe(12.5);
    // Section headers + title render as decoration nodes; pills rotate soft palette.
    const sectionNodes = model.nodes.filter((n) => n.data?.role === 'section');
    expect(sectionNodes.map((n) => n.label)).toEqual(['浏览', '购买']);
    expect(sectionNodes[0]!.data?.color).toBe(paletteSoftAt(0));
    expect(sectionNodes[1]!.data?.color).toBe(paletteSoftAt(1));
    expect(model.nodes.find((n) => n.data?.role === 'title')?.label).toBe('购物旅程');
    expect(taskNodes[0]!.data).toMatchObject({
      section: '浏览',
      score: 5,
      people: ['用户'],
      order: 0,
    });
    expect(taskNodes[2]!.data).toMatchObject({
      section: '购买',
      score: 4,
      people: ['用户', '系统'],
      order: 2,
    });
    // Tasks flow left to right at a fixed row.
    expect(taskNodes[1]!.x).toBeGreaterThan(taskNodes[0]!.x);
    expect(taskNodes[1]!.y).toBe(taskNodes[0]!.y);

    expect(model.meta?.title).toBe('购物旅程');
    expect(model.meta?.sections).toEqual(['浏览', '购买']);
  });

  it('serializes back to journey source from data/meta', () => {
    const src = serializeJourney(parseJourney(ctx(journeyDb)));
    expect(src).toContain('journey');
    expect(src).toContain('title 购物旅程');
    expect(src).toContain('section 浏览');
    expect(src).toContain('section 购买');
    expect(src).toContain('搜索商品: 5: 用户');
    expect(src).toContain('查看详情: 3: 用户');
    expect(src).toContain('下单: 4: 用户, 系统');
  });

  it('prefixes cards with a score face like official smileys', () => {
    const model = parseJourney(ctx(journeyDb));
    const taskNodes = model.nodes.filter((n) => n.data?.role === 'task');
    // score 5 → 😀, score 3 → 😐, score 4 → 😀
    expect(taskNodes.map((n) => n.label.split(' ')[0])).toEqual(['😀', '😐', '😀']);
    const lowDb = {
      ...journeyDb,
      getTasks: () => [{ section: '', people: [], task: '退货', score: 1 }],
    };
    const low = parseJourney(ctx(lowDb)).nodes.find((n) => n.data?.role === 'task');
    expect(low!.label.startsWith('☹️')).toBe(true);
  });

  it('keeps face emoji out of the serialized source (data.task stays pure)', () => {
    const src = serializeJourney(parseJourney(ctx(journeyDb)));
    expect(src).not.toMatch(/😀|😐|☹️/u);
    expect(src).toContain('搜索商品: 5: 用户');
    // Legacy fallback: even without data.task, the face prefix is stripped.
    const model = parseJourney(ctx(journeyDb));
    for (const n of model.nodes) if (n.data) delete n.data.task;
    const legacySrc = serializeJourney(model);
    expect(legacySrc).not.toMatch(/😀|😐|☹️/u);
    expect(legacySrc).toContain('搜索商品: 5: 用户');
  });
});

describe('timeline plugin', () => {
  const timelineDb = {
    getTasks: () => [
      { id: 3, section: '', task: '2023 ', score: 0, events: ['立项'] },
      { id: 4, section: '', task: '2024 ', events: ['上线 ', '融资'] },
      { id: 5, section: '', task: '2025 ', events: ['出海'] },
    ],
    getCommonDb: () => ({ getDiagramTitle: () => '发展史' }),
  };

  it('parses periods and events into separate nodes', () => {
    const model = parseTimeline(ctx(timelineDb));
    expect(model.kind).toBe('timeline');
    // Time-flow arrows between periods (2) + fan lines to events (4).
    expect(model.edges.filter((e) => e.kind === 'arrow')).toHaveLength(2);
    expect(model.edges.filter((e) => e.kind === 'open')).toHaveLength(4);
    // 3 periods + 4 events (+ title / axis decorations)
    expect(
      model.nodes.filter((n) => n.data?.role === 'period' || n.data?.role === 'event'),
    ).toHaveLength(7);

    const periods = model.nodes.filter((n) => n.data?.role === 'period');
    const events = model.nodes.filter((n) => n.data?.role === 'event');
    expect(periods.map((n) => n.label)).toEqual(['2023', '2024', '2025']);
    expect(periods[0]!.shape).toBe('stadium');
    // Milestone pills share the primary-soft fill and a larger label.
    expect(periods.map((n) => n.data?.color)).toEqual([
      PRIMARY_SOFT,
      PRIMARY_SOFT,
      PRIMARY_SOFT,
    ]);
    expect(periods[0]!.data?.fontSize).toBe(15);
    expect(events.map((n) => n.label)).toEqual(['立项', '上线', '融资', '出海']);
    expect(events[0]!.shape).toBe('rect');
    // Event cards are white with a soft line border.
    expect(events[0]!.data).toMatchObject({ color: PAPER, stroke: LINE });
    expect(events[1]!.data).toMatchObject({ period: '2024', order: 1, eventOrder: 0 });
    expect(events[2]!.data).toMatchObject({ period: '2024', order: 1, eventOrder: 1 });
    // Events share their period's x column.
    expect(events[1]!.x).toBe(periods[1]!.x);

    expect(model.meta?.title).toBe('发展史');
    expect(model.meta?.sections).toEqual([]);
  });

  it('lays out a center axis with milestone pills on it', () => {
    const model = parseTimeline(ctx(timelineDb));
    const periods = model.nodes.filter((n) => n.data?.role === 'period');
    // All period pills sit exactly on the axis line.
    expect(new Set(periods.map((n) => n.y)).size).toBe(1);
    const axisY = periods[0]!.y;

    // The axis is a locked decoration bar spanning all periods.
    const axis = model.nodes.find((n) => n.id === 'timeline-axis');
    expect(axis).toBeDefined();
    expect(axis!.data).toMatchObject({ role: 'decoration', locked: true, color: '#94a3b8' });
    expect(axis!.shape).toBe('rect');
    expect(axis!.height).toBe(4);
    expect(axis!.y).toBe(axisY);
    // Bar spans from left of the first pill to past the last pill.
    expect(axis!.x - axis!.width / 2).toBeLessThan(periods[0]!.x - periods[0]!.width / 2);
    expect(axis!.x + axis!.width / 2).toBeGreaterThan(periods[2]!.x + periods[2]!.width / 2);

    // Title stays a locked text node at the top, centered on the axis span.
    const title = model.nodes.find((n) => n.data?.role === 'title');
    expect(title).toBeDefined();
    expect(title!.shape).toBe('text');
    expect(title!.y).toBe(40);
    expect(title!.x).toBe(axis!.x);
    expect(title!.data).toMatchObject({ locked: true, bold: true });
  });

  it('alternates event cards above/below the axis and fans them from their period', () => {
    const model = parseTimeline(ctx(timelineDb));
    const periods = model.nodes.filter((n) => n.data?.role === 'period');
    const events = model.nodes.filter((n) => n.data?.role === 'event');
    const axisY = periods[0]!.y;

    // Even periods hang cards above the axis, odd periods below.
    expect(events[0]!.y).toBeLessThan(axisY); // 2023 (i=0): above
    expect(events[1]!.y).toBeGreaterThan(axisY); // 2024 (i=1): below
    expect(events[2]!.y).toBeGreaterThan(axisY);
    expect(events[3]!.y).toBeLessThan(axisY); // 2025 (i=2): above
    // Stacked cards of one period step further away from the axis.
    expect(events[2]!.y).toBeGreaterThan(events[1]!.y);

    // Every event card connects directly to its own period pill (no chains).
    const fans = model.edges.filter((e) => e.kind === 'open');
    expect(fans.map((e) => [e.source, e.target])).toEqual([
      ['period0', 'event0_0'],
      ['period1', 'event1_0'],
      ['period1', 'event1_1'],
      ['period2', 'event2_0'],
    ]);
    for (const e of fans) {
      expect(e.data).toMatchObject({ color: '#94a3b8', straight: true });
    }
  });

  it('serializes back to timeline source from data/meta', () => {
    const src = serializeTimeline(parseTimeline(ctx(timelineDb)));
    expect(src).toContain('timeline');
    expect(src).toContain('title 发展史');
    expect(src).toContain('2023 : 立项');
    expect(src).toContain('2024 : 上线 : 融资');
    expect(src).toContain('2025 : 出海');
    expect(src).not.toContain('section');
  });

  it('never serializes axis/title decorations or edges', () => {
    const src = serializeTimeline(parseTimeline(ctx(timelineDb)));
    // Exact output: only title + period lines, rebuilt from data/meta.
    expect(src).toBe(
      [
        'timeline',
        '    title 发展史',
        '    2023 : 立项',
        '    2024 : 上线 : 融资',
        '    2025 : 出海',
      ].join('\n'),
    );
  });

  it('rotates period pill colors per section (official section coloring)', () => {
    const sectionedDb = {
      getTasks: () => [
        { section: '创业期', task: '2023', events: ['立项'] },
        { section: '创业期', task: '2024', events: ['上线'] },
        { section: '成长期', task: '2025', events: ['出海'] },
      ],
      getCommonDb: () => ({ getDiagramTitle: () => '' }),
    };
    const model = parseTimeline(ctx(sectionedDb));
    const periods = model.nodes.filter((n) => n.data?.role === 'period');
    // Same section → same soft tint; next section rotates the palette.
    expect(periods[0]!.data?.color).toBe(paletteSoftAt(0));
    expect(periods[1]!.data?.color).toBe(paletteSoftAt(0));
    expect(periods[2]!.data?.color).toBe(paletteSoftAt(1));
    expect(model.meta?.sections).toEqual(['创业期', '成长期']);

    // Sections still round-trip in the serialized source.
    const src = serializeTimeline(model);
    expect(src).toContain('section 创业期');
    expect(src).toContain('section 成长期');
    expect(src).toContain('2025 : 出海');

    // No sections → uniform primary-soft pills (unchanged default).
    const plain = parseTimeline(ctx(timelineDb));
    for (const p of plain.nodes.filter((n) => n.data?.role === 'period')) {
      expect(p.data?.color).toBe(PRIMARY_SOFT);
    }
  });
});
