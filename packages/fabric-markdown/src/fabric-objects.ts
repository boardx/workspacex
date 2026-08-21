/**
 * Custom Fabric.js classes representing diagram nodes and edges.
 *
 * FlowNode  — a Group of (shape + Textbox label), draggable as one unit.
 * FlowEdge  — a custom FabricObject that renders the connector line, the
 *             arrowhead and the edge label directly in _render(). Rendering
 *             it ourselves (instead of nesting Line/Triangle/Textbox in a
 *             Group) keeps endpoint updates a simple property change and
 *             avoids group-coordinate invalidation issues.
 *
 * Both are registered in fabric's classRegistry so canvas.toJSON() /
 * loadFromJSON() round-trips work, with logical ids preserved.
 */
import {
  Group,
  Rect,
  Circle,
  Polygon,
  Textbox,
  Line,
  Path,
  Shadow,
  FabricImage,
  FabricObject,
  classRegistry,
} from 'fabric';
import type { DiagramNode, DiagramEdge, NodeShape, EdgeKind } from './model';
import {
  INK,
  INK_SOFT,
  PAPER,
  PRIMARY,
  PRIMARY_SOFT,
  STICKY_FILL,
  STICKY_STROKE,
  paletteSoftAt,
  FONT_FAMILY,
  FONT,
  RADIUS,
  STROKE_W,
  NODE_SHADOW,
} from './theme';

// Theme-token aliases (kept to minimize diff noise across the file).
const NODE_FILL = PRIMARY_SOFT;
const NODE_STROKE = PRIMARY;
const EDGE_STROKE = INK_SOFT;
// Same hue as NODE_STROKE (selection language stays one color across nodes
// and edges) — an edge picked up its own selected-state stroke so it reads
// as "this is the thing selected", not just a loose bounding-box outline
// (Fabric's default `hasBorders` gives that, but it's an axis-aligned box
// around a possibly-diagonal/curved line — easy to lose in a dense graph).
const SELECTED_EDGE_STROKE = PRIMARY;
const LABEL_COLOR = INK;

/** Shapes that get the theme drop shadow (primary content, not decorations). */
const SHADOW_SHAPES: ReadonlySet<NodeShape> = new Set([
  'rect',
  'round',
  'stadium',
  'diamond',
  'circle',
  'class',
  'participant',
  'sticky',
] as NodeShape[]);

const makeNodeShadow = (): Shadow => new Shadow(NODE_SHADOW);

/** Semantic default fill per shape when data.color is absent (VISUAL-SPEC §2). */
function defaultFillFor(shape: NodeShape): string {
  switch (shape) {
    case 'stadium':
      return paletteSoftAt(2); // green soft — start/end nodes
    case 'diamond':
      return paletteSoftAt(3); // amber soft — decisions
    default:
      return NODE_FILL;
  }
}

function makeShape(shape: NodeShape, width: number, height: number): FabricObject {
  const common = { fill: NODE_FILL, stroke: NODE_STROKE, strokeWidth: STROKE_W.normal };
  switch (shape) {
    case 'circle': {
      const r = Math.max(width, height) / 2;
      return new Circle({ radius: r, ...common });
    }
    case 'diamond':
      return new Polygon(
        [
          { x: width / 2, y: 0 },
          { x: width, y: height / 2 },
          { x: width / 2, y: height },
          { x: 0, y: height / 2 },
        ],
        common,
      );
    case 'stateStart':
      // Filled dot marking a state diagram's initial state (×1.3 size).
      return new Circle({ radius: 9, fill: NODE_STROKE, stroke: '', strokeWidth: 0 });
    case 'stateEnd':
      // Bullseye marking a final state: hollow outer ring + filled inner dot,
      // concentric at (0,0) (center origin). A Group is a FabricObject too.
      return new Group([
        new Circle({
          radius: 12,
          fill: 'transparent',
          stroke: NODE_STROKE,
          strokeWidth: STROKE_W.normal,
          left: 0,
          top: 0,
        }),
        new Circle({ radius: 6, fill: NODE_STROKE, stroke: '', strokeWidth: 0, left: 0, top: 0 }),
      ]);
    case 'stadium':
      return new Rect({ width, height, rx: height / 2, ry: height / 2, ...common });
    case 'round':
      return new Rect({ width, height, rx: RADIUS.node, ry: RADIUS.node, ...common });
    case 'rect':
    default:
      // flowchart rect semantics = square corners; template frames restyle
      // via data.color/data.stroke from the plugins.
      return new Rect({ width, height, rx: 0, ry: 0, ...common });
  }
}

export interface FlowNodeData {
  nodeId: string;
  label: string;
  shape: NodeShape;
  x: number;
  y: number;
  width: number;
  height: number;
  /** UML class compartments (shape === 'class'). */
  members?: string[];
  methods?: string[];
  /** Dashed lifeline length below the box (shape === 'participant'). */
  lifelineHeight?: number;
  /** Kind-specific item payload (chart types) — round-tripped untouched. */
  data?: Record<string, unknown>;
}

