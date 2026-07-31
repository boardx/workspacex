/**
 * fabric-markdown — bidirectional conversion between Mermaid flowcharts in
 * Markdown and editable Fabric.js canvas objects.
 */
import type { Canvas } from 'fabric';
import { extractMermaidBlocks, replaceMermaidBlock, wrapAsMermaidBlock } from './markdown';
import { mermaidToModel } from './mermaid-parser';
import { templateToModel } from './diagrams/template-engine';
import { parseUsecase } from './diagrams/usecase';
import { modelToMermaid } from './mermaid-serializer';
import { renderToCanvas, extractModel, getConnectionManager } from './canvas-io';
import type { DiagramModel } from './model';
import type { MermaidBlock } from './markdown';

import './diagrams';

export * from './model';
export { registerDiagram, pluginForKind, pluginForType } from './diagrams/registry';
export { personaToModel, serializePersona, parsePersonaText, PERSONA_FIELDS, PERSONA_SECTIONS } from './diagrams/persona';
export {
  registerTemplate,
  getTemplate,
  listTemplates,
  templateToModel,
  serializeTemplate,
  parseTemplateText,
  setTemplateBackgroundProvider,
  STICKY_COLORS,
} from './diagrams/template-engine';
export type { TemplateBackgroundProvider } from './diagrams/template-engine';
export { parseUsecase, serializeUsecase } from './diagrams/usecase';
export type { TemplateSpec, TemplateSection } from './diagrams/template-engine';
export type { DiagramPlugin, DiagramParseContext } from './diagrams/registry';
export { extractMermaidBlocks, replaceMermaidBlock, wrapAsMermaidBlock } from './markdown';
export type { MermaidBlock } from './markdown';
export { mermaidToModel, extractNodeGeometry, classRelationToEdge } from './mermaid-parser';
export { modelToMermaid, sanitizeNodeId } from './mermaid-serializer';
export { FlowNode, FlowEdge } from './fabric-objects';
export type { FlowNodeData, FlowEdgeData } from './fabric-objects';
export { ConnectionManager, anchorPoint } from './connection-manager';
export { renderToCanvas, extractModel, getConnectionManager, fitToContent } from './canvas-io';
export type { FitToContentOptions } from './canvas-io';

export interface MarkdownToCanvasResult {
  model: DiagramModel;
  /** The mermaid block that was converted (useful for writing back later). */
  block: MermaidBlock;
}

/**
 * Parse the Nth ```mermaid block of a markdown document and render it as
 * editable fabric objects. Requires a browser environment.
 */
export async function markdownToCanvas(
  markdown: string,
  canvas: Canvas,
  blockIndex = 0,
): Promise<MarkdownToCanvasResult> {
  const blocks = extractMermaidBlocks(markdown);
  const block = blocks[blockIndex];
  if (!block) {
    throw new Error(
      `markdown contains ${blocks.length} convertible block(s); index ${blockIndex} not found`,
    );
  }
  const model =
    block.lang === 'persona'
      ? templateToModel(block.code, 'persona')
      : block.lang === 'canvas'
        ? templateToModel(block.code)
        : block.lang === 'usecase'
          ? parseUsecase(block.code)
          : await mermaidToModel(block.code);
  renderToCanvas(model, canvas);
  return { model, block };
}

/** Serialize the canvas diagram to mermaid flowchart source. */
export function canvasToMermaid(canvas: Canvas): string {
  return modelToMermaid(extractModel(canvas));
}

/**
 * Serialize the canvas diagram back into a markdown document.
 * When `originalMarkdown` contains a mermaid block at `blockIndex`, the block
 * is replaced in place; otherwise a fresh fenced block is returned/appended.
 */
export function canvasToMarkdown(
  canvas: Canvas,
  originalMarkdown?: string,
  blockIndex = 0,
): string {
  const model = extractModel(canvas);
  const code = modelToMermaid(model);
  const lang =
    model.kind === 'template'
      ? model.meta?.templateKey === 'persona'
        ? 'persona'
        : 'canvas'
      : model.kind === 'usecase'
        ? 'usecase'
        : 'mermaid';
  if (originalMarkdown !== undefined) {
    const blocks = extractMermaidBlocks(originalMarkdown);
    const block = blocks[blockIndex];
    if (block) return replaceMermaidBlock(originalMarkdown, block, code);
    const sep = originalMarkdown.endsWith('\n') ? '' : '\n';
    return originalMarkdown + sep + '\n' + wrapAsMermaidBlock(code, lang) + '\n';
  }
  return wrapAsMermaidBlock(code, lang);
}
