import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import './collaboration-transaction.test';

it('publishes both immutable refs through the command transaction', () => {
  const source = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-collaboration-store.ts', import.meta.url), 'utf8');
  const commit = source.slice(source.indexOf('private async commitInTransaction'));
  const blobsVerified = commit.indexOf('this.writeStored(');
  const updateManifest = commit.indexOf('INSERT INTO whiteboard_updates');
  const headManifest = commit.indexOf('UPDATE whiteboard_documents SET seq');

  expect(source).toContain('writeCommandsInTransaction(session');
  expect(source).toContain('this.objects.putOnce');
  expect(blobsVerified).toBeGreaterThanOrEqual(0);
  expect(updateManifest).toBeGreaterThan(blobsVerified);
  expect(headManifest).toBeGreaterThan(updateManifest);
  expect(commit.slice(updateManifest, headManifest)).not.toContain('Buffer.from(accepted');
});
