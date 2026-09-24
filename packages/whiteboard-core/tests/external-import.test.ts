import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertExternalBoardSnapshot } from '../src/external-import';

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const packageBoardId = '00000000-0000-4000-8000-000000000042';

describe('Miro and Mural external board import', () => {
  it('maps Miro center coordinates, sanitizes HTML and restores parents/connectors in a second phase', () => {
    const result = convertExternalBoardSnapshot(read('miro-board-v1.json'), { packageBoardId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const objects = result.package.objects;
    const frame = objects.find(o => o.extensionData?.externalImport && (o.extensionData.externalImport as Record<string, unknown>).sourceObjectId === 'frame-1')!;
    const sticky = objects.find(o => o.kind === 'sticky')!;
    const connector = objects.find(o => o.kind === 'connector')!;
    expect(frame.geometry).toMatchObject({ x: 200, y: 200, width: 600, height: 400 });
    expect(sticky.geometry).toMatchObject({ x: 300, y: 300, width: 200, height: 100 });
    expect(sticky.text).toBe('Hello team');
    expect(sticky.text).not.toMatch(/[<>]|alert/);
    expect(objects.find(o => o.kind === 'text')?.text).toBe('safe');
    expect(sticky.parentId).toBe(frame.id);
    expect(connector.connector).toEqual({ from: sticky.id, to: objects.find(o => o.kind === 'ellipse')!.id });
    expect(result.preview.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FORMATTING_REMOVED', sourceObjectId: 'sticky-1' }),
      expect.objectContaining({ code: 'DANGLING_CONNECTOR', sourceObjectId: 'bad-connector' }),
      expect.objectContaining({ code: 'UNKNOWN_OBJECT', sourceObjectId: 'mindmap-1' }),
    ]));
    expect(result.preview.quality).toMatchObject({
      complete: { count: 3 }, approximate: { count: 2, sampleSourceIds: ['sticky-1','text-1'] },
      degraded: { count: 0 }, skipped: { count: 2, sampleSourceIds: ['bad-connector','mindmap-1'] },
    });
  });

  it('preserves Mural top-left coordinates and resolves explicitly parent-relative widgets', () => {
    const result = convertExternalBoardSnapshot(read('mural-board-v1.json'), { packageBoardId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const area = result.package.objects.find(o => o.kind === 'frame')!;
    const sticky = result.package.objects.find(o => o.kind === 'sticky')!;
    const text = result.package.objects.find(o => o.kind === 'text')!;
    expect(area.geometry).toMatchObject({ x: 100, y: 200 });
    expect(sticky.geometry).toMatchObject({ x: 120, y: 230 });
    expect(sticky.parentId).toBe(area.id);
    expect(text.geometry).toMatchObject({ x: 420, y: 330 });
    expect(result.preview.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DRAWINGS_NOT_INCLUDED' }),
      expect.objectContaining({ code: 'DRAWING_UNSUPPORTED', sourceObjectId: 'drawing-1' }),
      expect.objectContaining({ code: 'UNKNOWN_OBJECT', sourceObjectId: 'embed-1' }),
    ]));
    expect(sticky.extensionData?.vendorData).toEqual({ topLevel: { createdOn: 1760000000000 }, style: { bold: true } });
    expect(result.preview.quality).toMatchObject({ complete:{count:4}, approximate:{count:1,sampleSourceIds:['sticky-1']}, degraded:{count:0}, skipped:{count:2} });
  });

  it('reports dangling parents without silently discarding otherwise importable content', () => {
    const snapshot = read('mural-board-v1.json') as { pages: Array<{ widgets: Array<{ parentId?: string }> }> };
    snapshot.pages[0]!.widgets[1]!.parentId = 'absent';
    const result = convertExternalBoardSnapshot(snapshot, { packageBoardId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.objects.find(o => o.kind === 'sticky')?.parentId).toBeNull();
    expect(result.preview.losses).toContainEqual(expect.objectContaining({ code: 'DANGLING_PARENT', sourceObjectId: 'sticky-1' }));
  });

  it('rejects over-limit, duplicate-identity and malformed snapshots as a whole', () => {
    expect(convertExternalBoardSnapshot({ huge: 'x'.repeat(16 * 1024 * 1024) }, { packageBoardId })).toMatchObject({ ok:false, code:'PAYLOAD_TOO_LARGE' });
    const duplicate = read('miro-board-v1.json') as { pages: Array<{ items: Array<{ id: string }> }> };
    duplicate.pages[0]!.items[1]!.id = 'frame-1';
    expect(convertExternalBoardSnapshot(duplicate, { packageBoardId })).toMatchObject({ ok:false, code:'INVALID_SNAPSHOT' });
    expect(convertExternalBoardSnapshot({ format:'miro.rest.board-snapshot' }, { packageBoardId })).toMatchObject({ ok:false, code:'UNSUPPORTED_FORMAT' });
    const forged = read('miro-board-v1.json') as { pages: Array<{ items: Array<Record<string, unknown>> }> };
    forged.pages[0]!.items[0]!.createdBy = () => 'not JSON';
    expect(convertExternalBoardSnapshot(forged, { packageBoardId })).toMatchObject({ ok:false, code:'INVALID_SNAPSHOT' });
  });

  it('reports text truncation and non-canvas Miro coordinates instead of silently losing fidelity', () => {
    const snapshot = read('miro-board-v1.json') as {
      pages: Array<{ items: Array<{ data?: { content?: string }; position?: Record<string, unknown> }> }>;
    };
    const sticky = snapshot.pages[0]!.items[1]!;
    sticky.data = { content: 'x'.repeat(20_001) };
    sticky.position = { ...sticky.position, relativeTo: 'parent_top_left' };
    const result = convertExternalBoardSnapshot(snapshot, { packageBoardId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.package.objects.find(object => object.kind === 'sticky')?.text).toHaveLength(20_000);
    expect(result.preview.losses).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEXT_TRUNCATED', sourceObjectId: 'sticky-1' }),
      expect.objectContaining({ code: 'POSITION_APPROXIMATED', sourceObjectId: 'sticky-1' }),
    ]));
    expect(result.preview.quality.degraded).toMatchObject({ count: 1, sampleSourceIds: ['sticky-1'] });
  });

  it('preserves unknown vendor style/data fields or reports bounded provenance omission with source ids', () => {
    const preserved = read('miro-board-v1.json') as { pages: Array<{ items: Array<Record<string, unknown>> }> };
    const sticky = preserved.pages[0]!.items[1]!;
    sticky.data = { ...(sticky.data as object), vendorFlag: 'alpha' };
    sticky.style = { ...(sticky.style as object), fontFamily: 'Inter', backgroundColor: '#ffeeaa' };
    sticky.vendorRevision = 42;
    const converted = convertExternalBoardSnapshot(preserved, { packageBoardId });
    expect(converted.ok).toBe(true);
    if (!converted.ok) return;
    const imported = converted.package.objects.find(object => object.kind === 'sticky')!;
    expect(imported.extensionData?.vendorData).toEqual({
      topLevel: { vendorRevision: 42 }, style: { fontFamily: 'Inter', backgroundColor: '#ffeeaa' }, data: { vendorFlag: 'alpha' },
    });
    expect(converted.preview.losses).not.toContainEqual(expect.objectContaining({ code: 'VENDOR_DATA_OMITTED', sourceObjectId: 'sticky-1' }));

    sticky.vendorPayload = 'x'.repeat(20_000);
    const bounded = convertExternalBoardSnapshot(preserved, { packageBoardId });
    expect(bounded.ok).toBe(true);
    if (!bounded.ok) return;
    expect(bounded.preview.losses).toContainEqual(expect.objectContaining({ code: 'VENDOR_DATA_OMITTED', sourceObjectId: 'sticky-1' }));
    expect(bounded.preview.quality.degraded).toMatchObject({ count: 1, sampleSourceIds: ['sticky-1'] });
  });
});
