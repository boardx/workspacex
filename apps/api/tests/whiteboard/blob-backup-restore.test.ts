import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import './recovery-metadata.test';
import './recovery-service.test';

it('restores only hash-verified immutable checkpoint bytes', () => {
  const source = readFileSync(new URL('../../src/application/whiteboard/recovery-service.ts', import.meta.url), 'utf8');
  expect(source).toContain('verifyCheckpoint');
  expect(source).toContain('checkpointHash');
  expect(source).toContain('restoredHead');
});