/**
 * Build the children of a UML class box: outer rect, bold title, and
 * members/methods compartments separated by divider lines. Heights are
 * computed from our own text metrics (mermaid's font differs slightly), so
 * the returned height is the actual box height. Coordinates are center-origin.
 */
function makeClassChildren(
  label: string,
  members: string[],
  methods: string[],
  width: number,
): { children: FabricObject[]; height: number } {
  const PAD = 7;
  const title = new Textbox(label, {
    width: Math.max(20, width - 12),
    fontSize: FONT.section,
    fontWeight: 'bold',
    fontFamily: FONT_FAMILY,
    fill: LABEL_COLOR,
    textAlign: 'center',
    editable: false,
  });
  const section = (linesArr: string[]): Textbox | null =>
    linesArr.length === 0
      ? null
      : new Textbox(linesArr.join('\n'), {
          width: Math.max(20, width - 16),
          fontSize: 12.5,
          fontFamily: FONT_FAMILY,
          fill: LABEL_COLOR,
          textAlign: 'left',
          editable: false,
        });
  const memTb = section(members);
  const methTb = section(methods);
  const EMPTY_H = 6;
  const memH = memTb ? memTb.height : EMPTY_H;
  const methH = methTb ? methTb.height : EMPTY_H;
  const height =
    PAD + title.height + PAD + 1 + PAD + memH + PAD + 1 + PAD + methH + PAD;

  const box = new Rect({
    width,
    height,
    rx: 0,
    ry: 0,
    fill: PAPER,
    stroke: NODE_STROKE,
    strokeWidth: STROKE_W.normal,
    left: 0,
    top: 0,
  });
  const divider = (yCenter: number) =>
    new Rect({
      width,
      height: 1,
      fill: NODE_STROKE,
      stroke: '',
      strokeWidth: 0,
      left: 0,
      top: yCenter,
    });

  // Tinted title bar: covers the title compartment (box top edge → div1).
  const titleBarH = PAD + title.height + PAD;
  const titleBar = new Rect({
    width: Math.max(0, width - STROKE_W.normal),
    height: titleBarH,
    rx: 0,
    ry: 0,
    fill: PRIMARY_SOFT,
    stroke: '',
    strokeWidth: 0,
    left: 0,
    top: -height / 2 + titleBarH / 2,
  });

  let y = -height / 2 + PAD;
  title.set({ left: 0, top: y + title.height / 2 });
  y += title.height + PAD;
  const div1 = divider(y);
  y += 1 + PAD;
  if (memTb) memTb.set({ left: 0, top: y + memTb.height / 2 });
  y += memH + PAD;
  const div2 = divider(y);
  y += 1 + PAD;
  if (methTb) methTb.set({ left: 0, top: y + methTb.height / 2 });

  const children: FabricObject[] = [box, titleBar, div1, div2, title];
  if (memTb) children.push(memTb);
  if (methTb) children.push(methTb);
  return { children, height };
}

/**
 * Children of a pie sector, drawn around a local origin at the pie center.
 * data.data supplies {r, a1, a2, color}: radius, start/end angle in radians
 * (0 = 12 o'clock, clockwise), fill color. The label sits at the sector
 * centroid. Near-full circles fall back to a plain Circle.
 */
function makePieSliceChildren(data: FlowNodeData): FabricObject[] {
  const opts = data.data ?? {};
  const r = (opts['r'] as number) ?? (Math.max(data.width, data.height) / 2 || 120);
  const a1 = (opts['a1'] as number) ?? 0;
  const a2 = (opts['a2'] as number) ?? Math.PI / 2;
  const color = (opts['color'] as string) ?? NODE_FILL;
  const span = a2 - a1;
  // Convert "clockwise from 12 o'clock" to canvas angles.
  const toXY = (a: number): [number, number] => [r * Math.sin(a), -r * Math.cos(a)];

  let shape: FabricObject;
  if (span >= Math.PI * 2 - 0.001) {
    shape = new Circle({ radius: r, fill: color, stroke: '#ffffff', strokeWidth: 2, left: 0, top: 0 });
  } else {
    const [x1, y1] = toXY(a1);
    const [x2, y2] = toXY(a2);
    const largeArc = span > Math.PI ? 1 : 0;
    shape = new Path(
      `M 0 0 L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`,
      { fill: color, stroke: '#ffffff', strokeWidth: 2 },
    );
    // fabric computes Path left/top from the path's own bbox — keep them so
    // the sector stays where it was drawn relative to the pie center.
  }

  const mid = (a1 + a2) / 2;
  const label = new Textbox(data.label, {
    width: Math.max(40, Math.min(110, r * 0.9)),
    fontSize: 12.5,
    fontFamily: FONT_FAMILY,
    fill: LABEL_COLOR,
    textAlign: 'center',
    editable: false,
  });
  label.set({ left: 0.62 * r * Math.sin(mid), top: -0.62 * r * Math.cos(mid) });
  return [shape, label];
}

