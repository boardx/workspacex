import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import './import-repository-guard.test';

it('fails closed on digest mismatch, traversal and unsafe archives', () => {
  const parser = readFileSync(new URL('../../src/application/whiteboard/import-parser.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../../src/application/whiteboard/import-service.ts', import.meta.url), 'utf8');
  expect(parser).toContain('UnsafeWhiteboardImport');
  expect(parser).toContain("part !== '..'");
  expect(service).toContain("WhiteboardImportError('INTEGRITY_FAILED')");
  expect(service).toContain("WhiteboardImportError('INVALID_UPLOAD')");
});
