import { z } from 'zod';
import * as Canvas from './canvas';
import { NativeSessionResolveInput } from './native-session-binding';
export const STANDARD_CANVAS_LIMITS = {maxResponseBytes:4194304,deadlineMs:30000} as const;
const canvasId = z.string().min(1).max(256);
export const CanvasReadInput = z.object({ canvasId }).strict();
export const CanvasUpdateInput = z.object({
  canvasId, expectedRevision: z.number().int().positive(),
  changes: z.object({ kind: z.literal('replace-source'), markdown: Canvas.operations.updateSource.in.shape.markdown.max(262144) }).strict(),
  idempotencyKey: z.string().min(1).max(128),
}).strict();
export const CanvasReadOutput = z.object({
  canvasId, source: z.string().max(262144), revision: z.number().int().positive(), versionId: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  supportedOperations: z.array(z.literal('replace-source')),
  renderSource: Canvas.operations.renderCanvas.out,
}).strict();
export const CanvasUpdateOutput = z.object({ newRevision: z.number().int().positive(), versionId: z.string(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), replayed: z.boolean() }).strict();
export const STANDARD_CANVAS_TOOLS = {
  wx_canvas_read: { input: CanvasReadInput, output: CanvasReadOutput },
  wx_canvas_update: { input: CanvasUpdateInput, output: CanvasUpdateOutput },
} as const;
const identity = NativeSessionResolveInput.omit({runId:true}).extend({toolCallId:z.string().min(1).max(256),permissionRequestId:z.string().uuid().optional()});
export const StandardCanvasInvocation = z.discriminatedUnion('toolName', [
  identity.extend({toolName:z.literal('wx_canvas_read'),toolArgs:CanvasReadInput}).strict(),
  identity.extend({toolName:z.literal('wx_canvas_update'),toolArgs:CanvasUpdateInput}).strict(),
]);
