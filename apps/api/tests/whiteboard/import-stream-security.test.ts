import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BaselineWhiteboardImportScanner,
  FailClosedWhiteboardImportScanner,
  collectAndScanWhiteboardImport,
  type WhiteboardImportContentScanner,
} from '../../src/application/whiteboard/import-upload-security';

const descriptor = (bytes: Uint8Array) => ({
  requestId: '20000000-0000-4000-8000-000000000001', source: 'miro' as const,
  fileName: 'board.json', mimeType: 'application/json' as const, sizeBytes: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

describe('streaming whiteboard import security boundary', () => {
  it('applies scanner backpressure before pulling another chunk', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const scanner: WhiteboardImportContentScanner = { async open() { return {
      async write(chunk) { events.push(`scan:${chunk[0]}`); if (chunk[0] === 1) await gate; },
      async finish() { return 'clean'; }, async abort() {},
    }; } };
    const bytes = new Uint8Array([1, 2]);
    async function* source() { events.push('yield:1'); yield bytes.subarray(0, 1); events.push('yield:2'); yield bytes.subarray(1); }
    const pending = collectAndScanWhiteboardImport(source(), descriptor(bytes), scanner);
    await new Promise(resolve => setImmediate(resolve));
    expect(events).toEqual(['yield:1', 'scan:1']);
    release();
    await expect(pending).resolves.toMatchObject({ bytes, sizeBytes: 2 });
    expect(events).toEqual(['yield:1', 'scan:1', 'yield:2', 'scan:2']);
  });

  it('cancels before another chunk is accepted and aborts the scanner', async () => {
    const abort = new AbortController();
    let scannerAborted = false;
    const scanner: WhiteboardImportContentScanner = { async open() { return {
      async write() { await new Promise<never>(()=>undefined); }, async finish() { return 'clean'; }, async abort() { scannerAborted = true; },
    }; } };
    const bytes = new Uint8Array([1, 2]);
    const pending=collectAndScanWhiteboardImport((async function*(){ yield bytes; })(), descriptor(bytes), scanner, abort.signal);
    await new Promise(resolve=>setImmediate(resolve));abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });
    expect(scannerAborted).toBe(true);
  });

  it('cancels a pending final scanner verdict instead of publishing the upload', async () => {
    const abort = new AbortController();
    let scannerAborted = false;
    const scanner: WhiteboardImportContentScanner = { async open() { return {
      async write() {}, async finish() { return await new Promise<never>(()=>undefined); }, async abort() { scannerAborted = true; },
    }; } };
    const bytes = new TextEncoder().encode('{}');
    const pending = collectAndScanWhiteboardImport((async function*(){ yield bytes; })(), descriptor(bytes), scanner, abort.signal);
    await new Promise(resolve=>setImmediate(resolve));abort.abort();
    await expect(pending).rejects.toMatchObject({ code: 'UPLOAD_CANCELLED' });
    expect(scannerAborted).toBe(true);
  });

  it('fails closed without a scanner and rejects malware markers across chunks', async () => {
    const clean = new TextEncoder().encode('{}');
    await expect(collectAndScanWhiteboardImport((async function*(){ yield clean; })(), descriptor(clean), new FailClosedWhiteboardImportScanner()))
      .rejects.toMatchObject({ code: 'SCAN_UNAVAILABLE' });
    const unsafe = new TextEncoder().encode('EICAR-STANDARD-ANTIVIRUS-TEST-FILE');
    await expect(collectAndScanWhiteboardImport((async function*(){ yield unsafe.subarray(0, 7); yield unsafe.subarray(7); })(), descriptor(unsafe), new BaselineWhiteboardImportScanner()))
      .rejects.toMatchObject({ code: 'CONTENT_REJECTED' });
  });
});
