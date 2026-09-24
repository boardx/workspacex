import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BOARD_BLOB_GC_BOUNDARIES, checkBoardBlobGcBoundary } from '../lib/board-blob-gc-boundary.mjs';

const sources = new Map([...BOARD_BLOB_GC_BOUNDARIES].map(path => [path, readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')]));
const referencePath = [...sources.keys()].find(path => path.endsWith('pg-board-blob-reference-guard.ts'));
const coordinatorPath = [...sources.keys()].find(path => path.endsWith('pg-board-blob-sweep-coordinator.ts'));

for (const [path, source] of sources) {
  test(`${path} satisfies the complete GC method boundary`, () => assert.deepEqual(checkBoardBlobGcBoundary(path, source), []));
}

function replace(source, before, after) {
  const changed = source.replace(before, after);
  assert.notEqual(changed, source, `mutation precondition missing: ${before}`);
  return changed;
}

const mutations = [
  ['rewriting the tenant before withTenant', referencePath, source => replace(source,
    'return this.db.withTenant(toOrgId(input.tenantId)', "input.tenantId = 'other-tenant';\n    return this.db.withTenant(toOrgId(input.tenantId)")],
  ['moving inspect outside withTenant and releasing the Board lock early', referencePath, source => {
    let changed = replace(source, 'return this.db.withTenant(toOrgId(input.tenantId)', 'const retained = await this.db.withTenant(toOrgId(input.tenantId)');
    changed = replace(changed, 'return inspect(roots.rows.map(row => ({', 'return roots.rows.map(row => ({');
    changed = replace(changed, '      })));\n    });', '      }));\n    });\n    return inspect(retained);');
    return changed;
  }],
  ['filtering authoritative backup or legal-hold roots after the locked read', referencePath, source =>
    replace(source, 'roots.rows.map(row => ({', 'roots.rows.slice(0, 1).map(row => ({')],
  ['weakening the shared Board writer lock', referencePath, source => replace(source, 'FOR UPDATE', 'FOR SHARE')],
  ['dropping legal-hold root coverage', referencePath, source => replace(source, "root_kind='legal_hold' OR retain_until>now()", 'retain_until>now()')],
  ['adding Board content to an otherwise allowlisted query', referencePath, source =>
    replace(source, 'SELECT manifest_key,manifest_digest', 'SELECT snapshot,manifest_digest')],
  ['using a computed query call with concatenated SQL', referencePath, source => {
    let changed = replace(source, 'session.query<{ id: string }>(', "session['query']<{ id: string }>(");
    changed = replace(changed, '`SELECT id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE`',
      "`SELECT snapshot FROM whiteboards ` + `WHERE org_id=$1 AND id=$2 FOR UPDATE`");
    return changed;
  }],
  ['rewriting the coordinator tenant before withTenant', coordinatorPath, source => replace(source,
    'return this.db.withTenant(toOrgId(input.tenantId)', "input.tenantId = 'other-tenant';\n    return this.db.withTenant(toOrgId(input.tenantId)")],
  ['keeping the lease condition but removing its return', coordinatorPath, source =>
    replace(source, "return { status: 'skipped-lease' };", "({ status: 'skipped-lease' });")],
  ['keeping the cadence condition but removing its return', coordinatorPath, source =>
    replace(source, "return { status: 'skipped-frequency' };", "({ status: 'skipped-frequency' });")],
  ['retaining the cursor expression but passing undefined', coordinatorPath, source =>
    replace(source, 'const cursor = input.cursor ?? prior.rows[0]?.next_cursor ?? undefined;',
      'void (input.cursor ?? prior.rows[0]?.next_cursor ?? undefined); const cursor = undefined;')],
  ['increasing the batch policy immediately before sweep', coordinatorPath, source =>
    replace(source, 'const result = await this.sweep.run', 'this.policy.batchSize = 100000;\n      const result = await this.sweep.run')],
  ['spreading caller data into the bounded sweep request', coordinatorPath, source =>
    replace(source, 'this.sweep.run({ tenantId:', 'this.sweep.run({ ...input, tenantId:')],
  ['overwriting deleted metrics before persistence', coordinatorPath, source =>
    replace(source, 'await session.query(', 'result.deleted = 0;\n      await session.query(')],
  ['adding content to persisted metrics', coordinatorPath, source =>
    replace(source, 'result.examined, result.deleted', 'result.snapshot, result.deleted')],
];

for (const [name, path, mutate] of mutations) {
  test(`rejects mutation: ${name}`, () => {
    assert.ok(path);
    const mutated = mutate(sources.get(path));
    assert.notDeepEqual(checkBoardBlobGcBoundary(path, mutated), []);
  });
}
