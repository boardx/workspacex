import { z } from 'zod';

/** Content contract only. Actor identity, ACL and durable sequence belong to the host. */
export const WHITEBOARD_LIMITS = { objects: 10000, tombstones: 10000, text: 20000, batch: 200, extensionBytes: 16384 } as const;
export const WhiteboardObjectId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const WhiteboardGeometry = z.object({
  x: z.number().finite().min(-1000000).max(1000000), y: z.number().finite().min(-1000000).max(1000000),
  width: z.number().finite().positive().max(100000), height: z.number().finite().positive().max(100000),
  rotation: z.number().finite().min(-360).max(360),
}).strict();
export const WhiteboardStyle = z.object({
  fill: z.string().max(64).optional(), stroke: z.string().max(64).optional(),
  color: z.string().max(64).optional(), fontSize: z.number().min(8).max(200).optional(),
}).strict();
export const WhiteboardObject = z.object({
  id: WhiteboardObjectId, schemaVersion: z.literal(1),
  kind: z.enum(['sticky', 'text', 'rectangle', 'ellipse', 'frame', 'group', 'connector', 'image', 'drawing', 'extension']),
  geometry: WhiteboardGeometry, text: z.string().max(WHITEBOARD_LIMITS.text), style: WhiteboardStyle,
  parentId: WhiteboardObjectId.nullable().default(null), orderKey: z.string().max(128).default(''),
  /** Containers stay addressable while ungrouped so the operation can be undone atomically. */
  containerState: z.enum(['active', 'ungrouped']).optional(),
  connector: z.object({ from: WhiteboardObjectId, to: WhiteboardObjectId }).strict().optional(),
  restoredFrom: WhiteboardObjectId.optional(),
  extensionData: z.record(z.unknown()).optional().superRefine((value, ctx) => {
    if (!value) return;
    try {
      const encoded = JSON.stringify(value);
      if (new TextEncoder().encode(encoded).length > WHITEBOARD_LIMITS.extensionBytes) throw new Error();
      const visit = (item: unknown, depth: number): void => {
        if (depth > 8) throw new Error();
        if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
        if (typeof item === 'number' && Number.isFinite(item)) return;
        if (Array.isArray(item)) { item.forEach(v => visit(v, depth + 1)); return; }
        if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
          for (const [key, val] of Object.entries(item)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error();
            visit(val, depth + 1);
          }
          return;
        }
        throw new Error();
      };
      visit(value, 0);
    } catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Extension must be bounded plain JSON' }); }
  }),
}).strict().superRefine((object, ctx) => {
  if ((object.kind === 'connector') !== Boolean(object.connector)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Connector endpoints required only for connector objects' });
  if (object.containerState === 'ungrouped' && !['frame', 'group'].includes(object.kind)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only containers may be ungrouped' });
});
export type WhiteboardObject = z.infer<typeof WhiteboardObject>;
export const WhiteboardCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), object: WhiteboardObject }).strict(),
  z.object({ type: z.literal('geometry'), id: WhiteboardObjectId, geometry: WhiteboardGeometry }).strict(),
  z.object({ type: z.literal('text'), id: WhiteboardObjectId, index: z.number().int().nonnegative(), deleteCount: z.number().int().nonnegative(), insert: z.string().max(WHITEBOARD_LIMITS.text) }).strict(),
  z.object({ type: z.literal('style'), id: WhiteboardObjectId, style: WhiteboardStyle }).strict(),
  z.object({ type: z.literal('parent'), id: WhiteboardObjectId, parentId: WhiteboardObjectId.nullable(), orderKey: z.string().max(128) }).strict(),
  z.object({ type: z.literal('translate'), id: WhiteboardObjectId, delta: z.object({ x: z.number().finite(), y: z.number().finite() }).strict() }).strict(),
  z.object({ type: z.literal('group'), object: WhiteboardObject, memberIds: z.array(WhiteboardObjectId).min(1).max(WHITEBOARD_LIMITS.batch) }).strict(),
  z.object({ type: z.literal('frame'), object: WhiteboardObject, memberIds: z.array(WhiteboardObjectId).max(WHITEBOARD_LIMITS.batch) }).strict(),
  z.object({ type: z.literal('ungroup'), id: WhiteboardObjectId }).strict(),
  z.object({ type: z.literal('delete'), id: WhiteboardObjectId }).strict(),
]);
export type WhiteboardCommand = z.infer<typeof WhiteboardCommand>;
export const WhiteboardCommandBatch = z.array(WhiteboardCommand).min(1).max(WHITEBOARD_LIMITS.batch);