/** Shrink `tb`'s font size (down to `minSize`) in place until it fits `maxH`. */
function shrinkTextboxToFit(tb: Textbox, maxH: number, minSize = 7): void {
  let fontSize = tb.fontSize ?? 13;
  while (tb.height > maxH && fontSize > minSize) {
    fontSize -= 1;
    tb.set({ fontSize });
    tb.initDimensions();
  }
}

/**
 * Textbox for a fixed-size sticky note: starts at 13px and shrinks (down to
 * 7px) until the wrapped text fits the card height. CJK wraps per grapheme.
 */
function makeStickyText(label: string, cardW: number, cardH: number): Textbox {
  const tb = new Textbox(label, {
    width: Math.max(40, cardW - 14),
    fontSize: 13,
    fontFamily: FONT_FAMILY,
    fill: LABEL_COLOR,
    textAlign: 'left',
    editable: false,
    left: 0,
    top: 0,
    splitByGrapheme: true,
  });
  shrinkTextboxToFit(tb, cardH - 12);
  return tb;
}

export class FlowNode extends Group {
  static override type = 'flowNode';

  declare nodeId: string;
  declare shape: NodeShape;
  declare label: string;
  declare members?: string[];
  declare methods?: string[];
  declare lifelineHeight?: number;
  declare data?: Record<string, unknown>;

