import { inflateRawSync } from 'node:zlib';
import { WHITEBOARD_IMPORT_LIMITS as L, type WhiteboardImportSource } from '@repo/contracts/whiteboard-import';
import type { ImportedBoardItem } from '@repo/whiteboard-core';

export class UnsafeWhiteboardImport extends Error {
  constructor(readonly code: 'UNSUPPORTED_FORMAT' | 'UNSAFE_ARCHIVE' | 'PAYLOAD_TOO_LARGE') { super(code); }
}
export interface ParsedImportAsset { path: string; bytes: Uint8Array; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; }
export interface ParsedWhiteboardImport { items: ImportedBoardItem[]; assets: ParsedImportAsset[]; skipped: string[]; sourceIdentity:{boardId:string|null;revision:string|null}; }
type R = Record<string, unknown>;
type SourceContext = { sourceVersion?: string; sourceBoardId?: string };
type ZipEntry = { name: string; flags: number; method: number; crc: number; compressedSize: number; size: number; localOffset: number; directory: boolean };
const UNSUPPORTED_ZIP_FLAGS = 0x2061; // encrypted, patched data, strong encryption, encrypted central directory
const record = (value: unknown): R => value && typeof value === 'object' && !Array.isArray(value) ? value as R : {};
const str = (...values: unknown[]) => String(values.find(value => typeof value === 'string' || typeof value === 'number') ?? '');
const num = (fallback: number, ...values: unknown[]) => { const value = values.find(value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')); const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const nullable = (...values: unknown[]) => { const value = str(...values); return value ? value : null; };
const safeMetadata = (value: R): R => Object.fromEntries(Object.entries(value).filter(([key, entry]) => ['semanticRelation', 'tags', 'status', 'sourceVersion', 'sourceBoardId'].includes(key) && (typeof entry === 'string' || (Array.isArray(entry) && entry.every(v => typeof v === 'string')))).slice(0, 20));
const identity=(items:ImportedBoardItem[])=>{const metadata=record(items[0]?.metadata),boardId=nullable(metadata.sourceBoardId),revision=nullable(metadata.sourceVersion);return{boardId,revision};};
function jsonIdentity(bytes:Uint8Array){try{const root=record(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))),board=record(root.board),mural=record(root.mural);return{boardId:nullable(board.id,mural.id,root.boardId),revision:nullable(root.exportVersion,root.version,root.schemaVersion)};}catch{return{boardId:null,revision:null};}}

