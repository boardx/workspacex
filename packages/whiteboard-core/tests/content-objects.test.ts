import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  BoardCommandPort,
  ContentObjectCommandPort,
  WhiteboardCommandOrigin,
  WhiteboardUndo,
  createContentObject,
  createContentObjectEnvelope,
  createWhiteboardDocument,
  cloneDocument,
  appendDrawingStroke,
  drawingEraserLayers,
  instantiateTemplateEnvelope,
  parseContentObject,
  prepareWhiteboardUpdate,
  readContentObject,
  readObjects,
  validateDocument,
  updateDrawingStroke,
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
  sourceUrl: status === 'ready' ? 'https://cdn.example.com/asset-1.png' : null, mimeType: 'image/png', intrinsicWidth: 1920, intrinsicHeight: 1080,
  crop: { x: 0, y: 0, width: 1, height: 1 }, opacity: 1, borderColor: '#FFFFFF',
  borderWidth: 0, cornerRadius: 8, fileName: 'research.png', replacementOf: null,
  failureCode: status === 'failed' ? 'UPLOAD_TIMEOUT' : null, byteSize: status === 'ready' ? 4096 : 0,
  contentDigest: status === 'ready' ? `sha256:${'a'.repeat(64)}` : null, magicMimeType: status === 'ready' ? 'image/png' : null,
});

