import { WhiteboardGeometry, validateWhiteboardExtensionData, type WhiteboardObject } from '@repo/contracts/whiteboard-document';

export const SHAPE_VARIANTS = [
  'rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'diamond', 'triangle',
  'hexagon', 'cloud', 'database', 'document', 'process', 'decision',
  'terminator', 'data', 'predefined-process',
] as const;
export type ShapeVariant = typeof SHAPE_VARIANTS[number];
export type BorderStyle = 'solid' | 'dashed' | 'dotted';
export type DrawingTool = 'pen' | 'marker' | 'highlighter' | 'eraser';
export type ContentObjectType = 'shape' | 'drawing' | 'image' | 'tile' | 'web-tile' | 'table' | 'icon' | 'template';

export const SHAPE_SEMANTICS: Record<ShapeVariant, string> = {
  rectangle: 'generic', 'rounded-rectangle': 'generic', circle: 'generic', ellipse: 'generic', diamond: 'decision',
  triangle: 'generic', hexagon: 'preparation', cloud: 'external-system', database: 'data-store', document: 'document',
  process: 'process', decision: 'decision', terminator: 'terminator', data: 'input-output', 'predefined-process': 'subprocess',
};

interface ContentBase { version: 1; type: ContentObjectType; }
export interface ShapeContent extends ContentBase {
  type: 'shape'; variant: ShapeVariant; semanticRole?: string; fill: string; borderColor: string;
  borderWidth: number; borderStyle: BorderStyle; opacity: number; radius: number;
  textColor: string; horizontalAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
}
export interface StrokePoint { x: number; y: number; pressure: number; }
export interface DrawingStroke {
  id: string; tool: DrawingTool; points: StrokePoint[]; color: string; width: number; opacity: number; erases?: string[];
}
export interface DrawingContent extends ContentBase { type: 'drawing'; strokes: DrawingStroke[]; }
export interface ImageContent extends ContentBase {
  type: 'image'; status: 'uploading' | 'ready' | 'failed'; assetId: string | null;
  sourceUrl: string | null; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/svg+xml';
  intrinsicWidth: number; intrinsicHeight: number;
  crop: { x: number; y: number; width: number; height: number };
  opacity: number; borderColor: string; borderWidth: number; cornerRadius: number;
  fileName: string; replacementOf: string | null; failureCode: string | null;
  byteSize?: number; contentDigest?: string | null; magicMimeType?: ImageContent['mimeType'] | null;
  retryCount?: number;
  /** local-session means bytes are verified but must be uploaded before another browser can render them. */
  persistence?: 'durable' | 'local-session';
}
export interface TileField { key: string; label: string; value: string; }
export interface TileContent extends ContentBase {
  type: 'tile'; tileType: 'document' | 'task' | 'agent' | 'file' | 'data' | 'person' | 'project' | 'prompt' | 'ai-result';
  title: string; description: string; icon: string | null; coverAssetId: string | null;
  fields: TileField[]; tags: string[]; link: string | null; status: string | null; actions: string[];
}
export interface WebTileContent extends ContentBase {
  type: 'web-tile'; url: string; title: string; description: string; imageUrl: string | null;
  siteName: string | null; fetchStatus: 'pending' | 'ready' | 'failed';
}
export interface TableContent extends ContentBase {
  type: 'table'; title?: string; columns: { id: string; name: string }[]; rows: { id: string; cells: Record<string, string> }[];
}
export interface IconContent extends ContentBase { type: 'icon'; name: string; set: string; color: string; }
export interface TemplateContent extends ContentBase {
  type: 'template'; templateId: string; name: string; versionId: string; parameters: Record<string, string>;
  objects?: TemplateObjectBlueprint[];
}
export interface TemplateObjectBlueprint {
  localId: string; geometry: WhiteboardObject['geometry']; text?: string; content: Exclude<CanonicalContentObject, TemplateContent>;
}
export type CanonicalContentObject = ShapeContent | DrawingContent | ImageContent | TileContent | WebTileContent | TableContent | IconContent | TemplateContent;

type JsonRecord = Record<string, unknown>;
const TYPES = new Set<ContentObjectType>(['shape', 'drawing', 'image', 'tile', 'web-tile', 'table', 'icon', 'template']);
const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/i;

