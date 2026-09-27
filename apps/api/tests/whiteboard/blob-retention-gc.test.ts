import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import './object-manifest-store.test';

it('retains immutable objects and exposes indexed metadata references for a separate GC', () => {
  const migration = readFileSync(new URL('../../migrations/20260926160000_whiteboard_object_manifests.sql', import.meta.url), 'utf8');
  const store = readFileSync(new URL('../../src/infrastructure/whiteboard/pg-collaboration-store.ts', import.meta.url), 'utf8');
  expect(migration).toContain('whiteboard_documents_object_ref');
  expect(migration).toContain('whiteboard_updates_object_ref');
  expect(store).not.toMatch(/this\.objects\.delete|objects\.delete/);
});
