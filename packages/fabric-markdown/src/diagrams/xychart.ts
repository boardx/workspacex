/**
 * XY chart plugin: mermaid `xychart-beta` ⇄ DiagramModel.
 *
 * db.getXYChartData() gives axes + plots (bar/line series). The canvas shows
 * a real chart: bar values become rects whose height is proportional to the
 * value, line values become dots connected by 'open' edges, plus locked
 * axis-line/category/title decoration nodes. Values live in node.data
 * (authoritative for serialization — dragging shapes never changes output).
 */
import { registerDiagram, type DiagramParseContext } from './registry';
import type { DiagramModel, DiagramNode, DiagramEdge } from '../model';
import { paletteAt, LINE, PAPER, INK, FONT } from '../theme';

/** Darken a #rrggbb color by a factor (same-hue bar stroke). */
function darken(hex: string, factor = 0.7): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function dbCall<T>(db: Record<string, unknown>, name: string): T | undefined {
  const fn = db[name];
  if (typeof fn === 'function') return (fn as (this: unknown) => T).call(db);
  return undefined;
}

interface XYChartData {
  title?: string;
  xAxis?: { type?: string; title?: string; categories?: string[]; min?: number; max?: number };
  yAxis?: { type?: string; title?: string; min?: number; max?: number };
  plots?: Array<{ type: string; data: Array<[unknown, number]> }>;
}

/** Quote a string for mermaid output, downgrading inner double quotes. */
const quote = (s: string): string => `"${s.replace(/"/g, "'")}"`;

export function parseXYChart(ctx: DiagramParseContext): DiagramModel {
  const chart = dbCall<XYChartData>(ctx.db, 'getXYChartData') ?? {};
  const plots = chart.plots ?? [];

  // Official `xychart-beta horizontal`: the orientation lives on the chart
  // config db. v1 still renders vertically, but the flag round-trips via
  // meta.orientation so serialization never loses it.
  const chartConfig = dbCall<{ chartOrientation?: string }>(ctx.db, 'getChartConfig');
  const orientation = chartConfig?.chartOrientation === 'horizontal' ? 'horizontal' : 'vertical';

  // Band axis carries categories; a linear x-axis does not — fall back to
  // stringifying the first column of the first plot's data.
  let categories = chart.xAxis?.categories;
  if (!categories || categories.length === 0) {
    categories = (plots[0]?.data ?? []).map((d) => String(d[0]));
  }

  // Real chart layout: bars sized by value, line points connected by edges.
  const PLOT = { x0: 130, y0: 90, h: 260 };
  const colStep = 110;
  const plotW = Math.max(2, categories.length) * colStep;
  const baseline = PLOT.y0 + PLOT.h;
  const allValues = plots.flatMap((pl) => pl.data.map(([, v]) => Number(v) || 0));
  const yMax = chart.yAxis?.max ?? Math.max(1, ...allValues);
  const yMin = chart.yAxis?.min ?? 0;
  const scale = (v: number): number =>
    Math.max(4, ((Number(v) - yMin) / Math.max(1e-9, yMax - yMin)) * PLOT.h);
  const colX = (col: number): number => PLOT.x0 + col * colStep + colStep / 2;

  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const chartTitle =
    (chart.title ?? '') ||
    ((ctx.db['getDiagramTitle'] as (() => string) | undefined)?.call(ctx.db) ?? '');
  if (chartTitle) {
    nodes.push({
      id: 'xy-title',
      label: chartTitle,
      shape: 'text',
      x: PLOT.x0 + plotW / 2,
      y: 40,
      width: 320,
      height: 26,
      data: { role: 'title', locked: true, fontSize: 17, bold: true, color: INK },
    });
  }
  // Axis lines (locked thin rects) + category labels.
  nodes.push({
    id: 'xy-axis-x',
    label: '',
    shape: 'rect',
    x: PLOT.x0 + plotW / 2,
    y: baseline + 1,
    width: plotW + 20,
    height: 2,
    data: { role: 'axisLine', locked: true, color: '#94a3b8' },
  });
  nodes.push({
    id: 'xy-axis-y',
    label: '',
    shape: 'rect',
    x: PLOT.x0 - 10,
    y: PLOT.y0 + PLOT.h / 2,
    width: 2,
    height: PLOT.h + 16,
    data: { role: 'axisLine', locked: true, color: '#94a3b8' },
  });
  categories.forEach((cat, col) => {
    nodes.push({
      id: `xy-cat-${col}`,
      label: cat,
      shape: 'text',
      x: colX(col),
      y: baseline + 22,
      width: colStep - 10,
      height: 20,
      data: { role: 'category', locked: true },
    });
  });
  if (chart.yAxis?.title) {
    nodes.push({
      id: 'xy-ytitle',
      label: `${chart.yAxis.title} (${yMin}–${yMax})`,
      shape: 'text',
      x: PLOT.x0 - 10,
      y: PLOT.y0 - 24,
      width: 160,
      height: 20,
      data: { role: 'axisTitle', locked: true },
    });
  }

  // Horizontal gridlines at 1/4, 2/4, 3/4 of the y range, drawn before the
  // value nodes so bars/dots render on top of them.
  for (let g = 1; g <= 3; g++) {
    nodes.push({
      id: `xy-grid-${g}`,
      label: '',
      shape: 'rect',
      x: PLOT.x0 + plotW / 2,
      y: baseline - (PLOT.h * g) / 4,
      width: plotW,
      height: 2,
      data: { role: 'grid', locked: true, color: LINE, stroke: 'transparent' },
    });
  }

  // Series legend, top-right of the plot: swatch + series type name.
  plots.forEach((plot, p) => {
    const color = paletteAt(p);
    const rowY = PLOT.y0 - 26 + p * 22;
    const legendX = PLOT.x0 + plotW - 60;
    nodes.push({
      id: `xy-legend-swatch-${p}`,
      label: '',
      shape: 'rect',
      x: legendX,
      y: rowY,
      width: 14,
      height: 14,
      data: { role: 'legend', locked: true, color, stroke: 'transparent' },
    });
    nodes.push({
      id: `xy-legend-label-${p}`,
      label: plot.type,
      shape: 'text',
      x: legendX + 46,
      y: rowY,
      width: 70,
      height: 16,
      data: { role: 'legend', locked: true, align: 'left', fontSize: FONT.small, color: INK },
    });
  });

  const barPlots = plots.filter((pl) => pl.type === 'bar').length;
  let barIndex = 0;
  plots.forEach((plot, p) => {
    const color = paletteAt(p);
    if (plot.type === 'bar') {
      // Side-by-side bars when multiple bar series exist.
      const barW = Math.min(44, (colStep - 30) / Math.max(1, barPlots));
      const offset = (barIndex - (barPlots - 1) / 2) * (barW + 4);
      barIndex++;
      plot.data.forEach(([rawCat, value], col) => {
        const h = scale(Number(value));
        nodes.push({
          id: `val-${p}-${col}`,
          label: String(value),
          shape: 'rect',
          x: colX(col) + offset,
          y: baseline - h / 2,
          width: barW,
          height: h,
          data: {
            role: 'value',
            plot: p,
            type: plot.type,
            cat: String(rawCat),
            value,
            col,
            color,
            stroke: darken(color),
            fontSize: 11,
            labelAlign: 'top',
          },
        });
      });
    } else {
      // Line series: dots connected in category order.
      plot.data.forEach(([rawCat, value], col) => {
        nodes.push({
          id: `val-${p}-${col}`,
          label: String(value),
          shape: 'circle',
          x: colX(col),
          y: baseline - scale(Number(value)),
          width: 22,
          height: 22,
          data: {
            role: 'value',
            plot: p,
            type: plot.type,
            cat: String(rawCat),
            value,
            col,
            // White core with a series-colored ring.
            color: PAPER,
            stroke: color,
            fontSize: 10,
            labelAlign: 'bottom',
          },
        });
        if (col > 0) {
          edges.push({
            id: `line-${p}-${col}`,
            source: `val-${p}-${col - 1}`,
            target: `val-${p}-${col}`,
            kind: 'open',
          });
        }
      });
    }
  });

  return {
    kind: 'xychart',
    direction: 'LR',
    nodes,
    edges,
    meta: {
      // getXYChartData().title can be empty at db stage; fall back to the
      // commonDb title getter which is populated right after parsing.
      title:
        (chart.title ?? '') ||
        ((ctx.db['getDiagramTitle'] as (() => string) | undefined)?.call(ctx.db) ?? ''),
      xTitle: chart.xAxis?.title ?? '',
      yTitle: chart.yAxis?.title ?? '',
      yMin: chart.yAxis?.min,
      yMax: chart.yAxis?.max,
      categories,
      orientation,
    },
  };
}