/** Unknown fields stay forward compatible only while remaining bounded, inert JSON. */
export function validateSafeExtensionTree(value: unknown, depth = 0): void {
  validateWhiteboardExtensionData(value, depth);
}

function record(value: unknown, code = 'CONTENT_OBJECT_INVALID'): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error(code);
  return value as JsonRecord;
}
function text(value: unknown, max: number, code = 'CONTENT_OBJECT_INVALID'): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(code);
  return value;
}
function requiredText(value: unknown, max: number, code = 'CONTENT_OBJECT_INVALID'): string {
  const result = text(value, max, code); if (!result) throw new Error(code); return result;
}
function number(value: unknown, min: number, max: number, code = 'CONTENT_OBJECT_INVALID'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(code);
  return value;
}
function integer(value: unknown, min: number, max: number, code = 'CONTENT_OBJECT_INVALID'): number {
  const result = number(value, min, max, code); if (!Number.isInteger(result)) throw new Error(code); return result;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], code = 'CONTENT_OBJECT_INVALID'): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new Error(code); return value as T;
}
function color(value: unknown): string { const result = text(value, 9); if (!HEX.test(result)) throw new Error('CONTENT_COLOR_INVALID'); return result.toUpperCase(); }
function nullableText(value: unknown, max: number): string | null { return value === null ? null : text(value, max); }
function safeUrl(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const raw = requiredText(value, 2048, 'CONTENT_URL_INVALID');
  let parsed: URL; try { parsed = new URL(raw); } catch { throw new Error('CONTENT_URL_INVALID'); }
  if (parsed.protocol !== 'https:') throw new Error('CONTENT_URL_INVALID');
  if (parsed.username || parsed.password) throw new Error('CONTENT_URL_INVALID');
  return parsed.toString();
}
function stringArray(value: unknown, maxItems: number, itemMax: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('CONTENT_OBJECT_INVALID');
  return value.map(item => text(item, itemMax));
}
function exactKeys(raw: JsonRecord, allowed: readonly string[], code = 'CONTENT_OBJECT_UNKNOWN_FIELD'): void {
  const known = new Set(['version', 'type', ...allowed]);
  for (const key of Object.keys(raw)) if (!known.has(key)) throw new Error(code);
}
function nestedExactKeys(raw: JsonRecord, allowed: readonly string[], code = 'CONTENT_OBJECT_UNKNOWN_FIELD'): void {
  const known = new Set(allowed);
  for (const key of Object.keys(raw)) if (!known.has(key)) throw new Error(code);
}
function base(raw: JsonRecord, type: ContentObjectType, allowed: readonly string[]): ContentBase {
  if (raw.version !== 1 || raw.type !== type) throw new Error('CONTENT_OBJECT_INVALID');
  validateSafeExtensionTree(raw);
  exactKeys(raw, allowed);
  return { version: 1, type };
}