  constructor(data: FlowNodeData) {
    // fabric v7 uses center origin: left/top ARE the object center. Placing
    // both children at (0,0) stacks their centers; the group is then placed
    // at the node's center coordinates directly.
    let children: FabricObject[];
    // Participant lifeline length; 0 for every other shape.
    const lifelineLen = data.shape === 'participant' ? data.lifelineHeight ?? 160 : 0;
    if (data.shape === 'class') {
      children = makeClassChildren(
        data.label,
        data.members ?? [],
        data.methods ?? [],
        data.width,
      ).children;
    } else if (data.shape === 'participant') {
      // Sequence participant: box + title + dashed lifeline hanging below.
      const box = new Rect({
        width: data.width,
        height: data.height,
        rx: 0,
        ry: 0,
        fill: (data.data?.['color'] as string) ?? NODE_FILL,
        stroke: NODE_STROKE,
        strokeWidth: STROKE_W.normal,
        left: 0,
        top: 0,
      });
      const title = new Textbox(data.label, {
        width: Math.max(20, data.width - 12),
        fontSize: FONT.section,
        fontFamily: FONT_FAMILY,
        fill: LABEL_COLOR,
        textAlign: 'center',
        editable: false,
        left: 0,
        top: 0,
      });
      const lifeline = new Line([0, 0, 0, lifelineLen], {
        stroke: NODE_STROKE,
        strokeWidth: 1.2,
        strokeDashArray: [5, 4],
      });
      // Center origin: the line's center sits lifelineLen/2 below the box edge.
      lifeline.set({ left: 0, top: data.height / 2 + lifelineLen / 2 });
      children = [box, lifeline, title];
    } else if (data.shape === 'stateStart' || data.shape === 'stateEnd') {
      // Start/end markers carry no visible label (mermaid uses '[*]').
      const shapeObj = makeShape(data.shape, data.width, data.height);
      shapeObj.set({ left: 0, top: 0 });
      children = [shapeObj];
    } else if (data.shape === 'pieSlice') {
      children = makePieSliceChildren(data);
    } else if (data.shape === 'sticky') {
      // Sticky note: FIXED card size; the font shrinks until the text fits.
      const noteText = makeStickyText(data.label, data.width, data.height);
      const card = new Rect({
        width: data.width,
        height: data.height,
        rx: 3,
        ry: 3,
        fill: (data.data?.['color'] as string) ?? STICKY_FILL,
        stroke: STICKY_STROKE,
        strokeWidth: 1,
        left: 0,
        top: 0,
      });
      children = [card, noteText];
    } else if (data.shape === 'image') {
      // Template background image: a light placeholder immediately, the real
      // bitmap swapped in asynchronously (FabricImage.fromURL is async while
      // this constructor is not).
      children = [
        new Rect({
          width: data.width,
          height: data.height,
          fill: '#f8fafc',
          stroke: '',
          strokeWidth: 0,
          left: 0,
          top: 0,
        }),
      ];
    } else if (data.shape === 'text') {
      // Borderless plain text (chart titles, axis labels, header fields).
      const opts = data.data ?? {};
      children = [
        new Textbox(data.label, {
          width: Math.max(20, data.width),
          fontSize: (opts['fontSize'] as number) ?? 13,
          fontWeight: (opts['bold'] ? 'bold' : 'normal') as string,
          fontFamily: FONT_FAMILY,
          fill: (opts['color'] as string) ?? INK_SOFT,
          textAlign: ((opts['align'] as string) ?? 'center') as 'left' | 'center',
          editable: false,
          left: 0,
          top: 0,
        }),
      ];
    } else {
      const fill = (data.data?.['color'] as string) ?? defaultFillFor(data.shape);
      const stroke = (data.data?.['stroke'] as string) ?? NODE_STROKE;
      const shapeObj = makeShape(data.shape, data.width, data.height);
      shapeObj.set({ left: 0, top: 0, fill, stroke });
      const shapeW = data.shape === 'circle' ? Math.max(data.width, data.height) : data.width;
      const align = data.data?.['labelAlign'];
      // Mindmap nodes: wrap + shrink-to-fit like a sticky note, since their
      // width is only a rough estimate from label length (capped per depth)
      // and long text would otherwise overflow the node's fixed height.
      const isMindmapNode = data.data?.['mmType'] !== undefined;
      const textbox = new Textbox(data.label, {
        // 'bottom' labels hang outside the shape (e.g. quadrant data points),
        // so they are not constrained to the shape width.
        width: align === 'bottom' ? Math.max(90, shapeW) : Math.max(20, shapeW - 12),
        fontSize: (data.data?.['fontSize'] as number) ?? FONT.body,
        fontFamily: FONT_FAMILY,
        fill: LABEL_COLOR,
        textAlign: 'center',
        editable: false,
        left: 0,
        top: 0,
        ...(isMindmapNode ? { splitByGrapheme: true } : {}),
      });
      if (isMindmapNode) shrinkTextboxToFit(textbox, data.height - 10);
      // Charts can pin the label to the top edge (quadrant backgrounds) or
      // below the shape (small data dots) so text never covers data.
      if (align === 'top') {
        textbox.set({ top: -data.height / 2 + textbox.height / 2 + 8 });
      } else if (align === 'bottom') {
        textbox.set({ top: data.height / 2 + textbox.height / 2 + 4 });
      }
      children = [shapeObj, textbox];
    }
    // Primary content nodes carry the theme drop shadow on their base shape;
    // locked decorations (backgrounds, section frames) stay flat.
    if (SHADOW_SHAPES.has(data.shape) && data.data?.['locked'] !== true) {
      children[0]?.set({ shadow: makeNodeShadow() });
    }
    super(children, {
      // Pie slices lay out their children around the pie center (local
      // origin) and must keep the natural bbox-center position fabric
      // computes; every other shape is placed at data.x/y directly.
      ...(data.shape === 'pieSlice'
        ? {}
        : {
            left: data.x,
            // Participant: the group's bounding box spans box + lifeline, so
            // the group center sits lifelineLen/2 below the box center.
            // Compensate so the box center lands exactly on data.y.
            top: data.y + lifelineLen / 2,
          }),
      hasControls: false,
      subTargetCheck: false,
    });
    if (data.shape === 'pieSlice') {
      // Natural left/top = slice bbox center relative to the pie center
      // (children were drawn around local (0,0)). Translate the whole slice
      // so the pie center lands on data.x/y — slices of one pie share x/y.
      this.set({ left: this.left + data.x, top: this.top + data.y });
      this.setCoords();
    }
    this.nodeId = data.nodeId;
    this.shape = data.shape;
    this.label = data.label;
    if (data.shape === 'class') {
      this.members = data.members ?? [];
      this.methods = data.methods ?? [];
    }
    if (data.shape === 'participant') {
      this.lifelineHeight = lifelineLen;
    }
    if (data.data) this.data = data.data;

    // Async bitmap swap-in for image nodes.
    if (data.shape === 'image' && typeof data.data?.['src'] === 'string') {
      FabricImage.fromURL(data.data['src'] as string)
        .then((img) => {
          img.set({
            left: 0,
            top: 0,
            scaleX: data.width / (img.width || 1),
            scaleY: data.height / (img.height || 1),
            selectable: false,
            evented: false,
          });
          this.add(img);
          this.dirty = true;
          this.canvas?.requestRenderAll();
        })
        .catch((err) => console.warn('[fabric-markdown] background image failed to load', err));
    }
  }

  private get textbox(): Textbox {
    return this.getObjects().find((o) => o instanceof Textbox) as Textbox;
  }

