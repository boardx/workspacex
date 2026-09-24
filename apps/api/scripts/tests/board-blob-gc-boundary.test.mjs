import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARD_BLOB_GC_BOUNDARIES, checkBoardBlobGcBoundary } from '../lib/board-blob-gc-boundary.mjs';

const sources = new Map([...BOARD_BLOB_GC_BOUNDARIES].map(path => [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')]));
for (const [path, source] of sources) test(`${path} satisfies the metadata-only GC boundary`, () => assert.deepEqual(checkBoardBlobGcBoundary(path, source), []));

const mutations = [
  ['pg-board-blob-reference-guard.ts', 'toOrgId(input.tenantId)', "toOrgId('other-tenant')"],
  ['pg-board-blob-reference-guard.ts', 'FOR UPDATE', 'FOR SHARE'],
  ['pg-board-blob-reference-guard.ts', "root_kind='legal_hold' OR retain_until>now()", 'retain_until>now()'],
  ['pg-board-blob-reference-guard.ts', 'manifest_key,manifest_digest', 'snapshot,manifest_digest'],
  ['pg-board-blob-sweep-coordinator.ts', 'if (!lease.rows[0]?.acquired)', 'if (false)'],
  ['pg-board-blob-sweep-coordinator.ts', '< this.policy.minIntervalMs', '< 0'],
  ['pg-board-blob-sweep-coordinator.ts', 'limit: this.policy.batchSize', 'limit: 100000'],
  ['pg-board-blob-sweep-coordinator.ts', 'result.examined, result.deleted', 'result.snapshot, result.deleted'],
];
for (const [name, before, after] of mutations) {
  const entry = [...sources].find(([path]) => path.endsWith(name));
  test(`rejects ${name} mutation: ${before}`, () => {
    assert.ok(entry); const [path, source] = entry;
    assert.notEqual(source.replace(before, after), source);
    assert.ok(checkBoardBlobGcBoundary(path, source.replace(before, after)).length > 0);
  });
}
