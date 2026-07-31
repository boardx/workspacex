import { describe, it, expect } from 'vitest';
import { parsePie, serializePie } from '../src/diagrams/pie';
import { parseQuadrant, serializeQuadrant } from '../src/diagrams/quadrant';
import { parseXYChart, serializeXYChart } from '../src/diagrams/xychart';
import type { DiagramParseContext } from '../src/diagrams/registry';
import { PALETTE, PALETTE_SOFT, PRIMARY, PAPER } from '../src/theme';

function ctxWith(db: Record<string, unknown>): DiagramParseContext {
  return { db, geometry: new Map() };
}

describe('pie plugin', () => {
  const db = {
    getSections: () => new Map<string, number>([['A', 40], ['B', 35], ['C', 25]]),
    getDiagramTitle: () => '市场份额',
    getShowData: () => false,
  };

  it('parses sections into pie slices with data payloads', () => {
    const model = parsePie(ctxWith(db));
    expect(model.kind).toBe('pie');
    const slices = model.nodes.filter((n) => n.shape === 'pieSlice');
    expect(slices).toHaveLength(3);
    expect(model.edges).toHaveLength(0);
    expect(model.meta?.title).toBe('市场份额');
    expect(model.meta?.showData).toBe(false);
    expect(slices[0]!.label).toBe('A 40%');
    expect(slices[0]!.data).toMatchObject({ name: 'A', value: 40, order: 0, a1: 0 });
    // Slice angles are proportional and contiguous: A spans 40% of 2π.
    expect(Number(slices[0]!.data?.a2)).toBeCloseTo(Math.PI * 2 * 0.4, 5);
    expect(Number(slices[1]!.data?.a1)).toBeCloseTo(Math.PI * 2 * 0.4, 5);
    // All slices share the pie center.
    expect(slices[1]!.x).toBe(slices[0]!.x);
    expect(slices[1]!.y).toBe(slices[0]!.y);
    // The title renders as a locked text node.
    expect(model.nodes.find((n) => n.data?.role === 'title')?.label).toBe('市场份额');
    // Slices are tinted with the theme palette in section order.
    expect(slices[0]!.data?.color).toBe(PALETTE[0]);
    expect(slices[1]!.data?.color).toBe(PALETTE[1]);
  });

  it('renders a legend column (swatch + name value) per section', () => {
    const model = parsePie(ctxWith(db));
    const legend = model.nodes.filter((n) => n.data?.role === 'legend');
    // one rect swatch + one text label per section
    expect(legend).toHaveLength(6);
    const swatches = legend.filter((n) => n.shape === 'rect');
    const labels = legend.filter((n) => n.shape === 'text');
    expect(swatches).toHaveLength(3);
    expect(labels).toHaveLength(3);
    expect(swatches[0]!.data?.color).toBe(PALETTE[0]);
    expect(swatches[0]!.data?.locked).toBe(true);
    expect(labels[0]!.label).toBe('A 40');
    expect(labels[0]!.data?.align).toBe('left');
  });

  it('moves labels of narrow slices (< 0.35 rad) outside as draggable text', () => {
    const narrowDb = {
      ...db,
      getSections: () => new Map<string, number>([['大头', 90], ['小一', 5], ['小二', 5]]),
    };
    const model = parsePie(ctxWith(narrowDb));
    const slices = model.nodes.filter((n) => n.shape === 'pieSlice');
    // Wide slice keeps its inline label; narrow slices get an empty label.
    expect(slices[0]!.label).toBe('大头 90%');
    expect(slices[1]!.label).toBe('');
    expect(slices[2]!.label).toBe('');
    const outLabels = model.nodes.filter((n) => n.data?.role === 'sliceLabel');
    expect(outLabels).toHaveLength(2);
    expect(outLabels[0]!.label).toBe('小一 5%');
    // Not locked → draggable.
    expect(outLabels[0]!.data?.locked).toBeUndefined();
    // Positioned outside the pie radius (r=150, label at 1.18r from center 240,230).
    const dx = outLabels[0]!.x - 240;
    const dy = outLabels[0]!.y - 230;
    expect(Math.hypot(dx, dy)).toBeCloseTo(150 * 1.18, 1);
    // Tinted darker than the slice hue, derived from it (not the raw palette color).
    expect(outLabels[0]!.data?.color).not.toBe(slices[1]!.data?.color);
  });

  it('excludes legend and outside-label decorations from serialization', () => {
    const model = parsePie(ctxWith(db));
    const text = serializePie(model);
    const lines = text.split('\n');
    // header + exactly 3 data entries; no legend/title/sliceLabel lines
    expect(lines).toHaveLength(4);
    expect(lines.slice(1).every((l) => /^\s+"[ABC]" : \d+$/.test(l))).toBe(true);
  });

  it('parses plain-object sections too', () => {
    const model = parsePie(ctxWith({ ...db, getSections: () => ({ A: 40, B: 35, C: 25 }) }));
    const slices = model.nodes.filter((n) => n.shape === 'pieSlice');
    expect(slices).toHaveLength(3);
    expect(slices[2]!.data?.value).toBe(25);
  });

  it('serializes title and entries, without showData when false', () => {
    const model = parsePie(ctxWith(db));
    const text = serializePie(model);
    expect(text).toContain('pie title 市场份额');
    expect(text).toContain('"A" : 40');
    expect(text).toContain('"B" : 35');
    expect(text).toContain('"C" : 25');
    expect(text).not.toContain('showData');
  });

  it('emits showData when meta.showData is true', () => {
    const model = parsePie(ctxWith({ ...db, getShowData: () => true }));
    const text = serializePie(model);
    expect(text.split('\n')[0]).toBe('pie showData title 市场份额');
  });

  it('supports decimal values end to end (official pie accepts decimals)', () => {
    const decimalDb = {
      ...db,
      getSections: () => new Map<string, number>([['甲', 42.5], ['乙', 7.5]]),
    };
    const model = parsePie(ctxWith(decimalDb));
    const slices = model.nodes.filter((n) => n.shape === 'pieSlice');
    expect(slices[0]!.data?.value).toBe(42.5);
    // Angles stay proportional: 42.5/50 of the full circle.
    expect(Number(slices[0]!.data?.a2)).toBeCloseTo(Math.PI * 2 * 0.85, 5);
    const text = serializePie(model);
    expect(text).toContain('"甲" : 42.5');
    expect(text).toContain('"乙" : 7.5');
  });
});