  setLabel(text: string): void {
    this.label = text;
    const tb = this.textbox;
    if (tb) {
      const isMindmapNode = this.data?.['mmType'] !== undefined;
      if (this.shape === 'sticky' || isMindmapNode) {
        // Re-fit: reset to the base size, then shrink until it fits the card.
        const baseFontSize = isMindmapNode ? ((this.data?.['fontSize'] as number) ?? FONT.body) : 13;
        tb.set({ text, fontSize: baseFontSize });
        tb.initDimensions();
        shrinkTextboxToFit(tb, this.height - (isMindmapNode ? 10 : 12));
        tb.set({ left: 0, top: 0 });
      } else {
        tb.set('text', text);
        // Center-origin: (0,0) keeps the label centered on the group (for class
        // boxes the first Textbox is the bold title — keep its position).
        if (this.shape !== 'class') tb.set({ left: 0, top: 0 });
      }
    }
    this.dirty = true;
    this.canvas?.requestRenderAll();
  }

  /** Re-fill the base shape (card/rect/etc.) — used by the sticky color menu. */
  setColor(hex: string): void {
    this.data = { ...this.data, color: hex };
    const base = this.getObjects().find((o) => !(o instanceof Textbox));
    base?.set({ fill: hex });
    this.dirty = true;
    this.canvas?.requestRenderAll();
  }

  /** Current center point in canvas coordinates. */
  center(): { x: number; y: number } {
    const p = this.getCenterPoint();
    return { x: p.x, y: p.y };
  }