describe('canonical visual content models', () => {
  it('accepts the complete initial and flowchart shape vocabulary with bounded appearance', () => {
    const variants: ShapeContent['variant'][] = [
      'rectangle', 'rounded-rectangle', 'circle', 'ellipse', 'diamond', 'triangle',
      'hexagon', 'cloud', 'database', 'document', 'process', 'decision', 'terminator',
      'data', 'predefined-process',
    ];
    expect(variants.map(variant => parseContentObject(shape(variant)).type)).toEqual(variants.map(() => 'shape'));
    expect(variants.map(variant => (parseContentObject(shape(variant)) as ShapeContent).semanticRole)).toEqual([
      'generic', 'generic', 'generic', 'generic', 'decision', 'generic', 'preparation', 'external-system',
      'data-store', 'document', 'process', 'decision', 'terminator', 'input-output', 'subprocess',
    ]);
    expect(parseContentObject({ ...shape(), fill: '#aabbcc', borderStyle: 'dotted', opacity: 0.4 })).toMatchObject({ fill: '#AABBCC', borderStyle: 'dotted', opacity: 0.4 });
    expect(parseContentObject(shape('database'))).toMatchObject({ semanticRole: 'data-store' });
    expect(() => parseContentObject({ ...shape('database'), semanticRole: 'decision' })).toThrow('SHAPE_SEMANTIC_INVALID');
    expect(() => parseContentObject({ ...shape(), variant: 'script' })).toThrow('CONTENT_OBJECT_INVALID');
    expect(() => parseContentObject({ ...shape(), opacity: 2 })).toThrow('CONTENT_OBJECT_INVALID');
    for (const invalid of [
      { fill: 'red' }, { borderColor: 'red' }, { borderWidth: -1 }, { borderStyle: 'double' },
      { radius: -1 }, { textColor: 'red' }, { horizontalAlign: 'justify' }, { verticalAlign: 'center' },
    ]) expect(() => parseContentObject({ ...shape(), ...invalid })).toThrow();
  });

  it('keeps drawing strokes vector-based including pressure and non-destructive eraser semantics', () => {
    const drawing = parseContentObject({
      version: 1, type: 'drawing', rendererHint: 'future-compositor', strokes: [
        { id: 'ink', tool: 'pen', points: [{ x: 0, y: 0, pressure: 0.2 }, { x: 4, y: 5, pressure: 0.8 }], color: '#001122', width: 4, opacity: 1 },
        { id: 'erase', tool: 'eraser', erases: ['ink'], points: [{ x: 2, y: 2, pressure: 0.5 }, { x: 3, y: 3, pressure: 0.6 }], color: '#FFFFFF', width: 12, opacity: 1 },
      ],
    });
    expect(drawing).toMatchObject({ type: 'drawing', rendererHint: 'future-compositor' });
    expect(drawing.type === 'drawing' && drawing.strokes[1]).toMatchObject({ id: 'erase', tool: 'eraser' });
    if (drawing.type !== 'drawing') throw new Error('fixture');
    expect(drawingEraserLayers(drawing)).toMatchObject([{ stroke: { id: 'erase' }, targetStrokeIds: ['ink'] }]);
    expect(updateDrawingStroke(drawing, 'ink', { color: '#334455', width: 8, opacity: 0.5 }).strokes[0]).toMatchObject({ color: '#334455', width: 8, opacity: 0.5 });
    expect(() => appendDrawingStroke({ ...drawing, strokes: drawing.strokes.slice(0, 1) }, { ...drawing.strokes[1]!, erases: ['missing'] })).toThrow('DRAWING_ERASER_TARGET_INVALID');
    expect(() => parseContentObject({ ...(drawing as object), strokes: [{ id: 'x', tool: 'pen', points: [{ x: 0, y: 0, pressure: 2 }, { x: 1, y: 1, pressure: 1 }], color: '#000000', width: 1, opacity: 1 }] })).toThrow();
  });

  it('models recoverable image upload, crop and replacement/download metadata', () => {
    expect(parseContentObject(image())).toMatchObject({ status: 'ready', fileName: 'research.png' });
    expect(parseContentObject(image('failed'))).toMatchObject({ status: 'failed', failureCode: 'UPLOAD_TIMEOUT' });
    expect(parseContentObject({ ...image(), assetId: 'asset-2', replacementOf: 'asset-1', crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 }, opacity: 0.7 })).toMatchObject({ assetId: 'asset-2', replacementOf: 'asset-1', opacity: 0.7 });
    expect(() => parseContentObject({ ...image(), assetId: null, sourceUrl: null })).toThrow('IMAGE_SOURCE_REQUIRED');
    expect(() => parseContentObject({ ...image(), sourceUrl: 'javascript:alert(1)', assetId: null })).toThrow('CONTENT_URL_INVALID');
    expect(() => parseContentObject({ ...image(), sourceUrl: 'http://cdn.example.com/a.png' })).toThrow('CONTENT_URL_INVALID');
    expect(() => parseContentObject({ ...image(), sourceUrl: 'https://user:secret@cdn.example.com/a.png' })).toThrow('CONTENT_URL_INVALID');
    expect(() => parseContentObject({ ...image(), magicMimeType: 'image/jpeg' })).toThrow('IMAGE_METADATA_INVALID');
    expect(() => parseContentObject({ ...image(), byteSize: 0 })).toThrow('IMAGE_METADATA_INVALID');
    expect(() => parseContentObject({ ...image(), fileName: '../secret.png' })).toThrow('IMAGE_FILE_NAME_INVALID');
    expect(() => parseContentObject({ ...image('failed'), retryCount: 101 })).toThrow('CONTENT_OBJECT_INVALID');
    expect(parseContentObject({ ...image('failed'), retryCount: 2 })).toMatchObject({ retryCount: 2 });
    expect(() => parseContentObject({ ...image('failed'), failureCode: null })).toThrow('IMAGE_FAILURE_REQUIRED');
    expect(() => parseContentObject({ ...image(), crop: { x: 0.5, y: 0, width: 0.6, height: 1 } })).toThrow('IMAGE_CROP_INVALID');
    expect(parseContentObject({ ...image('failed'), intrinsicWidth: 0, intrinsicHeight: 0 })).toMatchObject({ intrinsicWidth: 0, intrinsicHeight: 0 });
  });

  it('validates structured tiles, web tiles, tables, icons and templates', () => {
    const models: CanonicalContentObject[] = [
      parseContentObject({ version: 1, type: 'tile', tileType: 'task', title: 'Interview Grace', description: 'Research', icon: 'user', coverAssetId: null, fields: [{ key: 'owner', label: 'Owner', value: 'Grace' }], tags: ['research'], link: 'https://example.com/task', status: 'doing', actions: ['open'] }),
      parseContentObject({ version: 1, type: 'web-tile', url: 'https://example.com/a', title: 'Example', description: 'Preview', imageUrl: null, siteName: 'Example', fetchStatus: 'ready' }),
      parseContentObject({ version: 1, type: 'table', title: 'Ideas', columns: [{ id: 'idea', name: 'Idea' }], rows: [{ id: 'row-1', cells: { idea: 'Prototype' } }] }),
      parseContentObject({ version: 1, type: 'icon', name: 'lightbulb', set: 'lucide', color: '#FFCC00' }),
      parseContentObject({ version: 1, type: 'template', templateId: 'retro', name: 'Retro', versionId: 'v1', parameters: { mood: 'happy' } }),
    ];
    expect(models.map(model => model.type)).toEqual(['tile', 'web-tile', 'table', 'icon', 'template']);
    expect(() => parseContentObject({ ...models[2], rows: [{ id: 'bad', cells: { missing: 'x' } }] })).toThrow('TABLE_CELL_COLUMN_UNKNOWN');
    expect(() => parseContentObject({ ...models[0], fields: [{ key: 'same', label: '', value: '' }, { key: 'same', label: '', value: '' }] })).toThrow('TILE_FIELD_KEY_DUPLICATE');
  });
});

