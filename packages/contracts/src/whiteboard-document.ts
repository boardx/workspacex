import { z } from 'zod';

/** Content contract only. Actor identity, ACL and durable sequence belong to the host. */
export const WHITEBOARD_LIMITS = { objects: 5000, tombstones: 10000, text: 20000, batch: 200, extensionBytes: 16384 } as const;
/** Single inert-JSON validator shared by contract parsing and the content-object domain. */
export function validateWhiteboardExtensionData(value: unknown, depth = 0, key = ''): void {
  if (depth > 8) throw new Error('UNSAFE_EXTENSION');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (/^(data|blob):/i.test(value.trim())) throw new Error('UNSAFE_EXTENSION_URL');
    const compact = value.trim();
    const base64Like = compact.length >= 8 && compact.length % 4 === 0 && /^[a-z0-9+/_-]*={0,2}$/i.test(compact);
    if (base64Like && (/(base64|binary|bytes|blob|payload|buffer)/i.test(key) || compact.length >= 128 || /[+/=]/.test(compact))) throw new Error('UNSAFE_EXTENSION_BINARY');
    return;
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('UNSAFE_EXTENSION'); return; }
  if (Array.isArray(value)) {
    const bytes = value.length > 0 && value.every(item => Number.isInteger(item) && item >= 0 && item <= 255);
    if (bytes) throw new Error('UNSAFE_EXTENSION_BINARY');
    value.forEach(item => validateWhiteboardExtensionData(item, depth + 1, key)); return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('UNSAFE_EXTENSION_BINARY');
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (['__proto__', 'constructor', 'prototype'].includes(childKey)) throw new Error('UNSAFE_EXTENSION');
    validateWhiteboardExtensionData(child, depth + 1, childKey);
  }
}
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
  connector: z.object({ from: WhiteboardObjectId, to: WhiteboardObjectId }).strict().optional(),
  restoredFrom: WhiteboardObjectId.optional(),
  extensionData: z.record(z.unknown()).optional().superRefine((value, ctx) => {
    if (!value) return;
    try {
      const encoded = JSON.stringify(value);
      if (new TextEncoder().encode(encoded).length > WHITEBOARD_LIMITS.extensionBytes) throw new Error();
      validateWhiteboardExtensionData(value);
    } catch (error) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: error instanceof Error && error.message.startsWith('UNSAFE_EXTENSION') ? error.message : 'Extension must be bounded plain JSON' }); }
  }),
}).strict().superRefine((object, ctx) => {
  if ((object.kind === 'connector') !== Boolean(object.connector)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Connector endpoints required only for connector objects' });
});
export type WhiteboardObject = z.infer<typeof WhiteboardObject>;
export const WhiteboardCommand = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), object: WhiteboardObject }).strict(),
  z.object({ type: z.literal('geometry'), id: WhiteboardObjectId, geometry: WhiteboardGeometry }).strict(),
  z.object({ type: z.literal('text'), id: WhiteboardObjectId, index: z.number().int().nonnegative(), deleteCount: z.number().int().nonnegative(), insert: z.string().max(WHITEBOARD_LIMITS.text) }).strict(),
  z.object({ type: z.literal('style'), id: WhiteboardObjectId, style: WhiteboardStyle }).strict(),
  z.object({ type: z.literal('parent'), id: WhiteboardObjectId, parentId: WhiteboardObjectId.nullable(), orderKey: z.string().max(128) }).strict(),
  z.object({ type: z.literal('delete'), id: WhiteboardObjectId }).strict(),
]);
export type WhiteboardCommand = z.infer<typeof WhiteboardCommand>;
export const WhiteboardCommandBatch = z.array(WhiteboardCommand).min(1).max(WHITEBOARD_LIMITS.batch);
