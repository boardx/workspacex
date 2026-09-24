import {
  EXTERNAL_BOARD_IMPORT,
  ExternalBoardSnapshot,
  ExternalImportConversion,
  ExternalImportOptions,
  type ExternalImportLoss,
} from '@repo/contracts/whiteboard-migration';
import { PortableBoardPackage } from '@repo/contracts/whiteboard-transfer';
import { WhiteboardObject, type WhiteboardObject as BoardObject } from '@repo/contracts/whiteboard-document';

export type ExternalImportResult =
  | ({ ok: true } & ExternalImportConversion)
  | { ok: false; code: 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_FORMAT' | 'INVALID_SNAPSHOT' | 'CAPACITY'; detail: string };

type SourceGeometry = { x: number; y: number; width: number; height: number; rotation?: number };
type SourceObject = {
  id: string; pageId: string; type: string; text?: string; geometry?: SourceGeometry;
  parentId?: string; relativeToParent?: boolean; shape?: 'rectangle' | 'ellipse';
  fillColor?: string; textColor?: string; from?: string; to?: string; positionRelativeTo?: string;
};

const knownKinds: Record<string, BoardObject['kind']> = {
  sticky_note: 'sticky', 'sticky-note': 'sticky', sticky: 'sticky', card: 'sticky',
  text: 'text', textbox: 'text', title: 'text', frame: 'frame', area: 'frame',
  shape: 'rectangle', rectangle: 'rectangle', ellipse: 'ellipse',
};

/** Converts a versioned Miro REST or Mural Public API snapshot into the portable import package. */
export function convertExternalBoardSnapshot(input: unknown, rawOptions: unknown): ExternalImportResult {
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(input)).length; }
  catch { return { ok: false, code: 'INVALID_SNAPSHOT', detail: 'Snapshot must be serializable JSON.' }; }
  if (bytes > EXTERNAL_BOARD_IMPORT.maxBytes) return { ok: false, code: 'PAYLOAD_TOO_LARGE', detail: `Snapshot exceeds ${EXTERNAL_BOARD_IMPORT.maxBytes} bytes.` };
  if (!isPlainJson(input, 0)) return { ok: false, code: 'INVALID_SNAPSHOT', detail: 'Snapshot must contain bounded plain JSON values only.' };
  if (!isSupportedEnvelope(input)) return { ok: false, code: 'UNSUPPORTED_FORMAT', detail: 'Only version 1 Miro REST and Mural Public API snapshots are supported.' };
  const options = ExternalImportOptions.safeParse(rawOptions);
  const parsed = ExternalBoardSnapshot.safeParse(input);
  if (!options.success || !parsed.success) return { ok: false, code: 'INVALID_SNAPSHOT', detail: 'Snapshot does not match a supported versioned Miro or Mural export.' };

  const snapshot = parsed.data;
  let provider: 'miro' | 'mural';
  let sourceBoardId: string;
  let sourceName: string;
  const losses: ExternalImportLoss[] = [];
  const sources: SourceObject[] = [];
  if (snapshot.format === 'miro.rest.board-snapshot') {
    provider = 'miro'; sourceBoardId = snapshot.board.id; sourceName = snapshot.board.name;
    for (const page of snapshot.pages) for (const item of page.items) {
      const position = item.position;
      const geometry = position && 'width' in position ? position
        : position && item.geometry ? { ...item.geometry, x: position.x, y: position.y } : undefined;
      sources.push({
        id: item.id, pageId: page.id, type: item.type, text: item.data?.content ?? item.data?.title ?? item.content, geometry,
        parentId: item.parent?.id ?? item.parentId, shape: item.data?.shape === 'ellipse' ? 'ellipse' : item.shape,
        fillColor: item.style?.fillColor ?? item.fillColor, textColor: item.style?.textColor ?? item.textColor,
        from: item.startConnection?.item ?? item.startItemId, to: item.endConnection?.item ?? item.endItemId,
        positionRelativeTo: item.position && !('width' in item.position) ? item.position.relativeTo : undefined,
      });
    }
  } else {
    provider = 'mural'; sourceBoardId = snapshot.mural.id; sourceName = snapshot.mural.name;
    if (!snapshot.drawingsIncluded) losses.push({ code: 'DRAWINGS_NOT_INCLUDED', message: 'The Mural snapshot declares that drawing data was not included.' });
    for (const page of snapshot.pages) for (const widget of page.widgets) {
      const directGeometry = widget.x !== undefined && widget.y !== undefined && widget.width !== undefined && widget.height !== undefined
        ? { x: widget.x, y: widget.y, width: widget.width, height: widget.height, ...(widget.rotation !== undefined ? { rotation: widget.rotation } : {}) } : undefined;
      sources.push({
        id: widget.id, pageId: page.id, type: widget.type, text: widget.htmlText ?? widget.text ?? widget.title, geometry: widget.position ?? directGeometry,
        parentId: widget.parentId, relativeToParent: widget.relativeToParent ?? Boolean(widget.parentId), shape: widget.shape,
        fillColor: widget.style?.fillColor ?? widget.style?.backgroundColor ?? widget.fillColor, textColor: widget.style?.textColor ?? widget.textColor,
        from: widget.startRefId ?? widget.startWidgetId, to: widget.endRefId ?? widget.endWidgetId,
      });
    }
  }
  if (sources.length > EXTERNAL_BOARD_IMPORT.maxObjects) return { ok: false, code: 'CAPACITY', detail: `Snapshot exceeds ${EXTERNAL_BOARD_IMPORT.maxObjects} source objects.` };
  if (new Set(sources.map(source => source.id)).size !== sources.length) return { ok: false, code: 'INVALID_SNAPSHOT', detail: 'Source object identities must be unique across the snapshot.' };

  const sourceById = new Map(sources.map(source => [source.id, source]));
  const absoluteGeometry = new Map<string, SourceGeometry>();
  const resolving = new Set<string>();
  const resolveGeometry = (source: SourceObject): SourceGeometry | undefined => {
    if (!source.geometry) return undefined;
    const existing = absoluteGeometry.get(source.id); if (existing) return existing;
    if (resolving.has(source.id)) throw new Error('Cyclic parent coordinates');
    resolving.add(source.id);
    let result = source.geometry;
    if (provider === 'mural' && source.relativeToParent && source.parentId) {
      const parent = sourceById.get(source.parentId);
      const parentGeometry = parent ? resolveGeometry(parent) : undefined;
      if (parentGeometry) result = { ...source.geometry, x: parentGeometry.x + source.geometry.x, y: parentGeometry.y + source.geometry.y };
    }
    resolving.delete(source.id); absoluteGeometry.set(source.id, result); return result;
  };

  try { for (const source of sources) resolveGeometry(source); }
  catch { return { ok: false, code: 'INVALID_SNAPSHOT', detail: 'Snapshot contains a cyclic parent coordinate chain.' }; }

  const ids = new Map<string, string>();
  let sequence = 0;
  const nextId = (): string => `external_${String(sequence++).padStart(6, '0')}`;
  const objects: BoardObject[] = [];
  const pendingParents: Array<{ object: BoardObject; source: SourceObject }> = [];
  let skipped = 0;
  const loss = (code: ExternalImportLoss['code'], source: SourceObject, message: string): void => {
    losses.push({ code, sourceObjectId: source.id, sourceType: source.type, message });
  };

  for (const source of sources) {
    if (['connector', 'arrow'].includes(source.type)) continue;
    if (source.type === 'drawing') { skipped++; loss('DRAWING_UNSUPPORTED', source, 'Freehand drawing is not represented by the portable object model.'); continue; }
    let kind = knownKinds[source.type];
    if (!kind) { skipped++; loss('UNKNOWN_OBJECT', source, `Unsupported ${provider} object type “${source.type}”.`); continue; }
    if (source.type === 'shape') kind = source.shape === 'ellipse' ? 'ellipse' : 'rectangle';
    const geometry = absoluteGeometry.get(source.id);
    if (!geometry) { skipped++; loss('INVALID_OBJECT', source, 'Object has no geometry and was skipped.'); continue; }
    const cleaned = sanitizeText(source.text ?? '');
    if (cleaned.changed) loss('FORMATTING_REMOVED', source, 'HTML formatting and active content were removed from editable text.');
    if (cleaned.text.length > 20_000) loss('TEXT_TRUNCATED', source, 'Text exceeded the Board object limit and was truncated to 20,000 characters.');
    if (provider === 'miro' && source.positionRelativeTo && source.positionRelativeTo !== 'canvas_center') {
      loss('POSITION_APPROXIMATED', source, `Miro position relativeTo “${source.positionRelativeTo}” was approximated in Board world coordinates.`);
    }
    const id = nextId(); ids.set(source.id, id);
    const coordinateSemantics = provider === 'miro' ? 'source-center-to-board-top-left' : source.relativeToParent ? 'source-parent-relative-to-board-absolute' : 'source-top-left-preserved';
    const boardGeometry = provider === 'miro'
      ? { x: geometry.x - geometry.width / 2, y: geometry.y - geometry.height / 2, width: geometry.width, height: geometry.height, rotation: geometry.rotation ?? 0 }
      : { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height, rotation: geometry.rotation ?? 0 };
    const style = { ...(source.fillColor ? { fill: source.fillColor } : {}), ...(source.textColor ? { color: source.textColor } : {}) };
    const object = WhiteboardObject.parse({
      id, schemaVersion: 1, kind, geometry: boardGeometry, text: cleaned.text.slice(0, 20_000), style,
      parentId: null, orderKey: String(objects.length).padStart(6, '0'),
      extensionData: { externalImport: { provider, sourceBoardId, sourcePageId: source.pageId, sourceObjectId: source.id, sourceType: source.type, coordinateSemantics } },
    });
    objects.push(object); pendingParents.push({ object, source });
  }

  // Parent restoration intentionally happens after all importable objects have identities.
  for (const pending of pendingParents) {
    if (!pending.source.parentId) continue;
    const parentId = ids.get(pending.source.parentId);
    const parent = parentId ? objects.find(object => object.id === parentId) : undefined;
    if (!parent || !['frame', 'group'].includes(parent.kind)) {
      loss('DANGLING_PARENT', pending.source, 'Parent is absent or is not an importable container; object was retained at board root.');
      continue;
    }
    pending.object.parentId = parent.id;
  }

  // Connector restoration is a separate pass so endpoints may appear in any source order.
  for (const source of sources.filter(item => ['connector', 'arrow'].includes(item.type))) {
    const from = source.from ? ids.get(source.from) : undefined;
    const to = source.to ? ids.get(source.to) : undefined;
    if (!from || !to) { skipped++; loss('DANGLING_CONNECTOR', source, 'Connector endpoint is missing or belongs to unsupported content.'); continue; }
    const id = nextId(); ids.set(source.id, id);
    objects.push(WhiteboardObject.parse({
      id, schemaVersion: 1, kind: 'connector', geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
      text: '', style: {}, parentId: null, orderKey: `connector_${String(objects.length).padStart(6, '0')}`,
      connector: { from, to },
      extensionData: { externalImport: { provider, sourceBoardId, sourcePageId: source.pageId, sourceObjectId: source.id, sourceType: source.type, coordinateSemantics: 'endpoint-reference' } },
    }));
  }

  const bundle = PortableBoardPackage.parse({
    format: 'workspacex.board', schemaVersion: 1, exportedAt: snapshot.exportedAt,
    source: { application: 'WorkspaceX', boardId: options.data.packageBoardId, name: sourceName },
    objects, provenance: { objectCount: objects.length, contentModel: 'whiteboard-object.v1' },
  });
  const conversion = ExternalImportConversion.parse({ package: bundle, preview: {
    provider, sourceBoardId, sourceName, importedObjectCount: objects.length, skippedObjectCount: skipped, losses,
  } });
  return { ok: true, ...conversion };
}

function isSupportedEnvelope(input: unknown): boolean {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const envelope = input as Record<string, unknown>;
  return envelope.schemaVersion === 1 && (envelope.format === 'miro.rest.board-snapshot' || envelope.format === 'mural.public-api.mural-snapshot');
}

function isPlainJson(value: unknown, depth: number): boolean {
  if (depth > 20) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(item => isPlainJson(item, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.entries(value).every(([key, item]) => !['__proto__', 'constructor', 'prototype'].includes(key) && isPlainJson(item, depth + 1));
}

function sanitizeText(source: string): { text: string; changed: boolean } {
  const decoded = source.replace(/&(?:nbsp|#160);/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, digits: string) => safeCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => safeCodePoint(Number.parseInt(digits, 16)));
  const withoutActive = decoded.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const withoutTags = withoutActive.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<[^>]*>/g, '');
  const text = withoutTags.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, changed: text !== source };
}

function safeCodePoint(value: number): string {
  return Number.isInteger(value) && value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : '';
}
