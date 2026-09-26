import { describe, expect, it } from 'vitest';
import {
  BoardCommandPort,
  ContentObjectCommandPort,
  WhiteboardCommandOrigin,
  WhiteboardUndo,
  createContentObject,
  createContentObjectEnvelope,
  createWhiteboardDocument,
  parseContentObject,
  readContentObject,
  readObjects,
  validateDocument,
  type CanonicalContentObject,
  type ImageContent,
  type ShapeContent,
} from '../src';

const geometry = { x: 10, y: 20, width: 240, height: 160, rotation: 0 };
const identity = { boardId: 'board-1', clientId: 'browser-1' };
const shape = (variant: ShapeContent['variant'] = 'rectangle'): ShapeContent => ({
  version: 1, type: 'shape', variant, fill: '#FFFFFF', borderColor: '#242424',
  borderWidth: 2, borderStyle: 'solid', opacity: 1, radius: 12, textColor: '#242424',
  horizontalAlign: 'center', verticalAlign: 'middle',
});
const image = (status: ImageContent['status'] = 'ready'): ImageContent => ({
  version: 1, type: 'image', status, assetId: status === 'ready' ? 'asset-1' : null,
  sourceUrl: null, mimeType: 'image/png', intrinsicWidth: 1920, intrinsicHeight: 1080,
  crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, borderColor: '#FFFFFF',
  borderWidth: 0, cornerRadius: 8, fileName: 'research.png', replacementOf: null,
  failureCode: status === 'failed' ? 'UPLOAD_TIMEOUT' : null,
});