function typeOf(raw: string): ImportedBoardItem['type'] {
  const value = raw.toLowerCase().replace(/[ _-]/g, '');
  if (['sticky', 'stickynote', 'sticker', 'note'].includes(value)) return 'sticky';
  if (['text', 'textbox', 'title'].includes(value)) return 'text';
  if (['shape', 'rectangle', 'circle', 'ellipse', 'diamond', 'triangle', 'hexagon'].includes(value)) return 'shape';
  if (['connector', 'arrow', 'line'].includes(value)) return 'connector';
  if (['image', 'picture'].includes(value)) return 'image';
  if (['frame', 'area', 'panel', 'section'].includes(value)) return 'panel';
  if (['group', 'cluster'].includes(value)) return 'group';
  if (['card', 'tile'].includes(value)) return 'tile';
  return 'unsupported';
}
function normalize(raw: unknown, index: number, source: WhiteboardImportSource, context: SourceContext = {}): ImportedBoardItem {
  const value = record(raw), position = record(value.position), geometry = record(value.geometry), size = record(value.size), style = record(value.style), content = record(value.content);
  const sourceType = str(value.type, value.kind, value.widgetType) || 'unknown', type = typeOf(sourceType);
  const start = record(value.startWidget), end = record(value.endWidget), from = record(value.connectedFrom), to = record(value.connectedTo);
  return {
    sourceId: str(value.id, value.widgetId, `${source}-${index}`).slice(0, 256), sourceType: sourceType.slice(0, 128), type,
    x: num(0, value.x, position.x, geometry.x), y: num(0, value.y, position.y, geometry.y), width: num(200, value.width, size.width, geometry.width), height: num(120, value.height, size.height, geometry.height), rotation: num(0, value.rotation, geometry.rotation),
    text: str(value.text, value.title, content.text, content.plainText).slice(0, 20_000), color: nullable(value.color, value.backgroundColor, style.backgroundColor, style.fillColor),
    shape: nullable(value.shape, value.shapeType, style.shape, type === 'shape' ? sourceType : null),
    parentSourceId: nullable(value.parentId, record(value.parent).id), fromSourceId: nullable(value.fromId, value.startId, start.id, from.id), toSourceId: nullable(value.toId, value.endId, end.id, to.id),
    zIndex: Math.trunc(num(index, value.zIndex, value.order)), assetRef: nullable(value.assetPath, value.imagePath, value.fileName, record(value.asset).path), assetMime: null,
    metadata: safeMetadata({ ...record(value.metadata), semanticRelation: value.semanticRelation, ...context }),
  };
}
function parseJson(bytes: Uint8Array, source: WhiteboardImportSource): ImportedBoardItem[] {
  let body: unknown; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT'); }
  const root = record(body), board = record(root.board), mural = record(root.mural), data = record(root.data);
  const candidate = source === 'miro'
    ? root.widgets ?? root.items ?? root.objects ?? data.widgets ?? data.items ?? board.widgets ?? board.items
    : root.items ?? root.widgets ?? root.objects ?? mural.widgets ?? mural.items ?? data.widgets ?? data.items;
  if (!Array.isArray(candidate)) throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  const context = { sourceVersion: nullable(root.exportVersion, root.version, root.schemaVersion) ?? undefined, sourceBoardId: nullable(board.id, mural.id, root.boardId) ?? undefined };
  return candidate.map((value, index) => normalize(value, index, source, context));
}
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]!; if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c; } else if (c === '"') quoted = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; } else field += c; }
  if (quoted) throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT'); if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); } return rows;
}
function parseCsv(bytes: Uint8Array, source: WhiteboardImportSource): ImportedBoardItem[] {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT'); }
  const rows = csvRows(text); if (rows.length < 2) throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  const header = rows[0]!.map(value => value.trim()), objects = rows.slice(1).filter(row => row.some(Boolean)).map(row => Object.fromEntries(header.map((key, index) => [key, row[index] ?? ''])));
  return objects.map((value, index) => normalize(value, index, source));
}
function safePath(path: string): boolean { return path.length > 0 && path.length <= 512 && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/') && !/^[a-z]:/i.test(path) && path.split('/').length <= L.pathDepth && path.split('/').every(part => part && part !== '.' && part !== '..'); }
function boundedDimensions(width: number, height: number): boolean { return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 32_768 && height <= 32_768 && width * height <= 100_000_000; }
function crc32(bytes: Uint8Array): number { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function imageMime(bytes: Uint8Array): ParsedImportAsset['mime'] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), ascii = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes.length >= 45 && Buffer.from(bytes.subarray(0, 8)).toString('hex') === '89504e470d0a1a0a' && view.getUint32(8) === 13 && ascii(12, 16) === 'IHDR') {
    let offset = 8, hasEnd = false;
    while (offset + 12 <= bytes.length) { const length = view.getUint32(offset); if (length > bytes.length - offset - 12 || crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)) return null; const type = ascii(offset + 4, offset + 8); offset += 12 + length; if (type === 'IEND') { hasEnd = length === 0 && offset === bytes.length; break; } }
    return hasEnd && boundedDimensions(view.getUint32(16), view.getUint32(20)) ? 'image/png' : null;
  }
  if (bytes.length >= 14 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return bytes.at(-1) === 0x3b && boundedDimensions(view.getUint16(6, true), view.getUint16(8, true)) ? 'image/gif' : null;
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    for (let offset = 2; offset + 4 <= bytes.length - 2;) { if (bytes[offset] !== 0xff) return null; while (bytes[offset] === 0xff) offset++; const marker = bytes[offset++]!; if (marker === 0xd9 || marker === 0xda) break; if (offset + 2 > bytes.length) return null; const length = view.getUint16(offset); if (length < 2 || offset + length > bytes.length) return null; if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 7 && boundedDimensions(view.getUint16(offset + 3), view.getUint16(offset + 5)) ? 'image/jpeg' : null; offset += length; }
    return null;
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && view.getUint32(4, true) + 8 === bytes.length && view.getUint32(16, true) <= bytes.length - 20) {
    const kind = ascii(12, 16); let width = 0, height = 0;
    if (kind === 'VP8X' && bytes.length >= 30) { width = 1 + bytes[24]! + (bytes[25]! << 8) + (bytes[26]! << 16); height = 1 + bytes[27]! + (bytes[28]! << 8) + (bytes[29]! << 16); }
    else if (kind === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) { width = view.getUint16(26, true) & 0x3fff; height = view.getUint16(28, true) & 0x3fff; }
    else if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) { const bits = view.getUint32(21, true); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
    return boundedDimensions(width, height) ? 'image/webp' : null;
  }
  return null;
}

