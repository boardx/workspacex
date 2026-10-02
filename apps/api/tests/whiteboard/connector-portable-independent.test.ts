import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { expect, it } from 'vitest';
import { createWhiteboardDocument, executeCommands, readObjects, SpatialRelationshipCommandPort } from '@repo/whiteboard-core';
import type { WhiteboardObject } from '@repo/contracts/whiteboard-document';
import { PortableBoardService, portableHash } from '../../src/application/whiteboard/portable-board';
import type { WhiteboardRepository } from '../../src/application/whiteboard/ports';
import type { WhiteboardCollaborationStore, WhiteboardUpdateValidator } from '../../src/application/whiteboard/collaboration-ports';
import type { WhiteboardImageAssets, BoardImageVerifier } from '../../src/application/whiteboard/image-assets';
import { toOrgId } from '../../src/domain/org-id';

it.each(['straight', 'elbow', 'curve'] as const)('round-trips actual portable %s export/import with bound and free canonical fields', async type => {
  const source = createWhiteboardDocument(), target = createWhiteboardDocument();
  const p = { orgId: toOrgId('portable-connector-test'), userId: 'owner' };
  const sourceId: string = randomUUID(), targetId: string = randomUUID(), requestId = randomUUID();
  try {
    const port = new SpatialRelationshipCommandPort(source);
    executeCommands(source, ['a', 'b'].map((id, index) => ({ type: 'create' as const, object: { id, schemaVersion: 1 as const, kind: 'sticky' as const, geometry: { x: index * 200, y: 0, width: 100, height: 100, rotation: index * 90 }, text: id, style: {}, parentId: null, orderKey: id } })), 'fixture');
    const route = type === 'elbow' ? { kind: 'elbow' as const, waypoints: [{ x: 140, y: -50 }, { x: 160, y: 150 }] } : type === 'curve' ? { kind: 'curve' as const, startOffset: { x: 40, y: -70 }, endOffset: { x: -80, y: 25 } } : undefined;
    for (const bound of [true, false]) port.dispatch({ boardId: sourceId, clientId: 'fixture', gestureId: `create-${bound}`, command: { type: 'create-connector', id: bound ? 'bound' : 'free', relationship: { ...(bound ? { from: 'a', to: 'b' } : { fromPoint: { x: -30, y: 40 }, toPoint: { x: 330, y: -80 } }), fromAnchor: 'right', toAnchor: 'left', type, route, strokeWidth: 24, label: '中文 English', semanticRelation: '', labelPosition: { t: .73, normalOffset: -29 }, startStyle: 'circle', endStyle: 'diamond', lineStyle: 'dotted' } } });
    const before = readObjects(source);
    const service = new PortableBoardService(
      { get: async (_principal: unknown, id: string) => [sourceId, targetId].includes(id) ? { role: 'owner', archived: false } : null } as unknown as WhiteboardRepository,
      { load: async () => ({ epoch: 1, seq: 2, update: Y.encodeStateAsUpdate(source) }) } as unknown as WhiteboardCollaborationStore,
      { objects: async () => readObjects(source) } as unknown as WhiteboardUpdateValidator,
      { read: async () => { throw new Error('unexpected image read'); } } as unknown as WhiteboardImageAssets,
      { verify: async () => { throw new Error('unexpected image verification'); } } as unknown as BoardImageVerifier,
      { publish: async (_principal, _boardId, input) => { executeCommands(target, input.commands, 'portable'); return { epoch: 1, seq: 1, objectCount: input.commands.length, assetCount: 0, replayed: false }; } },
    );
    const exported = await service.export(p, sourceId);
    const bytes = Buffer.from(exported.contentBase64, 'base64');
    expect(portableHash(bytes)).toBe(exported.sha256); expect(bytes.length).toBe(exported.sizeBytes);
    const bundle = JSON.parse(bytes.toString('utf8'));
    expect(bundle.format).toBe('workspacex.board.bundle.v1');
    expect(bundle.objects.content).toEqual(before); expect(bundle.media).toEqual([]);
    await service.import(p, targetId, { requestId, expectedEpoch: 1, file: { contentBase64: exported.contentBase64, sha256: exported.sha256, sizeBytes: exported.sizeBytes } });
    const mapped = (id: string) => `portable_${portableHash(`${requestId}:${id}`).slice(0, 32)}`;
    const expected: WhiteboardObject[] = before.map(object => ({ ...object, id: mapped(object.id), ...(object.connector ? { connector: { ...object.connector, from: object.connector.from ? mapped(object.connector.from) : undefined, to: object.connector.to ? mapped(object.connector.to) : undefined } } : {}) }));
    // Remapped IDs legitimately change read order when orderKey and zIndex tie.
    const byId = (objects: WhiteboardObject[]) => [...objects].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(readObjects(target))).toEqual(byId(expected));
    const reloaded = createWhiteboardDocument();
    try { Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(target)); expect(byId(readObjects(reloaded))).toEqual(byId(expected)); } finally { reloaded.destroy(); }
  } finally { source.destroy(); target.destroy(); }
});