describe('canonical visual content models', () => {
  it('accepts the complete initial and flowchart shape vocabulary with bounded appearance', () => {
    const variants: ShapeContent['variant'][] = [
      'rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'diamond', 'triangle',
      'hexagon', 'cloud', 'database', 'document', 'process', 'decision', 'terminator',
      'data', 'predefined-process',
    ];
    expect(variants.map(variant => parseContentObject(shape(variant)).type)).toEqual(variants.map(() => 'shape'));
    expect(parseContentObject({ ...shape(), fill: '#aabbcc', borderStyle: 'dotted', opacity: 0.4 })).toMatchObject({ fill: '#AABBCC', borderStyle: 'dotted', opacity: 0.4 });
    expect(() => parseContentObject({ ...shape(), variant: 'script' })).toThrow('CONTENT_OBJECT_INVALID');
    expect(() => parseContentObject({ ...shape(), opacity: 2 })).toThrow('CONTENT_OBJECT_INVALID');
  });

  it('keeps drawing strokes vector-based including pressure and non-destructive eraser semantics', () => {
    const drawing = parseContentObject({
      version: 1, type: 'drawing', rendererHint: 'future-compositor', strokes: [
        { id: 'ink', tool: 'pen', points: [{ x: 0, y: 0, pressure: 0.2 }, { x: 4, y: 5, pressure: 0.8 }], color: '#001122', width: 4, opacity: 1 },
        { id: 'erase', tool: 'eraser', points: [{ x: 2, y: 2, pressure: 0.5 }, { x: 3, y: 3, pressure: 0.6 }], color: '#FFFFFF', width: 12, opacity: 1 },
      ],
    });
    expect(drawing).toMatchObject({ type: 'drawing', rendererHint: 'future-compositor' });
    expect(drawing.type === 'drawing' && drawing.strokes[1]).toMatchObject({ id: 'erase', tool: 'eraser' });
    expect(() => parseContentObject({ ...(drawing as object), strokes: [{ id: 'x', tool: 'pen', points: [{ x: 0, y: 0, pressure: 2 }, { x: 1, y: 1, pressure: 1 }], color: '#000000', width: 1, opacity: 1 }] })).toThrow();
  });

  it('models recoverable image upload, crop and replacement/download metadata', () => {
    expect(parseContentObject(image())).toMatchObject({ status: 'ready', fileName: 'research.png' });
    expect(parseContentObject(image('failed'))).toMatchObject({ status: 'failed', failureCode: 'UPLOAD_TIMEOUT' });
    expect(parseContentObject({ ...image(), assetId: 'asset-2', replacementOf: 'asset-1', crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, opacity: 0.7 })).toMatchObject({ assetId: 'asset-2', replacementOf: 'asset-1', opacity: 0.7 });
    expect(() => parseContentObject({ ...image(), assetId: null })).toThrow('IMAGE_SOURCE_REQUIRED');
    expect(() => parseContentObject({ ...image(), sourceUrl: 'javascript:alert(1)', assetId: null })).toThrow('CONTENT_URL_INVALID');
    expect(() => parseContentObject({ ...image('failed'), failureCode: null })).toThrow('IMAGE_FAILURE_REQUIRED');
    expect(() => parseContentObject({ ...image(), crop: { x: 0.5, y: 0, width: 0.6, height: 1 } })).toThrow('IMAGE_CROP_INVALID');
    expect(parseContentObject({ ...image('failed'), intrinsicWidth: 0, intrinsicHeight: 0 })).toMatchObject({ intrinsicWidth: 0, intrinsicHeight: 0 });
  });

  it('validates structured tiles, web tiles, tables, icons and templates', () => {
    const models: CanonicalContentObject[] = [
      parseContentObject({ version: 1, type: 'tile', tileType: 'task', title: 'Interview Grace', description: 'Research', icon: 'user', coverAssetId: null, fields: [{ key: 'owner', label: 'Owner', value: 'Grace' }], tags: ['research'], link: 'https://example.com/task', status: 'doing', actions: ['open'] }),
      parseContentObject({ version: 1, type: 'web-tile', url: 'https://example.com/a', title: 'Example', description: 'Preview', imageUrl: null, siteName: 'Example', fetchStatus: 'ready' }),
      parseContentObject({ version: 1, type: 'table', columns: [{ id: 'idea', name: 'Idea' }], rows: [{ id: 'row-1', cells: { idea: 'Prototype' } }] }),
      parseContentObject({ version: 1, type: 'icon', name: 'lightbulb', set: 'lucide', color: '#FFCC00' }),
      parseContentObject({ version: 1, type: 'template', templateId: 'retro', name: 'Retro', versionId: 'v1', parameters: { mood: 'happy' } }),
    ];
    expect(models.map(model => model.type)).toEqual(['tile', 'web-tile', 'table', 'icon', 'template']);
    expect(() => parseContentObject({ ...models[2], rows: [{ id: 'bad', cells: { missing: 'x' } }] })).toThrow('TABLE_CELL_COLUMN_UNKNOWN');
    expect(() => parseContentObject({ ...models[0], fields: [{ key: 'same', label: '', value: '' }, { key: 'same', label: '', value: '' }] })).toThrow('TILE_FIELD_KEY_DUPLICATE');
  });
});