export function parseContentObject(input: unknown): CanonicalContentObject {
  const raw = record(input);
  if (typeof raw.type !== 'string' || !TYPES.has(raw.type as ContentObjectType)) throw new Error('CONTENT_OBJECT_TYPE_INVALID');
  const type = raw.type as ContentObjectType;
  if (type === 'shape') {
    const variant = oneOf(raw.variant, SHAPE_VARIANTS);
    if (raw.semanticRole !== undefined && raw.semanticRole !== SHAPE_SEMANTICS[variant]) throw new Error('SHAPE_SEMANTIC_INVALID');
    return {
    ...base(raw, type, ['variant', 'semanticRole', 'fill', 'borderColor', 'borderWidth', 'borderStyle', 'opacity', 'radius', 'textColor', 'horizontalAlign', 'verticalAlign']), variant, semanticRole: SHAPE_SEMANTICS[variant], fill: color(raw.fill), borderColor: color(raw.borderColor),
    borderWidth: number(raw.borderWidth, 0, 100), borderStyle: oneOf(raw.borderStyle, ['solid', 'dashed', 'dotted'] as const),
    opacity: number(raw.opacity, 0, 1), radius: number(raw.radius, 0, 10000), textColor: color(raw.textColor),
    horizontalAlign: oneOf(raw.horizontalAlign, ['left', 'center', 'right'] as const),
    verticalAlign: oneOf(raw.verticalAlign, ['top', 'middle', 'bottom'] as const),
    } as ShapeContent;
  }
  if (type === 'drawing') {
    if (!Array.isArray(raw.strokes) || raw.strokes.length > 128) throw new Error('DRAWING_STROKES_INVALID');
    const priorStrokeIds = new Set<string>();
    const strokes = raw.strokes.map(value => {
      const stroke = record(value, 'DRAWING_STROKE_INVALID');
      nestedExactKeys(stroke, ['id', 'tool', 'points', 'color', 'width', 'opacity', 'erases']);
      if (!Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length > 512) throw new Error('DRAWING_POINTS_INVALID');
      const tool = oneOf(stroke.tool, ['pen', 'marker', 'highlighter', 'eraser'] as const, 'DRAWING_TOOL_INVALID');
      const erases = stroke.erases === undefined ? [] : stringArray(stroke.erases, 128, 128);
      if (tool === 'eraser' && (erases.length === 0 || erases.some(id => !priorStrokeIds.has(id)))) throw new Error('DRAWING_ERASER_TARGET_INVALID');
      if (tool !== 'eraser' && erases.length > 0) throw new Error('DRAWING_ERASER_TARGET_INVALID');
      const parsed = {
        id: requiredText(stroke.id, 128, 'DRAWING_STROKE_INVALID'),
        tool,
        points: stroke.points.map(value => { const point = record(value, 'DRAWING_POINT_INVALID'); nestedExactKeys(point, ['x', 'y', 'pressure']); return { x: number(point.x, -1000000, 1000000), y: number(point.y, -1000000, 1000000), pressure: number(point.pressure, 0, 1) }; }),
        color: color(stroke.color), width: number(stroke.width, 0.1, 1000), opacity: number(stroke.opacity, 0, 1), erases,
      } as DrawingStroke;
      priorStrokeIds.add(parsed.id);
      return parsed;
    });
    if (new Set(strokes.map(stroke => stroke.id)).size !== strokes.length) throw new Error('DRAWING_STROKE_ID_DUPLICATE');
    return { ...base(raw, type, ['strokes']), strokes } as DrawingContent;
  }
  if (type === 'image') {
    const crop = record(raw.crop, 'IMAGE_CROP_INVALID');
    const mimeType = oneOf(raw.mimeType, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] as const, 'IMAGE_MIME_INVALID');
    const status = oneOf(raw.status, ['uploading', 'ready', 'failed'] as const, 'IMAGE_STATUS_INVALID');
    const assetId = nullableText(raw.assetId, 256), sourceUrl = safeUrl(raw.sourceUrl, true), failureCode = nullableText(raw.failureCode, 128);
    const byteSize = integer(raw.byteSize ?? 0, 0, 2_000_000_000), contentDigest = nullableText(raw.contentDigest ?? null, 80);
    const retryCount = integer(raw.retryCount ?? 0, 0, 100);
    const persistence = oneOf(raw.persistence ?? 'durable', ['durable', 'local-session'] as const, 'IMAGE_PERSISTENCE_INVALID');
    const magicMimeType = raw.magicMimeType === null || raw.magicMimeType === undefined ? null : oneOf(raw.magicMimeType, ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'] as const, 'IMAGE_MIME_INVALID');
    if (status === 'ready' && !assetId && !sourceUrl) throw new Error('IMAGE_SOURCE_REQUIRED');
    if (status === 'ready' && (byteSize < 1 || !contentDigest || !SHA256.test(contentDigest) || magicMimeType !== mimeType)) throw new Error('IMAGE_METADATA_INVALID');
    if (persistence === 'local-session' && (!assetId || !/^local-session-[a-zA-Z0-9_-]+$/.test(assetId))) throw new Error('IMAGE_SESSION_ASSET_INVALID');
    if (persistence === 'durable' && assetId?.startsWith('local-session-')) throw new Error('IMAGE_SESSION_ASSET_INVALID');
    if (status === 'failed' && !failureCode) throw new Error('IMAGE_FAILURE_REQUIRED');
    const fileName = requiredText(raw.fileName, 512);
    if (/[/\\\0-\x1f]/.test(fileName) || fileName === '.' || fileName === '..') throw new Error('IMAGE_FILE_NAME_INVALID');
    return {
      ...base(raw, type, ['status', 'assetId', 'sourceUrl', 'mimeType', 'intrinsicWidth', 'intrinsicHeight', 'crop', 'opacity', 'borderColor', 'borderWidth', 'cornerRadius', 'fileName', 'replacementOf', 'failureCode', 'byteSize', 'contentDigest', 'magicMimeType', 'retryCount', 'persistence']), status, assetId, sourceUrl, mimeType,
      intrinsicWidth: integer(raw.intrinsicWidth, status === 'ready' ? 1 : 0, 100000), intrinsicHeight: integer(raw.intrinsicHeight, status === 'ready' ? 1 : 0, 100000),
      crop: validateCrop(crop),
      opacity: number(raw.opacity, 0, 1), borderColor: color(raw.borderColor), borderWidth: number(raw.borderWidth, 0, 100),
      cornerRadius: number(raw.cornerRadius, 0, 10000), fileName,
      replacementOf: nullableText(raw.replacementOf, 256), failureCode, byteSize,
      contentDigest: contentDigest?.toLowerCase() ?? null, magicMimeType, retryCount, persistence,
    } as ImageContent;
  }
  if (type === 'tile') {
    if (!Array.isArray(raw.fields) || raw.fields.length > 100) throw new Error('TILE_FIELDS_INVALID');
    const fields = raw.fields.map(value => { const field = record(value); nestedExactKeys(field, ['key', 'label', 'value']); return { key: requiredText(field.key, 128), label: text(field.label, 256), value: text(field.value, 4000) }; });
    if (new Set(fields.map(field => field.key)).size !== fields.length) throw new Error('TILE_FIELD_KEY_DUPLICATE');
    return {
      ...base(raw, type, ['tileType', 'title', 'description', 'icon', 'coverAssetId', 'fields', 'tags', 'link', 'status', 'actions']), tileType: oneOf(raw.tileType, ['document', 'task', 'agent', 'file', 'data', 'person', 'project', 'prompt', 'ai-result'] as const),
      title: text(raw.title, 1000), description: text(raw.description, 10000), icon: nullableText(raw.icon, 256), coverAssetId: nullableText(raw.coverAssetId, 256), fields,
      tags: stringArray(raw.tags, 100, 128), link: safeUrl(raw.link, true), status: nullableText(raw.status, 128), actions: stringArray(raw.actions, 32, 128),
    } as TileContent;
  }
  if (type === 'web-tile') return {
    ...base(raw, type, ['url', 'title', 'description', 'imageUrl', 'siteName', 'fetchStatus']), url: safeUrl(raw.url)!, title: text(raw.title, 1000), description: text(raw.description, 4000),
    imageUrl: safeUrl(raw.imageUrl, true), siteName: nullableText(raw.siteName, 256), fetchStatus: oneOf(raw.fetchStatus, ['pending', 'ready', 'failed'] as const),
  } as WebTileContent;
  if (type === 'table') {
    if (!Array.isArray(raw.columns) || raw.columns.length < 1 || raw.columns.length > 50 || !Array.isArray(raw.rows) || raw.rows.length > 200) throw new Error('TABLE_DIMENSIONS_INVALID');
    const columns = raw.columns.map(value => { const column = record(value); nestedExactKeys(column, ['id', 'name']); return { id: requiredText(column.id, 128), name: text(column.name, 256) }; });
    if (new Set(columns.map(column => column.id)).size !== columns.length) throw new Error('TABLE_COLUMN_ID_DUPLICATE');
    const ids = new Set(columns.map(column => column.id));
    const rows = raw.rows.map(value => { const row = record(value), cells = record(row.cells); nestedExactKeys(row, ['id', 'cells']); for (const key of Object.keys(cells)) if (!ids.has(key)) throw new Error('TABLE_CELL_COLUMN_UNKNOWN'); return { id: requiredText(row.id, 128), cells: Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, text(value, 4000)])) }; });
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('TABLE_ROW_ID_DUPLICATE');
    return { ...base(raw, type, ['title', 'columns', 'rows']), title: text(raw.title ?? '', 1000), columns, rows } as TableContent;
  }
  if (type === 'icon') return { ...base(raw, type, ['name', 'set', 'color']), name: requiredText(raw.name, 256), set: requiredText(raw.set, 128), color: color(raw.color) } as IconContent;
  const parameters = record(raw.parameters);
  const objects = raw.objects === undefined ? [] : raw.objects;
  if (!Array.isArray(objects) || objects.length > 100) throw new Error('TEMPLATE_OBJECTS_INVALID');
  const parsedObjects = objects.map(value => {
    const item = record(value, 'TEMPLATE_OBJECT_INVALID');
    nestedExactKeys(item, ['localId', 'geometry', 'text', 'content']);
    const content = parseContentObject(item.content);
    if (content.type === 'template') throw new Error('TEMPLATE_NESTING_INVALID');
    const title = semanticContentTitle(content);
    if (title !== null && item.text !== undefined && item.text !== title) throw new Error('CONTENT_TEXT_MISMATCH');
    return { localId: requiredText(item.localId, 128), geometry: WhiteboardGeometry.parse(item.geometry), ...(item.text === undefined ? {} : { text: text(item.text, 20000) }), content } as TemplateObjectBlueprint;
  });
  if (new Set(parsedObjects.map(item => item.localId)).size !== parsedObjects.length) throw new Error('TEMPLATE_LOCAL_ID_DUPLICATE');
  return { ...base(raw, 'template', ['templateId', 'name', 'versionId', 'parameters', 'objects']), templateId: requiredText(raw.templateId, 256), name: requiredText(raw.name, 512), versionId: requiredText(raw.versionId, 256), parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [requiredText(key, 128), text(value, 4000)])), objects: parsedObjects } as TemplateContent;
}

