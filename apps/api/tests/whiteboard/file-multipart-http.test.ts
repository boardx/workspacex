import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import { WHITEBOARD_FILE_ASSETS, WhiteboardFileAssets, type BoardFileRecord } from '../../src/application/whiteboard/file-assets';
import { WhiteboardFilesController } from '../../src/interface/controllers/whiteboard-files.controller';
import type { Principal } from '../../src/domain/principal';
import type { WhiteboardRepository } from '../../src/application/whiteboard/ports';
import { WHITEBOARD_FILE_LIMITS } from '@repo/contracts/whiteboard-file';

const boardId = '20000000-0000-4000-8000-000000000001';
const principal = { orgId: 'org', userId: 'owner' } as Principal;
const records = new Map<string, BoardFileRecord>();
const blobs = new Map<string, { bytes: Uint8Array; mime: string }>();
const service = new WhiteboardFileAssets(
  { get: async () => ({ role: 'owner', archived: false }) } as unknown as WhiteboardRepository,
  { save: async (_p, _id, record) => { if (!records.has(record.metadata.assetId)) records.set(record.metadata.assetId, record); }, get: async (_p, _id, id) => records.get(id) ?? null },
  { putOnce: async (key, bytes, mime) => { blobs.set(key, { bytes, mime }); }, get: async key => blobs.get(key)?.bytes ?? null,
    head: async key => { const value = blobs.get(key); return value ? { sizeBytes: value.bytes.length, mime: value.mime } : null; } },
);
@Module({ controllers: [WhiteboardFilesController], providers: [{ provide: WHITEBOARD_FILE_ASSETS, useValue: service }] })
class FixtureModule {}
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let base: string;
let sample = 0;
beforeAll(async () => {
  app = await NestFactory.create(FixtureModule, { logger: false });
  app.use((req: Request & { principal?: Principal }, _res: Response, next: NextFunction) => { req.principal = principal; next(); });
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
afterAll(async () => { await app?.close(); });
async function upload(name: string, fields: [string, string][], first = false) {
  const body = new FormData();
  const bytes = `distinct-file-${++sample}`;
  if (first) for (const [key, value] of fields) body.append(key, value);
  body.append('file', new Blob([bytes], { type: 'text/plain' }), name);
  if (!first) for (const [key, value] of fields) body.append(key, value);
  return { response: await fetch(`${base}/whiteboards/${boardId}/files`, { method: 'POST', body }), bytes };
}
describe('real Nest/Multer multipart filename contract', () => {
  it.each([0, WHITEBOARD_FILE_LIMITS.bytes + 1])('rejects actual multipart bytes=%s before any asset write', async size => {
    const before = { records: records.size, blobs: blobs.size }, body = new FormData();
    body.append('file', new Blob([new Uint8Array(size)]), 'size.txt');
    const response = await fetch(`${base}/whiteboards/${boardId}/files`, { method: 'POST', body });
    expect(response.status).toBe(size === 0 ? 400 : 413);
    expect({ records: records.size, blobs: blobs.size }).toEqual(before);
  });
  it.each(['"quoted".txt', '%22literal%22.txt', '普通便利贴.txt', 'café.txt', 'cafe\u0301.txt', 'emoji😀.txt', 'a'.repeat(255), '汉'.repeat(255)])('preserves the exact explicit field %s and returns verified inert attachment bytes', async name => {
    const { response, bytes } = await upload(name, [['fileName', name]]);
    expect(response.status).toBe(201);
    const metadata = await response.json(); expect(metadata.fileName).toBe(name);
    const download = await fetch(`${base}/whiteboards/${boardId}/files/${metadata.assetId}/content`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/octet-stream');
    expect(download.headers.get('cache-control')).toBe('private, no-store');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(download.headers.get('content-length')).toBe(String(Buffer.byteLength(bytes)));
    expect(decodeURIComponent(download.headers.get('content-disposition')!.split("UTF-8''")[1]!)).toBe(name);
    expect(await download.text()).toBe(bytes);
  });
  it('accepts a filename field before the file part', async () => {
    const { response } = await upload('transport.txt', [['fileName', '"original".txt']], true);
    expect(response.status).toBe(201); expect((await response.json()).fileName).toBe('"original".txt');
  });
  it.each(['old.txt', '普通.txt', 'café.txt', 'emoji😀.txt'])('keeps omission compatible for old browser upload %s', async name => {
    const { response } = await upload(name, []);
    expect(response.status).toBe(201); expect((await response.json()).fileName).toBe(name);
  });
  it('preserves a genuine Latin1 old-client filename without forced UTF-8 replacement', async () => {
    const boundary = 'fixture-latin1-boundary';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="`, 'ascii'),
      Buffer.from('café.txt', 'latin1'),
      Buffer.from(`"\r\nContent-Type: text/plain\r\n\r\nlegacy-latin1-${++sample}\r\n--${boundary}--\r\n`, 'ascii'),
    ]);
    const response = await fetch(`${base}/whiteboards/${boardId}/files`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
    expect(response.status).toBe(201); expect((await response.json()).fileName).toBe('café.txt');
  });
  it.each(['missing-file', 'two-files', 'fileName-as-file'])('rejects malformed file parts %s without writing assets', async mode => {
    const before = { records: records.size, blobs: blobs.size }, body = new FormData();
    if (mode !== 'missing-file') body.append('file', new Blob(['bytes']), 'a.txt');
    if (mode === 'two-files') body.append('file', new Blob(['more']), 'b.txt');
    if (mode === 'fileName-as-file') body.append('fileName', new Blob(['name']), 'c.txt');
    if (mode === 'missing-file') body.append('fileName', 'a.txt');
    const response = await fetch(`${base}/whiteboards/${boardId}/files`, { method: 'POST', body });
    expect(response.status).toBe(400); expect({ records: records.size, blobs: blobs.size }).toEqual(before);
  });
  it.each([
    [['fileName', '']], [['fileName', 'a'.repeat(256)]], [['fileName', '../bad.txt']],
    [['fileName', 'bad\r\n.txt']], [['fileName', 'bad\u0000.txt']],
    [['unknown', 'a.txt']], [['fileName', 'a.txt'], ['fileName', 'b.txt']],
    [['fileName[]', 'a.txt']], [['fileName[key]', 'a.txt']], [['fileName', '汉'.repeat(400)]],
  ].map(fields => ({ fields: fields as [string, string][] })))('rejects invalid fields $fields before any asset is written', async ({ fields }) => {
    const before = { records: records.size, blobs: blobs.size };
    const { response } = await upload('safe.txt', fields);
    expect([400, 413]).toContain(response.status);
    expect({ records: records.size, blobs: blobs.size }).toEqual(before);
  });
});
