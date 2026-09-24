import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { whiteboardTransfer as C } from '../src';

const object = { id: 'note-1', schemaVersion: 1 as const, kind: 'sticky' as const,
  geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, text: 'portable', style: {}, parentId: null, orderKey: '' };
const bundle = { format: 'workspacex.board' as const, schemaVersion: 1 as const, exportedAt: new Date().toISOString(),
  source: { application: 'WorkspaceX' as const, boardId: randomUUID(), name: 'Source' }, objects: [object],
  provenance: { objectCount: 1, contentModel: 'whiteboard-object.v1' as const } };

describe('portable whiteboard contract', () => {
  it('accepts the versioned open JSON package and a copy-only import request', () => {
    expect(C.PortableBoardPackage.parse(bundle)).toEqual(bundle);
    expect(C.ImportBoardInput.parse({ requestId: randomUUID(), package: bundle }).package.objects).toHaveLength(1);
  });
  it('rejects unknown versions, provenance mismatches and untrusted fields', () => {
    expect(C.PortableBoardPackage.safeParse({ ...bundle, schemaVersion: 2 }).success).toBe(false);
    expect(C.PortableBoardPackage.safeParse({ ...bundle, provenance: { ...bundle.provenance, objectCount: 2 } }).success).toBe(false);
    expect(C.ImportBoardInput.safeParse({ requestId: randomUUID(), package: bundle, replaceBoardId: randomUUID() }).success).toBe(false);
    const malicious = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
    expect(C.PortableBoardPackage.safeParse({ ...bundle, objects: [{ ...object, extensionData: malicious }] }).success).toBe(false);
  });
});