describe('content object command boundary', () => {
  it('creates one caller-identified command and retains unknown outer and model extensions', () => {
    const content = { ...shape('cloud'), pluginData: { semanticRole: 'risk' } } as ShapeContent;
    const envelope = createContentObjectEnvelope({
      ...identity, gestureId: 'create-shape', id: 'shape-1', geometry, text: 'Risk',
      content, extensionData: { plugin: { future: true } },
    });
    expect(envelope.commands).toHaveLength(1);
    const doc = createWhiteboardDocument();
    const port = new BoardCommandPort(doc);
    const created = port.dispatch(envelope);
    expect(created.acceptedObjectIds).toEqual(['shape-1']);
    const object = readObjects(doc)[0]!;
    expect(object.kind).toBe('extension');
    expect(object.extensionData?.plugin).toEqual({ future: true });
    expect(readContentObject(object)).toMatchObject({ type: 'shape', variant: 'cloud', pluginData: { semanticRole: 'risk' } });
    doc.destroy();
  });

  it('returns an object-created event from the convenience command boundary', () => {
    const doc = createWhiteboardDocument();
    const accepted = createContentObject(new BoardCommandPort(doc), { ...identity, gestureId: 'create-icon', id: 'icon-1', geometry, content: { version: 1, type: 'icon', name: 'star', set: 'lucide', color: '#FFCC00' } });
    expect(accepted.event).toMatchObject({ type: 'ObjectCreated', objectId: 'icon-1', contentType: 'icon', operationId: accepted.operationId });
    doc.destroy();
  });

  it('edits atomically, emits before/after, is idempotent and participates in undo/redo', () => {
    const doc = createWhiteboardDocument();
    const undo = new WhiteboardUndo(doc);
    const creation = createContentObjectEnvelope({ ...identity, gestureId: 'create', id: 'shape-1', geometry, content: shape(), extensionData: { keep: 7 } });
    new BoardCommandPort(doc).dispatch(creation);
    const transactions: unknown[] = [];
    doc.on('afterTransaction', transaction => { if (transaction.origin instanceof WhiteboardCommandOrigin) transactions.push(transaction.origin); });
    const port = new ContentObjectCommandPort(doc);
    const input = { ...identity, gestureId: 'style-1', command: { type: 'replace-content' as const, id: 'shape-1', content: { ...shape(), fill: '#112233', borderStyle: 'dashed' as const, future: { semantic: true } } } };
    const accepted = port.dispatch(input);
    expect(port.dispatch(structuredClone(input))).toEqual(accepted);
    expect(transactions).toHaveLength(1);
    expect(accepted.event).toMatchObject({ type: 'ContentObjectUpdated', objectId: 'shape-1', before: { fill: '#FFFFFF' }, after: { fill: '#112233', future: { semantic: true } } });
    expect(readContentObject(readObjects(doc)[0]!)).toMatchObject({ fill: '#112233' });
    expect(readObjects(doc)[0]?.extensionData?.keep).toBe(7);
    expect(undo.undo()).toBe('undone');
    expect(readContentObject(readObjects(doc)[0]!)).toMatchObject({ fill: '#FFFFFF' });
    expect(undo.redo()).toBe(true);
    expect(readContentObject(readObjects(doc)[0]!)).toMatchObject({ fill: '#112233' });
    expect(() => port.dispatch({ ...input, command: { ...input.command, content: { ...shape(), fill: '#445566' } } })).toThrow('CONTENT_COMMAND_INVALID');
    undo.destroy(); doc.destroy();
  });

  it('recovers an upload failure by replacing image metadata without replacing object identity', () => {
    const doc = createWhiteboardDocument();
    new BoardCommandPort(doc).dispatch(createContentObjectEnvelope({ ...identity, gestureId: 'create-image', id: 'image-1', geometry, content: image('failed') }));
    const result = new ContentObjectCommandPort(doc).dispatch({
      ...identity, gestureId: 'retry-image', command: { type: 'replace-content', id: 'image-1', content: { ...image(), assetId: 'asset-new', replacementOf: null } },
    });
    expect(result.acceptedObjectIds).toEqual(['image-1']);
    expect(readObjects(doc)[0]?.id).toBe('image-1');
    expect(readContentObject(readObjects(doc)[0]!)).toMatchObject({ status: 'ready', assetId: 'asset-new', failureCode: null });
    doc.destroy();
  });

  it('preflights invalid edits without mutating the authority document', () => {
    const doc = createWhiteboardDocument();
    new BoardCommandPort(doc).dispatch(createContentObjectEnvelope({ ...identity, gestureId: 'create', id: 'shape-1', geometry, content: shape() }));
    const before = readObjects(doc);
    expect(() => new ContentObjectCommandPort(doc).dispatch({ ...identity, gestureId: 'bad', command: { type: 'replace-content', id: 'shape-1', content: image() } })).toThrow('CONTENT_OBJECT_TYPE_IMMUTABLE');
    expect(readObjects(doc)).toEqual(before);
    doc.destroy();
  });

  it('rejects invalid structured metadata introduced through the generic document boundary', () => {
    const doc = createWhiteboardDocument();
    const envelope = createContentObjectEnvelope({ ...identity, gestureId: 'create', id: 'shape-1', geometry, content: shape() });
    new BoardCommandPort(doc).dispatch(envelope);
    const item = doc.getMap<import('yjs').Map<unknown>>('objects').get('shape-1')!;
    item.set('extensionData', { contentObject: { ...shape(), opacity: 9 } });
    expect(() => validateDocument(doc)).toThrow('CONTENT_OBJECT_INVALID');
    doc.destroy();
  });
});
