/**
 * Shared intermediate representation (IR) between Mermaid text and Fabric.js objects.
 * Both conversion directions go through DiagramModel.
 */

export type Direction = 'TD' | 'TB' | 'LR' | 'RL' | 'BT';

/** Supported mermaid diagram families. */
export type DiagramKind =
  | 'flowchart'
  | 'class'
  | 'state'
  | 'sequence'
  | 'er'
  | 'mindmap'
  | 'gitgraph'
  | 'gantt'
  | 'journey'
  | 'timeline'
  | 'pie'
  | 'quadrant'
  | 'xychart'
  /** Workshop canvas templates (```persona / ```canvas fences — not mermaid). */
  | 'template'
  /** UML use-case diagram (```usecase fences — custom syntax, not mermaid). */
  | 'usecase';

/**
 * Node shapes. Flowchart: rect/round/stadium/diamond/circle (others degrade
 * to rect). 'class' is a UML class box with name/members/methods compartments.
 * State diagrams add 'stateStart' (filled dot) and 'stateEnd' (bullseye);
 * ordinary states use 'round'. Sequence diagrams use 'participant' (a box
 * with a dashed lifeline hanging below it).
 */
export type NodeShape =
  | 'rect'
  | 'round'
  | 'stadium'
  | 'diamond'
  | 'circle'
  | 'class'
  | 'stateStart'
  | 'stateEnd'
  | 'participant'
  /** Pie sector; geometry comes from data: {r, a1, a2, color} (radians). */
  | 'pieSlice'
  /** Borderless plain text (chart titles / axis labels). */
  | 'text'
  /** Sticky note: yellow card that auto-grows to fit its text. */
  | 'sticky'
  /** Bitmap/SVG image (template backgrounds); data.src carries the URL. */
  | 'image';

/**
 * Edge kinds. Flowchart: arrow(-->) open(---) dotted(-.->) thick(==>).
 * UML: inheritance(--|>) realization(..|>) composition(--*) aggregation(--o)
 * dependency(..>) — the marker is always drawn at the target end.
 */
export type EdgeKind =
  | 'arrow'
  | 'open'
  | 'dotted'
  | 'thick'
  | 'inheritance'
  | 'realization'
  | 'composition'
  | 'aggregation'
  | 'dependency';

export interface DiagramNode {
  /** Mermaid node id (also used as the stable key on canvas objects). */
  id: string;
  label: string;
  shape: NodeShape;
  /** Center position in canvas coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** UML class attributes, e.g. "+int age" (shape === 'class'). */
  members?: string[];
  /** UML class methods, e.g. "+eat() : void" (shape === 'class'). */
  methods?: string[];
  /**
   * Length in canvas px of the dashed lifeline below a 'participant' box
   * (sequence diagrams only). x/y remain the center of the box itself.
   */
  lifelineHeight?: number;
  /**
   * Kind-specific item payload (chart types): e.g. a pie entry's value, a
   * gantt task's dates, a quadrant point's normalized coordinates. Owned by
   * the diagram plugin; round-tripped through the canvas untouched except
   * where the plugin defines edit semantics.
   */
  data?: Record<string, unknown>;
}

export interface DiagramEdge {
  id: string;
  /** Source / target node ids. */
  source: string;
  target: string;
  label?: string;
  kind: EdgeKind;
  /** UML cardinality shown near the source end, e.g. "1". */
  sourceLabel?: string;
  /** UML cardinality shown near the target end, e.g. "*". */
  targetLabel?: string;
  /**
   * Sequence diagrams: 0-based message order (top to bottom). Serialization
   * emits messages sorted by this value.
   */
  order?: number;
  /**
   * Sequence diagrams: absolute canvas y of the horizontal message line.
   * Message kind mapping: 'arrow' = solid (->>), 'dotted' = dashed reply (-->>)
   */
  seqY?: number;
  /**
   * Kind-specific edge payload (e.g. ER cardinality enums). Owned by the
   * diagram plugin and round-tripped through the canvas untouched.
   */
  data?: Record<string, unknown>;
}

export interface DiagramModel {
  kind: DiagramKind;
  direction: Direction;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  /**
   * Kind-specific global settings (chart types): title, axis labels, date
   * format, etc. Owned by the diagram plugin.
   */
  meta?: Record<string, unknown>;
}

export function createEmptyModel(direction: Direction = 'TD', kind: DiagramKind = 'flowchart'): DiagramModel {
  return { kind, direction, nodes: [], edges: [] };
}

/**
 * Validate referential integrity: every edge must point at existing nodes,
 * node ids must be unique. Returns a list of problems (empty = valid).
 */
export function validateModel(model: DiagramModel): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const node of model.nodes) {
    if (ids.has(node.id)) problems.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
  }
  for (const edge of model.edges) {
    if (!ids.has(edge.source)) problems.push(`edge ${edge.id}: unknown source ${edge.source}`);
    if (!ids.has(edge.target)) problems.push(`edge ${edge.id}: unknown target ${edge.target}`);
  }
  return problems;
}
