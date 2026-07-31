/**
 * Plugin registry for diagram types beyond the built-in four
 * (flowchart/class/state/sequence). Each plugin lives in its own file under
 * src/diagrams/ and self-registers on import; the barrel (./index.ts) pulls
 * them all in.
 */
import type { DiagramModel, DiagramKind } from '../model';

export interface DiagramParseContext {
  /** mermaid's internal diagram db (from getDiagramFromText). */
  db: Record<string, unknown>;
  /** Rendered SVG root — optional aid; plugins should not depend on it. */
  svgRoot?: Element;
  /** Node geometry extracted from g.node elements (may be empty for chart types). */
  geometry: Map<string, { x: number; y: number; width: number; height: number }>;
}

export interface DiagramPlugin {
  /** DiagramModel.kind value this plugin produces/consumes. */
  kind: DiagramKind;
  /** mermaid diagram.type values this plugin handles (e.g. 'er', 'gantt'). */
  detects: string[];
  /** mermaid db (+ optional SVG) → IR. Must be pure enough to unit-test with db fixtures. */
  parse(ctx: DiagramParseContext): DiagramModel;
  /** IR → mermaid source. Pure. */
  serialize(model: DiagramModel): string;
}

const byDetect = new Map<string, DiagramPlugin>();
const byKind = new Map<string, DiagramPlugin>();

export function registerDiagram(plugin: DiagramPlugin): void {
  byKind.set(plugin.kind, plugin);
  for (const t of plugin.detects) byDetect.set(t, plugin);
}

export function pluginForType(diagramType: string): DiagramPlugin | undefined {
  return byDetect.get(diagramType);
}

export function pluginForKind(kind: string): DiagramPlugin | undefined {
  return byKind.get(kind);
}
