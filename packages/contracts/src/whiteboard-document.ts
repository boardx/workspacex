import { z } from 'zod';

/** Content contract only. Actor identity, ACL and durable sequence belong to the host. */
export const WHITEBOARD_LIMITS = { objects: 5000, tombstones: 10000, text: 20000, batch: 200, extensionBytes: 16384 } as const;
const BINARY_KEY = /(base64|binary|bytes?|blob|payload|buffers?|chunks?|fragments?)/i;
const OPAQUE_KEY = /opaque/i;

function decodesAsBinaryBase64(value: string): boolean {
  const compact = value.trim();
  if (compact.length < 4 || compact.length % 4 === 1 || !/^[a-z0-9+/_-]+={0,2}$/i.test(compact)) return false;
  try {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const encoded = compact.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
    const output: number[] = [];
    let accumulator = 0, bits = 0;
    for (const character of encoded) {
      const digit = alphabet.indexOf(character);
      if (digit < 0) return false;
      accumulator = (accumulator << 6) | digit;
      bits += 6;
      if (bits >= 8) { bits -= 8; output.push((accumulator >> bits) & 0xff); }
    }
    const decoded = Uint8Array.from(output);
    if (!decoded.length) return false;
    const printable = decoded.filter(byte => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)).length;
    return printable / decoded.length < 0.85;
  } catch { return false; }
}
function hasFragmentedBinary(value: unknown): boolean {
  const fragments: string[] = [];
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') { fragments.push(candidate.trim()); return; }
    if (Array.isArray(candidate)) { candidate.forEach(visit); return; }
    if (candidate && typeof candidate === 'object' && Object.getPrototypeOf(candidate) === Object.prototype) Object.values(candidate as Record<string, unknown>).forEach(visit);
  };
  visit(value);
  return fragments.length > 1
    && fragments.every(fragment => fragment.length >= 2 && fragment.length <= 12 && /^[a-z0-9_-]+$/i.test(fragment) && /[A-Z0-9_-]/.test(fragment))
    && decodesAsBinaryBase64(fragments.join(''));
}
/** Single inert-JSON validator shared by contract parsing and the content-object domain. */
export function validateWhiteboardExtensionData(value: unknown, depth = 0, key = ''): void {
  if (depth > 8) throw new Error('UNSAFE_EXTENSION');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'string') {
    if (/^(data|blob):/i.test(value.trim())) throw new Error('UNSAFE_EXTENSION_URL');
    const compact = value.trim();
    if (compact && BINARY_KEY.test(key)) throw new Error('UNSAFE_EXTENSION_BINARY');
    if (compact && OPAQUE_KEY.test(key) && decodesAsBinaryBase64(compact)) throw new Error('UNSAFE_EXTENSION_BINARY');
    const base64Like = compact.length >= 8 && compact.length % 4 === 0 && /^[a-z0-9+/_-]*={0,2}$/i.test(compact);
    if (base64Like && (compact.length >= 128 || /[+/=]/.test(compact))) throw new Error('UNSAFE_EXTENSION_BINARY');
    return;
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('UNSAFE_EXTENSION'); return; }
  if (Array.isArray(value)) {
    const possibleBytes = value.filter(item => item !== null);
    const bytes = possibleBytes.length > 0 && possibleBytes.every(item => Number.isInteger(item) && item >= 0 && item <= 255);
    const mixedBytes = value.some(item => typeof item === 'number') && value.filter(item => typeof item === 'number').every(item => Number.isInteger(item) && item >= 0 && item <= 255);
    if (bytes || mixedBytes || (BINARY_KEY.test(key) && value.length > 0) || (OPAQUE_KEY.test(key) && hasFragmentedBinary(value))) throw new Error('UNSAFE_EXTENSION_BINARY');
    value.forEach(item => validateWhiteboardExtensionData(item, depth + 1, key)); return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('UNSAFE_EXTENSION_BINARY');
  if (OPAQUE_KEY.test(key) && hasFragmentedBinary(value)) throw new Error('UNSAFE_EXTENSION_BINARY');
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    if (['__proto__', 'constructor', 'prototype'].includes(childKey)) throw new Error('UNSAFE_EXTENSION');
    validateWhiteboardExtensionData(child, depth + 1, `${key}.${childKey}`);
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