  toDiagramNode(): DiagramNode {
    const c = this.center();
    if (this.shape === 'participant') {
      // Undo the constructor's compensation: the group center sits L/2 below
      // the box center, and the group height includes the lifeline.
      const L = this.lifelineHeight ?? 160;
      return {
        id: this.nodeId,
        label: this.label,
        shape: this.shape,
        x: c.x,
        y: c.y - L / 2,
        width: this.width,
        height: this.height - L,
        lifelineHeight: L,
        ...(this.data ? { data: this.data } : {}),
      };
    }
    return {
      id: this.nodeId,
      label: this.label,
      shape: this.shape,
      x: c.x,
      y: c.y,
      width: this.width,
      height: this.height,
      ...(this.shape === 'class'
        ? { members: this.members ?? [], methods: this.methods ?? [] }
        : {}),
      ...(this.data ? { data: this.data } : {}),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override toObject(propertiesToInclude: any[] = []): any {
    return super.toObject([...propertiesToInclude, 'nodeId', 'shape', 'label', 'members', 'methods', 'lifelineHeight', 'data']);
  }

  static override async fromObject(object: Record<string, unknown>): Promise<FlowNode> {
    // Center origin: stored left/top are the node center. For participants
    // they are the GROUP center (box + lifeline); the constructor adds L/2
    // again, so hand it the box-center y (top - L/2) and box height
    // (group height - L) to stay round-trip consistent.
    const shape = (object['shape'] as NodeShape) ?? 'rect';
    const L = shape === 'participant' ? ((object['lifelineHeight'] as number) ?? 160) : 0;
    const node = new FlowNode({
      nodeId: (object['nodeId'] as string) ?? 'node',
      label: (object['label'] as string) ?? '',
      shape,
      // Pie slices interpret x/y as the pie center and self-offset; restore
      // the stored group position verbatim below instead.
      x: shape === 'pieSlice' ? 0 : ((object['left'] as number) ?? 0),
      y: shape === 'pieSlice' ? 0 : ((object['top'] as number) ?? 0) - L / 2,
      width: (object['width'] as number) ?? 100,
      height: ((object['height'] as number) ?? 40) - L,
      members: object['members'] as string[] | undefined,
      methods: object['methods'] as string[] | undefined,
      data: object['data'] as Record<string, unknown> | undefined,
      ...(shape === 'participant' ? { lifelineHeight: L } : {}),
    });
    if (shape === 'pieSlice') {
      node.set({ left: (object['left'] as number) ?? 0, top: (object['top'] as number) ?? 0 });
      node.setCoords();
    }
    return node;
  }
}

export interface FlowEdgeData {
  edgeId: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
  /** UML cardinalities near the source / target ends. */
  sourceLabel?: string;
  targetLabel?: string;
  /** Sequence diagrams: absolute canvas y of the horizontal message line. */
  seqY?: number;
  /** Kind-specific edge payload (e.g. ER cardinality enums) — round-tripped. */
  data?: Record<string, unknown>;
}

const DASHED_KINDS: ReadonlySet<EdgeKind> = new Set(['dotted', 'dependency', 'realization']);
const NO_MARKER_KINDS: ReadonlySet<EdgeKind> = new Set(['open']);

const EDGE_PAD = 14;
/** Curvature: quadratic control point offset = CURVE_K × segment length. */
const CURVE_K = 0.18;
const ARROW_LEN = 11;
const ARROW_WIDTH = 8;

export class FlowEdge extends FabricObject {
  static override type = 'flowEdge';

  declare edgeId: string;
  declare source: string;
  declare target: string;
  declare kind: EdgeKind;
  declare label?: string;
  declare sourceLabel?: string;
  declare targetLabel?: string;
  declare data?: Record<string, unknown>;
  declare seqY?: number;

  private x1 = 0;
  private y1 = 0;
  private x2 = 0;
  private y2 = 0;

  constructor(data: FlowEdgeData & { x1?: number; y1?: number; x2?: number; y2?: number }) {
    super({
      selectable: true,
      hasControls: false,
      hasBorders: true,
      perPixelTargetFind: true,
      objectCaching: false,
      fill: '',
      stroke: EDGE_STROKE,
    });
    this.edgeId = data.edgeId;
    this.source = data.source;
    this.target = data.target;
    this.kind = data.kind;
    this.label = data.label;
    this.sourceLabel = data.sourceLabel;
    this.targetLabel = data.targetLabel;
    if (data.data) this.data = data.data;
    this.seqY = data.seqY;
    this.setEndpoints(data.x1 ?? 0, data.y1 ?? 0, data.x2 ?? 100, data.y2 ?? 100);
  }

  /** Whether this edge renders as a quadratic curve (VISUAL-SPEC S2). */
  private isCurved(): boolean {
    return this.seqY === undefined && this.data?.['straight'] !== true;
  }

  /**
   * Whether this edge is the interactive canvas's current selection.
   *
   * `getActiveObject` lives on `SelectableCanvas`/`Canvas` (interaction), not
   * on the base `StaticCanvas` this object's `canvas` field is typed as —
   * server-side/headless render paths (`apps/api/tests/canvas/*`,
   * `renderToCanvas` used from Node) legitimately attach a plain
   * `StaticCanvas` that never has it. Duck-type the check instead of
   * asserting the type, so those callers keep rendering instead of throwing
   * `getActiveObject is not a function` (real regression, caught by
   * `coords-not-written-back.test.ts` erroring — not a hypothetical).
   */
  private isSelected(): boolean {
    const c = this.canvas as { getActiveObject?: () => unknown } | undefined;
    return typeof c?.getActiveObject === 'function' && c.getActiveObject() === this;
  }

  /**
   * Line/arrow color: selected-state wins over everything (a selected edge
   * must read as selected even on a branch-colored mindmap edge or a
   * data.color-tinted UML relation — those are still readable through a
   * temporary color swap, same as a node's selection outline overriding its
   * own fill/stroke), then data.color, then the theme edge stroke.
   */
  private lineColor(): string {
    if (this.isSelected()) return SELECTED_EDGE_STROKE;
    return (this.data?.['color'] as string) ?? EDGE_STROKE;
  }

  /** Update the absolute canvas coordinates of both endpoints. */
  setEndpoints(x1: number, y1: number, x2: number, y2: number): void {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    // Center origin: left/top are the object's center (segment midpoint).
    // Curved edges bulge up to |offset|/2 from the chord — pad the bbox so
    // the bend stays inside the selectable area. Mindmap S-curves and
    // back-edge loops can bow further than the default, so widen the pad
    // for those cases too.
    const len = Math.hypot(x2 - x1, y2 - y1);
    const isMindmap = this.data?.['mindmap'] === true;
    let curvePad = 0;
    if (isMindmap) {
      curvePad = Math.max(30, Math.abs(x2 - x1) * 0.55) + 6;
    } else if (this.isCurved()) {
      const dominant = Math.abs(x2 - x1) >= Math.abs(y2 - y1) ? x2 - x1 : y2 - y1;
      const k = dominant < -20 ? CURVE_K * 1.8 : CURVE_K;
      curvePad = Math.max(len * k, 14) / 2 + 6 + 10;
    }
    const pad = EDGE_PAD + curvePad;
    this.set({
      left: (x1 + x2) / 2,
      top: (y1 + y2) / 2,
      width: Math.abs(x2 - x1) + pad * 2,
      height: Math.abs(y2 - y1) + pad * 2,
    });
    this.setCoords();
    this.dirty = true;
  }

  getEndpoints(): { x1: number; y1: number; x2: number; y2: number } {
    return { x1: this.x1, y1: this.y1, x2: this.x2, y2: this.y2 };
  }

  setLabel(text: string): void {
    this.label = text.trim() === '' ? undefined : text;
    this.dirty = true;
    this.canvas?.requestRenderAll();
  }

  toDiagramEdge(): DiagramEdge {
    return {
      id: this.edgeId,
      source: this.source,
      target: this.target,
      label: this.label,
      kind: this.kind,
      sourceLabel: this.sourceLabel,
      targetLabel: this.targetLabel,
      ...(this.data ? { data: this.data } : {}),
    };
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    // ctx origin is the object's center = the segment midpoint; use the
    // stored endpoints directly so this is independent of left/top semantics.
    const cx = (this.x1 + this.x2) / 2;
    const cy = (this.y1 + this.y2) / 2;
    const ax = this.x1 - cx;
    const ay = this.y1 - cy;
    const bx = this.x2 - cx;
    const by = this.y2 - cy;

    ctx.save();
    const isSelected = this.isSelected();
    const color = this.lineColor();
    ctx.strokeStyle = color;
    // 'thick' (mermaid `==>`) needs to read as unmistakably heavier than a
    // plain line at a glance, not just marginally — bump it well past 2x.
    // Selected state gets the same "unmistakably heavier" treatment, on top
    // of whatever the kind's own width already is (a selected 'thick' edge
    // should look thicker than an unselected 'thick' edge, not the same).
    ctx.lineWidth = (this.kind === 'thick' ? 4.5 : 1.6) * (isSelected ? 1.6 : 1);
    if (DASHED_KINDS.has(this.kind)) ctx.setLineDash([5, 4]);

    // Sequence self-message (A->>A): endpoints share the lifeline x with a
    // small vertical span — draw the classic right-hand loop instead of a
    // (zero-length) horizontal line.
    if (this.seqY !== undefined && Math.abs(bx - ax) < 0.5 && Math.abs(by - ay) > 0.5) {
      const W = 56;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + W, ay);
      ctx.lineTo(ax + W, by);
      ctx.lineTo(ax + 3, by);
      ctx.stroke();
      // Return arrow pointing back into the lifeline (leftward).
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ax, by);
      ctx.lineTo(ax + ARROW_LEN, by - ARROW_WIDTH / 2);
      ctx.lineTo(ax + ARROW_LEN, by + ARROW_WIDTH / 2);
      ctx.closePath();
      ctx.fill();
      if (this.label) {
        ctx.font = `12px ${FONT_FAMILY}`;
        const half = ctx.measureText(this.label).width / 2;
        this.renderTextChip(ctx, this.label, ax + W + 12 + half, (ay + by) / 2, 12);
      }
      ctx.restore();
      return;
    }

    // Mindmap connectors get a distinct S-curve (cubic bezier with horizontal
    // tangent handles) instead of the generic perpendicular-bow curve: it
    // leaves each node horizontally regardless of vertical offset, which
    // reads as a clean, intentional "branch" rather than a chaotic fan of
    // bulges radiating from the root at different angles.
    if (this.data?.['mindmap'] === true) {
      const dx = bx - ax;
      const dy = by - ay;
      const handle = Math.max(30, Math.abs(dx) * 0.55);
      const c1x = ax + handle;
      const c1y = ay;
      const c2x = bx - handle;
      const c2y = by;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
      ctx.stroke();
      if (this.label) {
        // Cubic bezier point at t = 0.5.
        const lx = 0.125 * ax + 0.375 * c1x + 0.375 * c2x + 0.125 * bx;
        const ly = 0.125 * ay + 0.375 * c1y + 0.375 * c2y + 0.125 * by;
        this.renderTextChip(ctx, this.label, lx, ly - (dy >= 0 ? 12 : -12), 12);
      }
      ctx.restore();
      return;
    }

    // Quadratic control point: midpoint + normal offset (VISUAL-SPEC S2).
    // Straight fallback: data.straight, sequence messages (seqY) or zero length.
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const curved = this.isCurved() && len > 1;
    // Backward-reading edges are usually cycle/return edges — bow them
    // noticeably more so they read as an intentional loop instead of a
    // near-straight line cutting across unrelated boxes. "Backward" is
    // judged on whichever axis dominates the edge (dx for LR-ish layouts,
    // dy for TB-ish ones), since FlowEdge itself doesn't know the diagram's
    // declared direction.
    const dominant = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    const k = curved && dominant < -20 ? CURVE_K * 1.8 : CURVE_K;
    // A small floor on the bow keeps even short edges visibly curved, which
    // helps disambiguate overlapping/near-parallel connectors.
    const bow = curved ? Math.max(len * k, 14) : 0;
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;
    const cpx = curved ? (ax + bx) / 2 + nx * bow : (ax + bx) / 2;
    const cpy = curved ? (ay + by) / 2 + ny * bow : (ay + by) / 2;

    // Tangent angles: at the target end use control→end; at the source end
    // use start→control (both equal the chord angle when straight).
    const angle = curved ? Math.atan2(by - cpy, bx - cpx) : Math.atan2(dy, dx);
    const startAngle = curved ? Math.atan2(cpy - ay, cpx - ax) : angle;

    // Shorten the shaft so it does not poke through the marker.
    const hasMarker = !NO_MARKER_KINDS.has(this.kind);
    const markerLen = this.markerLength();
    const shaftEndX = hasMarker ? bx - Math.cos(angle) * (markerLen * 0.85) : bx;
    const shaftEndY = hasMarker ? by - Math.sin(angle) * (markerLen * 0.85) : by;

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    if (curved) {
      ctx.quadraticCurveTo(cpx, cpy, shaftEndX, shaftEndY);
    } else {
      ctx.lineTo(shaftEndX, shaftEndY);
    }
    ctx.stroke();

    if (hasMarker) this.renderMarker(ctx, bx, by, angle);

    if (this.label) {
      // Bezier point at t = 0.5: 0.25·A + 0.5·C + 0.25·B (chord midpoint when straight),
      // nudged an extra bit further out along the same normal so the label
      // chip clears the curve/nearby node boundaries instead of sitting
      // right on top of them.
      const lx = 0.25 * ax + 0.5 * cpx + 0.25 * bx + nx * 10;
      const ly = 0.25 * ay + 0.5 * cpy + 0.25 * by + ny * 10;
      this.renderTextChip(ctx, this.label, lx, ly, 12);
    }
    // UML cardinalities near the endpoints, nudged toward the middle.
    if (this.sourceLabel) {
      const t = 18;
      this.renderTextChip(ctx, this.sourceLabel, ax + Math.cos(startAngle) * t, ay + Math.sin(startAngle) * t - 10, 11);
    }
    if (this.targetLabel) {
      const t = 18 + markerLen;
      this.renderTextChip(ctx, this.targetLabel, bx - Math.cos(angle) * t, by - Math.sin(angle) * t - 10, 11);
    }
    ctx.restore();
  }