function readZipDirectory(bytes: Uint8Array): { entries: ZipEntry[]; centralOffset: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), minimum = Math.max(0, bytes.length - 22 - 65_535); let eocd = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset--) if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  if (eocd < 0 || eocd + 22 + view.getUint16(eocd + 20, true) !== bytes.length || view.getUint16(eocd + 4, true) !== 0 || view.getUint16(eocd + 6, true) !== 0) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
  const diskEntries = view.getUint16(eocd + 8, true), total = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
  if (diskEntries !== total || total === 0xffff || centralOffset === 0xffffffff || centralSize === 0xffffffff || total > L.files || centralOffset + centralSize !== eocd) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
  const names = new Set<string>(), entries: ZipEntry[] = []; let offset = centralOffset, expanded = 0;
  for (let index = 0; index < total; index++) {
    if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), crc = view.getUint32(offset + 16, true), compressedSize = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true), extraLength = view.getUint16(offset + 30, true), commentLength = view.getUint16(offset + 32, true), external = view.getUint32(offset + 38, true), localOffset = view.getUint32(offset + 42, true), end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > eocd || (flags & UNSUPPORTED_ZIP_FLAGS) !== 0 || ![0, 8].includes(method) || [compressedSize, size, localOffset].includes(0xffffffff) || (external >>> 16 & 0o170000) === 0o120000) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
    let name: string; try { name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 46, offset + 46 + nameLength)); } catch { throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE'); }
    const directory = name.endsWith('/');
    if (!safePath(directory ? name.slice(0, -1) : name) || names.has(name)) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE'); names.add(name);
    if (!directory) { if (size > L.entryBytes || expanded + size > L.expandedBytes || (size > 0 && compressedSize === 0) || (compressedSize > 0 && size / compressedSize > L.compressionRatio)) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE'); expanded += size; }
    entries.push({ name, flags, method, crc, compressedSize, size, localOffset, directory }); offset = end;
  }
  if (offset !== eocd) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
  return { entries, centralOffset };
}
function extractZipEntry(bytes: Uint8Array, entry: ZipEntry, centralOffset: number): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), offset = entry.localOffset;
  const localFlags=offset+30<=centralOffset?view.getUint16(offset+6,true):-1;
  if (offset + 30 > centralOffset || view.getUint32(offset, true) !== 0x04034b50 || localFlags !== entry.flags || view.getUint16(offset + 8, true) !== entry.method
    || (!(localFlags&8)&&(view.getUint32(offset+14,true)!==entry.crc||view.getUint32(offset+18,true)!==entry.compressedSize||view.getUint32(offset+22,true)!==entry.size))) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
  const nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true), start = offset + 30 + nameLength + extraLength, end = start + entry.compressedSize;
  let localName: string; try { localName = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 30, offset + 30 + nameLength)); } catch { throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE'); }
  if (localName !== entry.name || start > centralOffset || end > centralOffset) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
  const compressed = bytes.subarray(start, end); let output: Uint8Array;
  try { output = entry.method === 0 ? new Uint8Array(compressed) : new Uint8Array(inflateRawSync(compressed, { maxOutputLength: Math.min(L.entryBytes, entry.size) + 1 })); } catch { throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE'); }
  if (output.byteLength !== entry.size || crc32(output) !== entry.crc) throw new UnsafeWhiteboardImport('UNSAFE_ARCHIVE');
  return output;
}
async function parseZip(bytes: Uint8Array, source: WhiteboardImportSource): Promise<ParsedWhiteboardImport> {
  const directory = readZipDirectory(bytes), files = directory.entries.filter(entry => !entry.directory);
  const document = files.find(file => /\.(json|csv)$/i.test(file.name)); if (!document) throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  const documentBytes = extractZipEntry(bytes, document, directory.centralOffset), items = document.name.toLowerCase().endsWith('.csv') ? parseCsv(documentBytes, source) : parseJson(documentBytes, source);
  const assets: ParsedImportAsset[] = [], skipped: string[] = [];
  for (const file of files.filter(file => file !== document)) { const data = extractZipEntry(bytes, file, directory.centralOffset), mime = imageMime(data); if (mime) assets.push({ path: file.name, bytes: data, mime }); else skipped.push(file.name); }
  const byPath = new Map(assets.map(asset => [asset.path, asset])); for (const item of items) if (item.assetRef) { const asset = byPath.get(item.assetRef); item.assetRef = asset?.path ?? null; item.assetMime = asset?.mime ?? null; }
  return { items, assets, skipped, sourceIdentity:document.name.toLowerCase().endsWith('.json')?jsonIdentity(documentBytes):identity(items) };
}
export async function parseWhiteboardImport(bytes: Uint8Array, mime: 'application/json' | 'text/csv' | 'application/zip', source: WhiteboardImportSource): Promise<ParsedWhiteboardImport> {
  if (bytes.byteLength < 1 || bytes.byteLength > L.uploadBytes) throw new UnsafeWhiteboardImport('PAYLOAD_TOO_LARGE');
  if (mime === 'application/zip') { if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT'); return parseZip(bytes, source); }
  if (bytes.some(value => value === 0)) throw new UnsafeWhiteboardImport('UNSUPPORTED_FORMAT');
  const items = mime === 'application/json' ? parseJson(bytes, source) : parseCsv(bytes, source);
  for (const item of items) if (item.assetRef) { item.assetRef = null; item.assetMime = null; }
  return { items, assets: [], skipped: [], sourceIdentity:mime==='application/json'?jsonIdentity(bytes):identity(items) };
}
