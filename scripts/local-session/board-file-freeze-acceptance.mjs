#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
// Local PGlite only: owner role initializes a fresh fixture; app_rw performs every ACL assertion.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const port = Number(arg('pg-port')); assert(Number.isInteger(port) && port > 0 && port < 65536, 'Pass explicit --pg-port for the owned local PGlite stack.');
const out = resolve(arg('out', '/private/tmp/wsx-board-file-freeze-evidence'));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { Client } = createRequire(join(root, 'apps/api/package.json'))('pg');
const connection = { host: '127.0.0.1', port, user: 'app_rw', password: 'local', database: 'workspacex', connectionTimeoutMillis: 5000, query_timeout: 15000 };
const client = new Client(connection);
const orgId = `file-freeze-acceptance-${randomUUID()}`, boardId = randomUUID();
const digest = createHash('sha256').update('freeze database fixture').digest('hex');
const assetId = `board-file-${digest}`, objectKey = `whiteboards/tenants/${createHash('sha256').update(orgId).digest('hex').slice(0, 32)}/boards/${boardId}/files/${digest}`;
const metadata = { assetId, fileName: 'freeze.txt', mimeType: 'text/plain', byteSize: 23, contentDigest: `sha256:${digest}`, persistence: 'durable' };
const results = []; let connected = false, transaction = false, rollbackAcknowledged = false, rolledBack = false, phase = 'connecting';
// An unsolicited driver error must be recorded, not terminate Node before rollback.
client.on('error', error => { results.push({ name: 'database protocol error', ok: false, phase, code: error.code ?? null, detail: String(error.message) }); });
async function appRole(connectionClient = client) {
  const role = (await connectionClient.query('SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  assert(role, 'Driver must return a current_user row before accepting the role assertion.');
  assert.equal(role.current_user, 'app_rw'); assert.equal(role.rolsuper, false); assert.equal(role.rolbypassrls, false); return role;
}
async function expectDenied(name, statement, setting) {
  phase = name;
  await appRole();
  // PGlite's socket adapter loses synchronization when a rejected extended query
  // reaches the wire. Catch only insufficient_privilege inside an invoker-role DO.
  const result = await client.query(`DO $file_freeze$
    DECLARE denied boolean := false;
    BEGIN
      IF current_user <> 'app_rw' OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'ACL assertion requires unprivileged app_rw';
      END IF;
      BEGIN
        ${statement};
      EXCEPTION WHEN insufficient_privilege THEN denied := true;
      END;
      IF NOT denied THEN RAISE EXCEPTION 'Frozen write was unexpectedly allowed'; END IF;
      PERFORM set_config(${client.escapeLiteral(setting)}, '42501', true);
    END $file_freeze$`);
  assert.equal(result.command, 'DO');
  const state = await client.query('SELECT current_user,current_setting($1) AS sqlstate', [setting]);
  assert.equal(state.rows[0]?.current_user, 'app_rw'); assert.equal(state.rows[0]?.sqlstate, '42501');
  results.push({ name, ok: true, sqlstate: state.rows[0].sqlstate, role: 'app_rw', caughtInsideDatabase: true });
}
mkdirSync(out, { recursive: true });
try {
  await client.connect(); connected = true; phase = 'initial role assertion'; await appRole();
  phase = 'fixture transaction';
  await client.query('BEGIN'); transaction = true;
  await client.query('SET LOCAL ROLE postgres');
  await client.query("INSERT INTO organizations(id,name,kind) VALUES($1,'Temporary file freeze acceptance','organization')", [orgId]);
  await client.query("INSERT INTO whiteboards(id,org_id,owner_id,request_id,name) VALUES($1,$2,'temporary-freeze-owner',$3,'Temporary file freeze acceptance')", [boardId, orgId, randomUUID()]);
  await client.query("INSERT INTO whiteboard_asset_refs(org_id,board_id,object_key,content_hash,byte_size,state,activated_at) VALUES($1,$2,$3,$4,$5,'active',now())", [orgId, boardId, objectKey, digest, metadata.byteSize]);
  await client.query('SET LOCAL ROLE app_rw');
  await client.query("SELECT set_config('app.current_org',$1,true)", [orgId]);
  await appRole();
  phase = 'active file insertion';
  await client.query('INSERT INTO whiteboard_file_assets(org_id,board_id,asset_id,object_key,metadata) VALUES($1,$2,$3,$4,$5::jsonb)', [orgId, boardId, assetId, objectKey, JSON.stringify(metadata)]);
  results.push({ name: 'active organization permits app_rw file metadata insertion', ok: true, role: 'app_rw' });
  phase = 'policy catalog';
  const policies = (await client.query("SELECT policyname,permissive,cmd FROM pg_policies WHERE tablename='whiteboard_file_assets' ORDER BY policyname")).rows;
  for (const command of ['INSERT', 'UPDATE', 'DELETE']) assert(policies.some(policy => policy.cmd === command && policy.permissive === 'RESTRICTIVE'), `Missing restrictive ${command} policy`);
  results.push({ name: 'file table has all three restrictive write policies', ok: true, policies });
  phase = 'disable temporary organization'; await client.query('SET LOCAL ROLE postgres');
  const frozen = await client.query("UPDATE organizations SET status='disabled',disabled_at=now(),retention_until=now()+interval '180 days' WHERE id=$1", [orgId]); assert.equal(frozen.rowCount, 1);
  await client.query('SET LOCAL ROLE app_rw'); await appRole();
  phase = 'disabled read';
  const read = await client.query('SELECT asset_id,metadata FROM whiteboard_file_assets WHERE org_id=$1 AND board_id=$2 AND asset_id=$3', [orgId, boardId, assetId]);
  assert.equal(read.rowCount, 1); assert.deepEqual(read.rows[0].metadata, metadata);
  results.push({ name: 'disabled organization remains readable as app_rw', ok: true, rowCount: read.rowCount, role: 'app_rw' });
  const literal = value => client.escapeLiteral(String(value));
  await expectDenied('disabled organization denies INSERT', `INSERT INTO whiteboard_file_assets(org_id,board_id,asset_id,object_key,metadata) VALUES(${literal(orgId)},${literal(boardId)},${literal(`board-file-${'b'.repeat(64)}`)},${literal(objectKey)},${literal(JSON.stringify(metadata))}::jsonb)`, 'wsx.file_freeze_insert');
  await expectDenied('disabled organization denies UPDATE', `UPDATE whiteboard_file_assets SET metadata=jsonb_set(metadata,'{fileName}','"changed.txt"'::jsonb) WHERE org_id=${literal(orgId)} AND board_id=${literal(boardId)} AND asset_id=${literal(assetId)}`, 'wsx.file_freeze_update');
  await appRole();
  const deleted = await client.query('DELETE FROM whiteboard_file_assets WHERE org_id=$1 AND board_id=$2 AND asset_id=$3', [orgId, boardId, assetId]);
  assert.equal(deleted.rowCount, 0, 'Restrictive DELETE USING must hide writable candidates.');
  const unchanged = await client.query('SELECT metadata FROM whiteboard_file_assets WHERE org_id=$1 AND board_id=$2 AND asset_id=$3', [orgId, boardId, assetId]);
  assert.equal(unchanged.rowCount, 1); assert.deepEqual(unchanged.rows[0].metadata, metadata);
  results.push({ name: 'disabled organization denies DELETE without hiding readable data', ok: true, rowCount: deleted.rowCount, role: 'app_rw' });
} catch (error) { results.push({ name: 'freeze acceptance', ok: false, code: error.code ?? null, detail: String(error.message) }); }
finally {
  if (transaction) {
    phase = 'fixture rollback';
    try { const response = await client.query('ROLLBACK'); assert.equal(response.command, 'ROLLBACK'); await appRole(); rollbackAcknowledged = true; }
    catch (error) { results.push({ name: 'fixture rollback', ok: false, code: error.code ?? null }); }
  }
  if (connected) await client.end().catch(error => { results.push({ name: 'original connection close', ok: false, detail: String(error.message) }); });
  if (transaction) {
    const verifier = new Client(connection);
    verifier.on('error', error => { results.push({ name: 'rollback verifier protocol error', ok: false, detail: String(error.message) }); });
    try {
      await verifier.connect(); await appRole(verifier); await verifier.query('BEGIN READ ONLY');
      // Owner is used only to prove physical fixture absence, never to test ACL behavior.
      await verifier.query('SET LOCAL ROLE postgres');
      const remaining = await verifier.query('SELECT (SELECT count(*)::int FROM organizations WHERE id=$1) AS organizations,(SELECT count(*)::int FROM whiteboards WHERE org_id=$1 AND id=$2) AS boards', [orgId, boardId]);
      assert.equal(remaining.rows[0]?.organizations, 0); assert.equal(remaining.rows[0]?.boards, 0);
      const rollback = await verifier.query('ROLLBACK'); assert.equal(rollback.command, 'ROLLBACK'); await appRole(verifier);
      rolledBack = rollbackAcknowledged;
      results.push({ name: 'fresh connection confirms fixture absence and restored app_rw role', ok: rollbackAcknowledged, remaining: remaining.rows[0], rollbackAcknowledged });
    } catch (error) { results.push({ name: 'fresh connection rollback verification', ok: false, detail: String(error.message) }); await verifier.query('ROLLBACK').catch(() => {}); }
    finally { await verifier.end().catch(() => {}); }
  }
  const ok = rolledBack && results.length === 7 && results.every(result => result.ok);
  const report = { ok, pgPort: port, fixtureOrg: orgId, fixtureBoard: boardId, rollbackAcknowledged, transactionRolledBack: rolledBack, databaseOnlyFixture: true, results };
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'report.md'), `# Board File Freeze Acceptance\n\nResult: ${ok ? 'PASS' : 'FAIL'}\n\n${results.map(result => `- ${result.ok ? 'PASS' : 'FAIL'} ${result.name}`).join('\n')}\n\nOnly a newly created temporary organization was disabled. All ACL assertions require app_rw. Rollback acknowledged and independently verified: ${rolledBack ? 'yes' : 'no'}. No object-store bytes were created.\n`);
  console.log(JSON.stringify({ ok, checks: results.length, rolledBack, evidence: out })); process.exitCode = ok ? 0 : 1;
}