  private markerLength(): number {
    switch (this.kind) {
      case 'inheritance':
      case 'realization':
        return 14;
      case 'composition':
      case 'aggregation':
        return 16;
      default:
        return ARROW_LEN;
    }
  }

  /** Draw the arrowhead / triangle / diamond marker at the target end. */
  private renderMarker(ctx: CanvasRenderingContext2D, bx: number, by: number, angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const color = this.lineColor();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.6;

    if (this.kind === 'inheritance' || this.kind === 'realization') {
      // Hollow (white-filled) triangle.
      const len = 14;
      const half = 7;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - cos * len - sin * half, by - sin * len + cos * half);
      ctx.lineTo(bx - cos * len + sin * half, by - sin * len - cos * half);
      ctx.closePath();
      ctx.fillStyle = PAPER;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      return;
    }

    if (this.kind === 'composition' || this.kind === 'aggregation') {
      // Diamond: filled for composition, hollow for aggregation.
      const len = 16;
      const half = 5.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - cos * (len / 2) - sin * half, by - sin * (len / 2) + cos * half);
      ctx.lineTo(bx - cos * len, by - sin * len);
      ctx.lineTo(bx - cos * (len / 2) + sin * half, by - sin * (len / 2) - cos * half);
      ctx.closePath();
      ctx.fillStyle = this.kind === 'composition' ? color : PAPER;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
      return;
    }

    // Default: small filled triangle (flowchart arrow / dependency).
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - cos * ARROW_LEN - sin * (ARROW_WIDTH / 2), by - sin * ARROW_LEN + cos * (ARROW_WIDTH / 2));
    ctx.lineTo(bx - cos * ARROW_LEN + sin * (ARROW_WIDTH / 2), by - sin * ARROW_LEN - cos * (ARROW_WIDTH / 2));
    ctx.closePath();
    ctx.fill();
  }

  private renderTextChip(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fontSize: number): void {
    ctx.setLineDash([]);
    ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const metrics = ctx.measureText(text);
    const pad = 3;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(x - metrics.width / 2 - pad, y - fontSize / 2 - pad, metrics.width + pad * 2, fontSize + pad * 2);
    ctx.fillStyle = LABEL_COLOR;
    ctx.fillText(text, x, y);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override toObject(propertiesToInclude: any[] = []): any {
    return {
      ...super.toObject([...propertiesToInclude, 'edgeId', 'source', 'target', 'kind', 'label', 'sourceLabel', 'targetLabel', 'seqY', 'data']),
      x1: this.x1,
      y1: this.y1,
      x2: this.x2,
      y2: this.y2,
    };
  }

  static override async fromObject(object: Record<string, unknown>): Promise<FlowEdge> {
    return new FlowEdge({
      edgeId: (object['edgeId'] as string) ?? 'edge',
      source: (object['source'] as string) ?? '',
      target: (object['target'] as string) ?? '',
      kind: (object['kind'] as EdgeKind) ?? 'arrow',
      label: object['label'] as string | undefined,
      sourceLabel: object['sourceLabel'] as string | undefined,
      targetLabel: object['targetLabel'] as string | undefined,
      seqY: object['seqY'] as number | undefined,
      data: object['data'] as Record<string, unknown> | undefined,
      x1: object['x1'] as number,
      y1: object['y1'] as number,
      x2: object['x2'] as number,
      y2: object['y2'] as number,
    });
  }
}

classRegistry.setClass(FlowNode);
classRegistry.setClass(FlowEdge);
