import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('stores pointers and hashes in PG without adding board or media blob columns', () => {
  const migration = readFileSync(new URL('../../migrations/20260926160000_whiteboard_object_manifests.sql', import.meta.url), 'utf8');
  expect(migration).toContain('object_key');
  expect(migration).toContain('content_hash');
  expect(migration).not.toMatch(/\b(bytea|fabric_json|snapshot_blob|media_blob)\b/i);
});