export function readContentObject(object: WhiteboardObject): CanonicalContentObject | null {
  const value = object.extensionData?.contentObject;
  return value === undefined ? null : parseContentObject(value);
}

/** Structured cards expose one authoritative title mirrored to the canvas text field. */
export function semanticContentTitle(content: CanonicalContentObject): string | null {
  if (content.type === 'tile' || content.type === 'web-tile') return content.title;
  if (content.type === 'table') return content.title ?? '';
  if (content.type === 'icon') return content.name;
  if (content.type === 'template') return content.name;
  return null;
}

export function updateDrawingStroke(
  content: DrawingContent,
  strokeId: string,
  patch: Partial<Pick<DrawingStroke, 'color' | 'width' | 'opacity'>>,
): DrawingContent {
  const index = content.strokes.findIndex(stroke => stroke.id === strokeId);
  if (index < 0) throw new Error('DRAWING_STROKE_NOT_FOUND');
  const strokes = content.strokes.map((stroke, at) => at === index ? { ...stroke, ...structuredClone(patch) } : structuredClone(stroke));
  return parseContentObject({ ...structuredClone(content), strokes }) as DrawingContent;
}

export function appendDrawingStroke(content: DrawingContent, stroke: DrawingStroke): DrawingContent {
  return parseContentObject({ ...structuredClone(content), strokes: [...content.strokes, structuredClone(stroke)] }) as DrawingContent;
}

