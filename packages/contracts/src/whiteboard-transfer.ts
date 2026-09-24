import { z } from 'zod';
import { Board, BoardId, CreateBoard } from './whiteboard';
import { WHITEBOARD_LIMITS, WhiteboardObject } from './whiteboard-document';

export const PORTABLE_BOARD = {
  format: 'workspacex.board',
  schemaVersion: 1,
  maxBytes: 16 * 1024 * 1024,
  sampleSourceIds: 5,
} as const;

export const PortableBoardPayload = z.object({
  format: z.literal(PORTABLE_BOARD.format),
  schemaVersion: z.literal(PORTABLE_BOARD.schemaVersion),
  source: z.object({
    application: z.literal('WorkspaceX'),
    boardId: BoardId,
    name: z.string().trim().min(1).max(200),
  }).strict(),
  objects: z.array(WhiteboardObject).max(WHITEBOARD_LIMITS.objects),
}).strict();
export type PortableBoardPayload = z.infer<typeof PortableBoardPayload>;

export const PortableBoardManifest = z.object({
  algorithm: z.literal('sha256'),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  objectCount: z.number().int().nonnegative().max(WHITEBOARD_LIMITS.objects),
  contentModel: z.literal('whiteboard-object.v1'),
}).strict();

/** RFC-8785-style key ordering over the bounded JSON shapes used by Board transfer. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('Canonical Board JSON accepts finite plain JSON values only');
}

// Browser-safe synchronous SHA-256 keeps canonical package creation identical in Web and Node.
const SHA256_K = [
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
] as const;
const rotateRight = (value: number, shift: number) => (value >>> shift) | (value << (32 - shift));
export function sha256Hex(text: string): string {
  const source = new TextEncoder().encode(text);
  const paddedLength = Math.ceil((source.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength); bytes.set(source); bytes[source.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = BigInt(source.length) * 8n;
  view.setUint32(paddedLength - 8, Number((bitLength >> 32n) & 0xffffffffn));
  view.setUint32(paddedLength - 4, Number(bitLength & 0xffffffffn));
  const state = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = words[i - 15]!, y = words[i - 2]!;
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[i] = (words[i - 16]! + s0 + words[i - 7]! + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const t1 = (h! + s1 + choice + SHA256_K[i]! + words[i]!) >>> 0;
      const s0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (s0 + majority) >>> 0;
      h=g; g=f; f=e; e=(d!+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    const next = [a,b,c,d,e,f,g,h];
    for (let i = 0; i < 8; i++) state[i] = (state[i]! + next[i]!) >>> 0;
  }
  return [...state].map(value => value.toString(16).padStart(8, '0')).join('');
}

export function canonicalPortablePayload(payload: PortableBoardPayload): string {
  const value = payload as PortableBoardPayload;
  return canonicalJson(PortableBoardPayload.parse({
    format: value.format, schemaVersion: value.schemaVersion, source: value.source, objects: value.objects,
  }));
}
export function portablePayloadDigest(payload: PortableBoardPayload): string {
  return sha256Hex(canonicalPortablePayload(payload));
}

export const PortableBoardPackage = PortableBoardPayload.extend({
  manifest: PortableBoardManifest,
}).strict().superRefine((value, ctx) => {
  if (value.manifest.objectCount !== value.objects.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['manifest', 'objectCount'], message: 'Object count does not match payload' });
  }
  try {
    if (value.manifest.payloadDigest !== portablePayloadDigest(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['manifest', 'payloadDigest'], message: 'Payload digest does not match canonical payload' });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['manifest', 'payloadDigest'], message: 'Canonical payload is invalid' });
  }
});
export type PortableBoardPackage = z.infer<typeof PortableBoardPackage>;

export function createPortableBoardPackage(raw: PortableBoardPayload): PortableBoardPackage {
  const payload = PortableBoardPayload.parse(raw);
  const canonicalPayload = PortableBoardPayload.parse({ ...payload, objects: [...payload.objects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) });
  return PortableBoardPackage.parse({
    ...canonicalPayload,
    manifest: {
      algorithm: 'sha256', payloadDigest: portablePayloadDigest(canonicalPayload),
      objectCount: canonicalPayload.objects.length, contentModel: 'whiteboard-object.v1',
    },
  });
}

export function serializePortableBoardPackage(value: PortableBoardPackage): string {
  return canonicalJson(PortableBoardPackage.parse(value));
}

export const ImportQualityBucket = z.object({
  count: z.number().int().nonnegative().max(WHITEBOARD_LIMITS.objects),
  sampleSourceIds: z.array(z.string().min(1).max(256)).max(PORTABLE_BOARD.sampleSourceIds),
}).strict();
export const ImportQualitySummary = z.object({
  complete: ImportQualityBucket,
  approximate: ImportQualityBucket,
  degraded: ImportQualityBucket,
  skipped: ImportQualityBucket,
}).strict();
export type ImportQualitySummary = z.infer<typeof ImportQualitySummary>;

export function completeImportQuality(ids: readonly string[]): ImportQualitySummary {
  const sampleSourceIds = [...ids].sort().slice(0, PORTABLE_BOARD.sampleSourceIds);
  return { complete: { count: ids.length, sampleSourceIds }, approximate: { count: 0, sampleSourceIds: [] },
    degraded: { count: 0, sampleSourceIds: [] }, skipped: { count: 0, sampleSourceIds: [] } };
}

export const ImportBoardInput = z.object({
  requestId: CreateBoard.shape.requestId,
  name: Board.shape.name.optional(),
  package: PortableBoardPackage,
}).strict();
export type ImportBoardInput = z.infer<typeof ImportBoardInput>;

export const ImportBoardPreview = z.object({
  sourceName: Board.shape.name,
  destinationName: Board.shape.name,
  objectCount: z.number().int().nonnegative(),
  frameCount: z.number().int().nonnegative(),
  groupCount: z.number().int().nonnegative(),
  connectorCount: z.number().int().nonnegative(),
  identitiesRemapped: z.number().int().nonnegative(),
  contentLosses: z.array(z.object({ code: z.string().max(64), count: z.number().int().positive(), message: z.string().max(300) }).strict()).max(20),
  quality: ImportQualitySummary,
}).strict().superRefine((value, ctx) => {
  const imported = value.quality.complete.count + value.quality.approximate.count + value.quality.degraded.count;
  if (imported !== value.objectCount || value.quality.skipped.count !== 0) {
    ctx.addIssue({ code:z.ZodIssueCode.custom,path:['quality'],message:'Portable preview quality must account for every imported object' });
  }
});
export type ImportBoardPreview = z.infer<typeof ImportBoardPreview>;

export const ImportBoardResult = z.object({
  board: Board,
  importedObjects: z.number().int().nonnegative(),
  remappedObjects: z.number().int().nonnegative(),
  replayed: z.boolean(),
}).strict();

export const operations = {
  exportBoard: { method: 'GET', path: '/whiteboards/:boardId/export', out: PortableBoardPackage },
  previewImport: { method: 'POST', path: '/whiteboards/imports/preview', in: ImportBoardInput, out: ImportBoardPreview },
  importBoard: { method: 'POST', path: '/whiteboards/imports', in: ImportBoardInput, out: ImportBoardResult },
} as const;