describe('quadrant plugin', () => {
  const quadrantData = {
    title: '优先级',
    points: [
      { x: 355.8, y: 384.2, text: { text: '功能B' } },
      { x: 170.2, y: 129.8, text: { text: '功能A' } },
    ],
    quadrants: [
      { text: { text: '快赢' }, x: 263, y: 45, width: 232, height: 212 },
      { text: { text: '战略' }, x: 31, y: 45, width: 232, height: 212 },
      { text: { text: '放弃' }, x: 31, y: 257, width: 232, height: 212 },
      { text: { text: '鸡肋' }, x: 263, y: 257, width: 232, height: 212 },
    ],
    axisLabels: [
      { text: '低成本', x: 147, y: 479 },
      { text: '高成本', x: 379, y: 479 },
      { text: '低价值', x: 5, y: 363, rotation: -90 },
      { text: '高价值', x: 5, y: 151, rotation: -90 },
    ],
  };
  const db = { getQuadrantData: () => quadrantData };

  it('parses 4 quadrants + 2 points with normalized coordinates', () => {
    const model = parseQuadrant(ctxWith(db));
    expect(model.kind).toBe('quadrant');
    // 4 quadrants + 2 points; titles/axis labels are extra locked decorations.
    expect(
      model.nodes.filter((n) => n.data?.role === 'quadrant' || n.data?.role === 'point'),
    ).toHaveLength(6);

    const quads = model.nodes.filter((n) => n.data?.role === 'quadrant');
    expect(quads).toHaveLength(4);
    expect(quads[0]!.label).toBe('快赢');
    // Quadrant backgrounds use soft palette tints (green/sky/red/amber).
    expect(quads[0]!.data?.color).toBe(PALETTE_SOFT[2]);
    expect(quads[1]!.data?.color).toBe(PALETTE_SOFT[4]);
    expect(quads[2]!.data?.color).toBe(PALETTE_SOFT[5]);
    expect(quads[3]!.data?.color).toBe(PALETTE_SOFT[3]);

    const pointA = model.nodes.find((n) => n.data?.name === '功能A');
    expect(pointA).toBeDefined();
    // Points are 20px primary-colored dots with a white ring.
    expect(pointA!.width).toBe(20);
    expect(pointA!.height).toBe(20);
    expect(pointA!.data?.color).toBe(PRIMARY);
    expect(pointA!.data?.stroke).toBe(PAPER);
    expect(pointA!.data!.x as number).toBeCloseTo(0.3, 2);
    expect(pointA!.data!.y as number).toBeCloseTo(0.8, 2);
    // canvas position derives from the normalized coords
    expect(pointA!.x).toBeCloseTo(80 + 0.3 * 480, 1);
    expect(pointA!.y).toBeCloseTo(80 + 0.2 * 480, 1);

    expect(model.meta?.title).toBe('优先级');
    expect(model.meta?.xAxisLeft).toBe('低成本');
    expect(model.meta?.yAxisTop).toBe('高价值');
  });

  it('serializes title, axes, quadrants and points', () => {
    const model = parseQuadrant(ctxWith(db));
    const text = serializeQuadrant(model);
    expect(text).toContain('quadrantChart');
    expect(text).toContain('title 优先级');
    expect(text).toContain('x-axis 低成本 --> 高成本');
    expect(text).toContain('y-axis 低价值 --> 高价值');
    expect(text).toContain('quadrant-1 快赢');
    expect(text).toContain('quadrant-4 鸡肋');
    expect(text).toContain('功能A: [0.3, 0.8]');
    expect(text).toContain('功能B: [0.7, 0.2]');
  });

  it('re-derives point coordinates after the node is dragged on canvas', () => {
    const model = parseQuadrant(ctxWith(db));
    const pointA = model.nodes.find((n) => n.data?.name === '功能A')!;
    // drag to the center of the plot area (80..560 in both axes)
    pointA.x = 320;
    pointA.y = 320;
    const text = serializeQuadrant(model);
    expect(text).toContain('功能A: [0.5, 0.5]');
    expect(text).not.toContain('功能A: [0.3, 0.8]');
  });

  it('clamps dragged points outside the plot area to [0,1]', () => {
    const model = parseQuadrant(ctxWith(db));
    const pointB = model.nodes.find((n) => n.data?.name === '功能B')!;
    pointB.x = 900;
    pointB.y = -50;
    const text = serializeQuadrant(model);
    expect(text).toContain('功能B: [1, 1]');
  });

  it('tolerates classDef-styled points without crashing (styles ignored)', () => {
    const styled = {
      ...quadrantData,
      points: quadrantData.points.map((p) => ({
        ...p,
        // Official `classDef` / inline point styling adds these fields.
        className: 'hot',
        radius: 9,
        color: '#ff0000',
        strokeColor: '#000000',
        strokeWidth: '2px',
      })),
    };
    const model = parseQuadrant(ctxWith({ getQuadrantData: () => styled }));
    const points = model.nodes.filter((n) => n.data?.role === 'point');
    expect(points).toHaveLength(2);
    const text = serializeQuadrant(model);
    expect(text).toContain('功能A: [0.3, 0.8]');
    expect(text).not.toContain('classDef');
  });

  it('keeps a lone left x-axis label on the x axis (no index shifting)', () => {
    // Official `x-axis 低成本` alone: getQuadrantData only emits the labels
    // present, so [xLeft, yBottom, yTop] must not be read as [xLeft, xRight, …].
    const partial = {
      ...quadrantData,
      axisLabels: [
        { text: '低成本', x: 147, y: 479 },
        { text: '低价值', x: 5, y: 363, rotation: -90 },
        { text: '高价值', x: 5, y: 151, rotation: -90 },
      ],
    };
    const model = parseQuadrant(ctxWith({ getQuadrantData: () => partial }));
    expect(model.meta?.xAxisLeft).toBe('低成本');
    expect(model.meta?.xAxisRight).toBe('');
    expect(model.meta?.yAxisBottom).toBe('低价值');
    expect(model.meta?.yAxisTop).toBe('高价值');
    const text = serializeQuadrant(model);
    expect(text).toContain('x-axis 低成本');
    expect(text).not.toContain('x-axis 低成本 -->');
    expect(text).toContain('y-axis 低价值 --> 高价值');
  });
});