export function drawingEraserLayers(content: DrawingContent): { stroke: DrawingStroke; targetStrokeIds: string[] }[] {
  const parsed = parseContentObject(content) as DrawingContent;
  return parsed.strokes.filter(stroke => stroke.tool === 'eraser').map(stroke => ({ stroke, targetStrokeIds: [...(stroke.erases ?? [])] }));
}

function validateCrop(crop: JsonRecord): ImageContent['crop'] {
  nestedExactKeys(crop, ['x', 'y', 'width', 'height']);
  const result = {
    x: number(crop.x, 0, 1), y: number(crop.y, 0, 1),
    width: number(crop.width, 0.0001, 1), height: number(crop.height, 0.0001, 1),
  };
  if (result.x + result.width > 1 || result.y + result.height > 1) throw new Error('IMAGE_CROP_INVALID');
  return result;
}

/** Called by the document validator so remote Yjs updates obey the same model contract. */
export function validateContentExtension(object: WhiteboardObject): void {
  validateSafeExtensionTree(object.extensionData ?? {});
  if (object.extensionData?.contentObject !== undefined) {
    const content = parseContentObject(object.extensionData.contentObject);
    const title = semanticContentTitle(content);
    if (title !== null && object.text !== title) throw new Error('CONTENT_TEXT_MISMATCH');
  }
}