describe('content object command boundary', () => {
  it('rejects binary or ephemeral unknown extensions before content creation reaches the command port', () => {
    for (const extensionData of [{ preview: 'data:image/png;base64,AA==' }, { href: 'blob:https://workspace.test/a' }, { binaryPayload: 'A'.repeat(512) }]) {
      expect(() => createContentObjectEnvelope({ ...identity, gestureId: 'unsafe-create', id: 'unsafe', geometry, content: shape(), extensionData })).toThrow();
    }
  });
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

  it('mirrors structured titles to outer text in the same atomic command', () => {
    const doc = createWhiteboardDocument();
    const tile = parseContentObject({ version: 1, type: 'tile', tileType: 'task', title: 'First', description: '', icon: null, coverAssetId: null, fields: [], tags: [], link: null, status: null, actions: [] });
    new BoardCommandPort(doc).dispatch(createContentObjectEnvelope({ ...identity, gestureId: 'create-tile', id: 'tile-1', geometry, content: tile }));
    expect(readObjects(doc)[0]?.text).toBe('First');
    const after = { ...tile, title: 'Second' };
    const accepted = new ContentObjectCommandPort(doc).dispatch({ ...identity, gestureId: 'rename-tile', command: { type: 'replace-content', id: 'tile-1', content: after } });
    expect(accepted.event).toMatchObject({ beforeText: 'First', afterText: 'Second' });
    expect(readObjects(doc)[0]?.text).toBe('Second');
    expect(() => createContentObjectEnvelope({ ...identity, gestureId: 'bad-title', id: 'bad', geometry, text: 'Drift', content: tile })).toThrow('CONTENT_TEXT_MISMATCH');
    doc.destroy();
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
    expect(() => new ContentObjectCommandPort(doc).dispatch({ ...identity, gestureId: 'bad-kind', command: { type: 'replace-content', id: 'shape-1', content: shape('ellipse') } })).toThrow('CONTENT_KIND_IMMUTABLE');
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

  it('rejects remote structured title drift from the outer collaborative text', () => {
    const tile = parseContentObject({ version: 1, type: 'tile', tileType: 'task', title: 'Canonical', description: '', icon: null, coverAssetId: null, fields: [], tags: [], link: null, status: null, actions: [] });
    const doc = createWhiteboardDocument();
    new BoardCommandPort(doc).dispatch(createContentObjectEnvelope({ ...identity, gestureId: 'tile', id: 'tile-1', geometry, content: tile }));
    const item = doc.getMap<import('yjs').Map<unknown>>('objects').get('tile-1')!;
    item.set('extensionData', { contentObject: { ...tile, title: 'Remote drift' } });
    expect(() => validateDocument(doc)).toThrow('CONTENT_TEXT_MISMATCH');
    doc.destroy();
  });

  it('rejects active and binary payloads on create, replace and remote validation while preserving inert extensions', () => {
    expect(() => createContentObjectEnvelope({ ...identity, gestureId: 'data', id: 'shape-data', geometry, content: { ...shape(), future: { href: 'data:text/html,boom' } } })).toThrow('UNSAFE_EXTENSION_URL');
    expect(() => createContentObjectEnvelope({ ...identity, gestureId: 'binary', id: 'shape-binary', geometry, content: { ...shape(), future: new Uint8Array([1, 2]) } as unknown as ShapeContent })).toThrow('UNSAFE_EXTENSION_BINARY');
    expect(() => createContentObjectEnvelope({ ...identity, gestureId: 'outer-data', id: 'shape-outer', geometry, content: shape(), extensionData: { plugin: { source: 'data:text/plain,bad' } } })).toThrow('UNSAFE_EXTENSION_URL');
    const doc = createWhiteboardDocument();
    new BoardCommandPort(doc).dispatch(createContentObjectEnvelope({ ...identity, gestureId: 'safe', id: 'shape-1', geometry, content: { ...shape(), future: { pluginVersion: 2, value: 'safe' } } }));
    const port = new ContentObjectCommandPort(doc);
    expect(() => port.dispatch({ ...identity, gestureId: 'blob', command: { type: 'replace-content', id: 'shape-1', content: { ...shape(), future: { url: 'blob:https://example.com/id' } } } })).toThrow('UNSAFE_EXTENSION_URL');
    const item = doc.getMap<import('yjs').Map<unknown>>('objects').get('shape-1')!;
    item.set('extensionData', { plugin: { payload: 'data:image/png;base64,AAAA' }, contentObject: shape() });
    expect(() => validateDocument(doc)).toThrow('UNSAFE_EXTENSION_URL');
    doc.destroy();
  });

  it('rejects unsafe extension payloads at the network update preflight boundary', () => {
    const authority = createWhiteboardDocument();
    new BoardCommandPort(authority).dispatch(createContentObjectEnvelope({ ...identity, gestureId: 'network-safe', id: 'shape-1', geometry, content: shape() }));
    const peer = cloneDocument(authority);
    peer.getMap<import('yjs').Map<unknown>>('objects').get('shape-1')!.set('extensionData', { contentObject: { ...shape(), future: { preview: 'blob:https://example.com/unsafe' } } });
    const update = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(authority));
    expect(() => prepareWhiteboardUpdate(authority, update)).toThrow('UNSAFE_EXTENSION_URL');
    peer.destroy(); authority.destroy();
  });

  it('instantiates a template as one stable caller-supplied object collection', () => {
    const template = parseContentObject({
      version: 1, type: 'template', templateId: 'retro', name: 'Retro', versionId: 'v2', parameters: {}, objects: [
        { localId: 'topic', geometry, content: { ...shape('rounded-rectangle'), fill: '#FFF4CC' }, text: 'Topic' },
        { localId: 'task', geometry: { ...geometry, x: 300 }, content: { version: 1, type: 'tile', tileType: 'task', title: 'Action', description: '', icon: null, coverAssetId: null, fields: [], tags: [], link: null, status: null, actions: [] } },
      ],
    });
    if (template.type !== 'template') throw new Error('fixture');
    const input = { ...identity, gestureId: 'instantiate-1', instanceId: 'instance-1', template, objectIds: { topic: 'object-a', task: 'object-b' }, x: 100, y: 200 };
    const envelope = instantiateTemplateEnvelope(input);
    expect(instantiateTemplateEnvelope(structuredClone(input))).toEqual(envelope);
    expect(envelope.commands).toHaveLength(2);
    const doc = createWhiteboardDocument();
    new BoardCommandPort(doc).dispatch(envelope);
    expect(readObjects(doc).map(object => ({ id: object.id, x: object.geometry.x, text: object.text }))).toEqual([
      { id: 'object-a', x: 110, text: 'Topic' }, { id: 'object-b', x: 400, text: 'Action' },
    ]);
    expect(readObjects(doc)[0]?.extensionData?.templateInstance).toMatchObject({ instanceId: 'instance-1', localId: 'topic' });
    doc.destroy();
  });
});