describe('xychart plugin', () => {
  const chartData = {
    title: '月度销量',
    xAxis: { type: 'band', title: '', categories: ['1月', '2月', '3月'] },
    yAxis: { type: 'linear', title: '销量', min: 0, max: 100 },
    plots: [
      { type: 'bar', data: [['1月', 30], ['2月', 65], ['3月', 80]] },
      { type: 'line', data: [['1月', 20], ['2月', 50], ['3月', 90]] },
    ],
  };
  const db = { getXYChartData: () => chartData };

  it('parses 2 series x 3 values plus 2 series labels = 8 nodes', () => {
    const model = parseXYChart(ctxWith(db));
    expect(model.kind).toBe('xychart');
    // Bars sized by value; line points connected by edges.
    const bars = model.nodes.filter((n) => n.data?.role === 'value' && n.data?.type === 'bar');
    const dots = model.nodes.filter((n) => n.data?.role === 'value' && n.data?.type === 'line');
    expect(bars).toHaveLength(3);
    expect(dots).toHaveLength(3);
    // Bar height proportional to value (yMax 100 → 80 maps taller than 30).
    expect(bars[2]!.height).toBeGreaterThan(bars[0]!.height);
    // Line dots are linked in category order.
    expect(model.edges).toHaveLength(2);
    expect(model.edges[0]!.source).toContain('val-1-0');

    const valueNodes = model.nodes.filter((n) => n.data?.role === 'value');
    expect(valueNodes).toHaveLength(6);
    const bar2 = valueNodes.find((n) => n.data?.plot === 0 && n.data?.cat === '2月');
    expect(bar2?.data?.value).toBe(65);
    expect(bar2?.label).toBe('65');

    expect(model.meta?.categories).toEqual(['1月', '2月', '3月']);
    expect(model.meta?.yMax).toBe(100);
  });

  it('styles bars with palette fill + darker stroke, line dots as white-core rings', () => {
    const model = parseXYChart(ctxWith(db));
    const bars = model.nodes.filter((n) => n.data?.role === 'value' && n.data?.type === 'bar');
    expect(bars[0]!.data?.color).toBe(PALETTE[0]);
    expect(typeof bars[0]!.data?.stroke).toBe('string');
    expect(bars[0]!.data?.stroke).not.toBe(bars[0]!.data?.color);

    const dots = model.nodes.filter((n) => n.data?.role === 'value' && n.data?.type === 'line');
    expect(dots[0]!.data?.color).toBe(PAPER);
    expect(dots[0]!.data?.stroke).toBe(PALETTE[1]);
  });

  it('draws 3 horizontal gridlines before the value nodes', () => {
    const model = parseXYChart(ctxWith(db));
    const grid = model.nodes.filter((n) => n.data?.role === 'grid');
    expect(grid).toHaveLength(3);
    expect(grid.every((n) => n.data?.locked === true && n.shape === 'rect')).toBe(true);
    // Evenly spaced at 1/4, 2/4, 3/4 of the 260px-high plot (baseline 350).
    const ys = grid.map((n) => n.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeCloseTo(65, 5);
    expect(ys[2]! - ys[1]!).toBeCloseTo(65, 5);
    // Gridlines are pushed before every value node so bars render on top.
    const firstValueIdx = model.nodes.findIndex((n) => n.data?.role === 'value');
    const lastGridIdx = model.nodes.map((n) => n.data?.role).lastIndexOf('grid');
    expect(lastGridIdx).toBeLessThan(firstValueIdx);
  });

  it('renders a series legend (swatch + type name) per plot', () => {
    const model = parseXYChart(ctxWith(db));
    const legend = model.nodes.filter((n) => n.data?.role === 'legend');
    expect(legend).toHaveLength(4);
    const swatches = legend.filter((n) => n.shape === 'rect');
    const labels = legend.filter((n) => n.shape === 'text');
    expect(swatches.map((n) => n.data?.color)).toEqual([PALETTE[0], PALETTE[1]]);
    expect(labels.map((n) => n.label)).toEqual(['bar', 'line']);
    expect(legend.every((n) => n.data?.locked === true)).toBe(true);
  });

  it('excludes grid/legend decorations from serialization', () => {
    const model = parseXYChart(ctxWith(db));
    const text = serializeXYChart(model);
    const plotLines = text.split('\n').filter((l) => /^\s+(bar|line) \[/.test(l));
    expect(plotLines).toEqual(['    bar [30, 65, 80]', '    line [20, 50, 90]']);
  });

  it('serializes title, axes and plot lines', () => {
    const model = parseXYChart(ctxWith(db));
    const text = serializeXYChart(model);
    expect(text).toContain('xychart-beta');
    expect(text).toContain('title "月度销量"');
    expect(text).toContain('x-axis ["1月", "2月", "3月"]');
    expect(text).toContain('y-axis "销量" 0 --> 100');
    expect(text).toContain('bar [30, 65, 80]');
    expect(text).toContain('line [20, 50, 90]');
  });

  it('derives categories from plot data when the x-axis is linear', () => {
    const linear = {
      ...chartData,
      xAxis: { type: 'linear', title: '', min: 1, max: 3 },
      plots: [{ type: 'line', data: [[1, 10], [2, 20], [3, 30]] }],
    };
    const model = parseXYChart(ctxWith({ getXYChartData: () => linear }));
    expect(model.meta?.categories).toEqual(['1', '2', '3']);
    const text = serializeXYChart(model);
    expect(text).toContain('x-axis ["1", "2", "3"]');
    expect(text).toContain('line [10, 20, 30]');
  });

  it('round-trips the official horizontal orientation via meta', () => {
    const horizontalDb = {
      getXYChartData: () => chartData,
      getChartConfig: () => ({ chartOrientation: 'horizontal' }),
    };
    const model = parseXYChart(ctxWith(horizontalDb));
    expect(model.meta?.orientation).toBe('horizontal');
    const text = serializeXYChart(model);
    expect(text.split('\n')[0]).toBe('xychart-beta horizontal');
    // Data lines are unaffected by the orientation keyword.
    expect(text).toContain('bar [30, 65, 80]');

    // Default / vertical charts keep the plain header.
    const vertical = parseXYChart(ctxWith(db));
    expect(vertical.meta?.orientation).toBe('vertical');
    expect(serializeXYChart(vertical).split('\n')[0]).toBe('xychart-beta');
  });
});
