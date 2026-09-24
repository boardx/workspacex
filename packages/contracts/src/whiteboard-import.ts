import { z } from 'zod';
import { BoardId } from './whiteboard';
const record = z.record(z.unknown());
const id = z.string().min(1).max(500);
export const DiagramSourceRef = z.object({ threadId: id, messageId: id, blockId: id, kind: z.enum(['mermaid','canvas','persona']) }).strict();
export type DiagramSourceRef = z.infer<typeof DiagramSourceRef>;
export const DiagramImportBundle = z.object({
  schemaVersion: z.literal(1), converterVersion: z.literal('diagram-copy/1'), groupId: id,
  payloadReferenceSpace: z.literal('source-local'), nodeIds: z.record(z.string()), edgeIds: z.record(z.string()), diagnostics: z.array(z.string().max(2000)).max(200),
  model: z.object({ kind: z.string(), direction: z.string(), meta: record.optional(),
    nodes: z.array(z.object({ id, label: z.string().max(20000), shape: z.string(), x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), members: z.array(z.string()).optional(), methods: z.array(z.string()).optional(), lifelineHeight: z.number().finite().optional(), data: record.optional() }).strict()).max(199),
    edges: z.array(z.object({ id, source: id, target: id, label: z.string().optional(), kind: z.string(), sourceLabel: z.string().optional(), targetLabel: z.string().optional(), order: z.number().optional(), seqY: z.number().finite().optional(), data: record.optional() }).strict()).max(199),
  }).strict(),
}).strict();
// Keep a type-only name separate from the runtime schema. Consumers that also
// compose the contracts namespace can then import the inferred payload without
// TypeScript resolving the merged schema symbol as a value.
export type DiagramImportBundleData = z.infer<typeof DiagramImportBundle>;
export type DiagramImportBundle = DiagramImportBundleData;
export const DiagramImportLossCode = z.enum(['SOURCE_DIAGNOSTIC','SHAPE_APPROXIMATION','SPECIALIZED_EDITING_UNAVAILABLE','ZERO_SIZE_EXPANDED','CONNECTOR_SEMANTICS_APPROXIMATED','PLUGIN_STYLE_NOT_RENDERED']);
export type DiagramImportLossCode = z.infer<typeof DiagramImportLossCode>;
export const ImportDiagramInput = z.object({ requestId: z.string().uuid(), acceptedLosses: z.array(DiagramImportLossCode).max(6), sourceRef: DiagramSourceRef, bundle: DiagramImportBundle }).strict();
export type ImportDiagramInput = z.infer<typeof ImportDiagramInput>;
export const ImportDiagramResult = z.object({ boardId: BoardId, groupId: z.string().min(1), epoch: z.number().int().positive(), seq: z.number().int().nonnegative() }).strict();
export const operations = { importDiagram: { method: 'POST', path: '/whiteboards/:boardId/import-diagram', in: ImportDiagramInput, out: ImportDiagramResult } } as const;