export function serializeXYChart(model: DiagramModel): string {
  const meta = model.meta ?? {};
  const metaStr = (key: string): string => {
    const v = meta[key];
    return typeof v === 'string' ? v : '';
  };
  const categories = Array.isArray(meta.categories) ? meta.categories.map(String) : [];

  // Official orientation keyword survives the round-trip via meta.
  const lines = [meta.orientation === 'horizontal' ? 'xychart-beta horizontal' : 'xychart-beta'];
  if (metaStr('title')) lines.push(`    title ${quote(metaStr('title'))}`);

  if (categories.length > 0) {
    const items = categories.map((c) => quote(c)).join(', ');
    const xTitle = metaStr('xTitle');
    lines.push(xTitle ? `    x-axis ${quote(xTitle)} [${items}]` : `    x-axis [${items}]`);
  }

  const yTitle = metaStr('yTitle');
  const yMin = typeof meta.yMin === 'number' ? meta.yMin : undefined;
  const yMax = typeof meta.yMax === 'number' ? meta.yMax : undefined;
  if (yTitle && yMin !== undefined && yMax !== undefined) {
    lines.push(`    y-axis ${quote(yTitle)} ${yMin} --> ${yMax}`);
  } else if (yTitle) {
    lines.push(`    y-axis ${quote(yTitle)}`);
  } else if (yMin !== undefined && yMax !== undefined) {
    lines.push(`    y-axis ${yMin} --> ${yMax}`);
  }

  // Group value nodes by series index; emit one plot line per series, with
  // values ordered by meta.categories (node.data is authoritative).
  const valueNodes = model.nodes.filter((n) => n.data?.role === 'value');
  const plotIndices = [...new Set(valueNodes.map((n) => Number(n.data?.plot ?? 0)))].sort(
    (a, b) => a - b,
  );

  for (const p of plotIndices) {
    const seriesNodes = valueNodes.filter((n) => Number(n.data?.plot) === p);
    const type =
      model.nodes.find((n) => n.data?.role === 'series' && Number(n.data?.plot) === p)?.data
        ?.type ??
      seriesNodes[0]?.data?.type ??
      'bar';
    const values = categories.map((cat, col) => {
      const node =
        seriesNodes.find((n) => n.data?.cat === cat) ??
        seriesNodes.find((n) => Number(n.data?.col) === col);
      return node?.data?.value ?? 0;
    });
    lines.push(`    ${type} [${values.join(', ')}]`);
  }

  return lines.join('\n');
}

registerDiagram({
  kind: 'xychart',
  detects: ['xychart'],
  parse: parseXYChart,
  serialize: serializeXYChart,
});
