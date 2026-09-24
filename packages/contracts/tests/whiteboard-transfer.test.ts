import { describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { whiteboardTransfer as C } from '../src';

const object = { id: 'note-1', schemaVersion: 1 as const, kind: 'sticky' as const,
  geometry: { x: 0, y: 0, width: 100, height: 100, rotation: 0 }, text: 'portable', style: {}, parentId: null, orderKey: '' };
const boardId = randomUUID();
const bundle = C.createPortableBoardPackage({ format: 'workspacex.board', schemaVersion: 1,
  source: { application: 'WorkspaceX', boardId, name: 'Source' }, objects: [object] });

describe('portable whiteboard contract', () => {
  it('accepts the versioned open JSON package and a copy-only import request', () => {
    expect(C.PortableBoardPackage.parse(bundle)).toEqual(bundle);
    expect(C.ImportBoardInput.parse({ requestId: randomUUID(), package: bundle }).package.objects).toHaveLength(1);
  });
  it('emits byte-identical canonical JSON and a stable manifest digest for unchanged content', () => {
    const reversedKeys = { schemaVersion: 1 as const, format: 'workspacex.board' as const, objects: [object],
      source: { name: 'Source', boardId, application: 'WorkspaceX' as const } };
    const second = C.createPortableBoardPackage(reversedKeys);
    expect(C.serializePortableBoardPackage(second)).toBe(C.serializePortableBoardPackage(bundle));
    expect(second.manifest.payloadDigest).toBe(bundle.manifest.payloadDigest);
    expect(C.sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(C.serializePortableBoardPackage(bundle)).not.toContain('exportedAt');
  });
  it('matches the platform SHA-256 implementation across UTF-8 and block boundaries', () => {
    const fixtures = [
      '', 'abc', '中文白板', 'sticky 🟨 connector ↔️',
      'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65),
      `${'数据'.repeat(4096)}${'🚀'.repeat(257)}`,
    ];
    for (const fixture of fixtures) {
      expect(C.sha256Hex(fixture), `fixture bytes=${Buffer.byteLength(fixture)}`).toBe(createHash('sha256').update(fixture).digest('hex'));
    }
  });
  it('canonicalizes insertion order and JSON edge values without changing semantic object order keys', () => {
    const left = { unicode:'白板🟨', negativeZero:-0, nested:{ z:2, a:[{ y:true, x:null }] } };
    const right = { nested:{ a:[{ x:null, y:true }], z:2 }, negativeZero:0, unicode:'白板🟨' };
    const encoded = C.canonicalJson(left);
    expect(encoded).toBe(C.canonicalJson(right));
    expect(C.canonicalJson(JSON.parse(encoded))).toBe(encoded);
    for (const invalid of [undefined, Number.NaN, Number.POSITIVE_INFINITY, { missing: undefined }, [undefined]]) {
      expect(() => C.canonicalJson(invalid)).toThrow();
    }
    const ordered = C.createPortableBoardPackage({ format:'workspacex.board',schemaVersion:1,source:bundle.source,objects:[
      { ...object, id:'z-object', orderKey:'000001' },
      { ...object, id:'a-object', orderKey:'999999' },
    ] });
    expect(ordered.objects.map(item => item.id)).toEqual(['a-object','z-object']);
    expect(Object.fromEntries(ordered.objects.map(item => [item.id,item.orderKey]))).toEqual({ 'a-object':'999999','z-object':'000001' });
  });
  it('rejects unknown versions, digest/count mismatches and untrusted fields', () => {
    expect(C.PortableBoardPackage.safeParse({ ...bundle, schemaVersion: 2 }).success).toBe(false);
    expect(C.PortableBoardPackage.safeParse({ ...bundle, manifest: { ...bundle.manifest, objectCount: 2 } }).success).toBe(false);
    expect(C.PortableBoardPackage.safeParse({ ...bundle, source: { ...bundle.source, name: 'Changed without digest' } }).success).toBe(false);
    expect(C.ImportBoardInput.safeParse({ requestId: randomUUID(), package: bundle, replaceBoardId: randomUUID() }).success).toBe(false);
    const malicious = JSON.parse('{"constructor":{"prototype":{"polluted":true}}}');
    expect(C.PortableBoardPackage.safeParse({ ...bundle, objects: [{ ...object, extensionData: malicious }] }).success).toBe(false);
  });
});
