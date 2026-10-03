import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync, symlinkSync, chmodSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {attestFileStorage, verifyFileStorage, blockOwnedFileWrite} from './file-storage-runtime.mjs';

async function fixture(action) {
  const dataDir = mkdtempSync('/private/tmp/wsx-file-storage-pure-'), objectRoot = join(dataDir, 'objects'); mkdirSync(objectRoot);
  const child = spawn(process.execPath, ['-e', "process.stdout.write('ready\\n');setInterval(()=>{},1000)"], {env: {...process.env, WORKSPACEX_OBJECT_STORE: 'fs', WORKSPACEX_OBJECT_ROOT: objectRoot}, stdio: ['ignore', 'pipe', 'ignore']});
  const manifest = {apiRoot: dataDir, head: 'a'.repeat(40), startedAt: '2026-10-02T00:00:00.000Z', deploymentMarker: randomUUID(), processes: [{kind: 'api', pid: child.pid}]};
  try { await once(child.stdout, 'data'); return await action({dataDir, objectRoot, manifest}); }
  finally { child.kill('SIGTERM'); if (child.exitCode === null && child.signalCode === null) await once(child, 'exit'); rmSync(dataDir, {recursive: true, force: true}); }
}

test('storage receipt binds actual fs environment and startup identity', () => fixture(({dataDir, objectRoot, manifest}) => {
  manifest.fileStorage = attestFileStorage({manifest, dataDir, apiEnvironment: {WORKSPACEX_OBJECT_STORE: 'fs', WORKSPACEX_OBJECT_ROOT: objectRoot}});
  assert.equal(verifyFileStorage(manifest).objectRoot, objectRoot);
  assert.throws(() => verifyFileStorage({...manifest, head: 'b'.repeat(40)}));
  assert.throws(() => verifyFileStorage({...manifest, processes: [{kind: 'api', pid: manifest.processes[0].pid + 1}]}));
  assert.throws(() => verifyFileStorage({...manifest, fileStorage: undefined}));
  assert.throws(() => verifyFileStorage({...manifest, processes: [{kind: 'api', pid: 999999999}]}), error => {
    assert.match(error.message, /^FILES_STORAGE_PROCESS_ENV_UNAVAILABLE:(?:-?\d+|unknown)$/);
    assert.equal(error.cause, undefined); assert.equal(error.stdout, undefined); assert.equal(error.stderr, undefined); assert.equal(error.cmd, undefined);
    return true;
  });
}));

test('symlink ancestors, writable ancestors and non-0600 receipts fail closed', () => fixture(({dataDir, objectRoot, manifest}) => {
  manifest.fileStorage = attestFileStorage({manifest, dataDir, apiEnvironment: {WORKSPACEX_OBJECT_STORE: 'fs', WORKSPACEX_OBJECT_ROOT: objectRoot}});
  const alias = join(dataDir, 'ancestor-alias'); symlinkSync(dataDir, alias);
  assert.throws(() => verifyFileStorage({...manifest, fileStorage: {...manifest.fileStorage, objectRoot: join(alias, 'objects')}}));
  chmodSync(objectRoot, 0o777); assert.throws(() => verifyFileStorage(manifest)); chmodSync(objectRoot, 0o755);
  chmodSync(manifest.fileStorage.receiptPath, 0o400); assert.throws(() => verifyFileStorage(manifest)); chmodSync(manifest.fileStorage.receiptPath, 0o600);
  assert.equal(verifyFileStorage(manifest).objectRoot, objectRoot);
}));

test('wrong backend, edited receipt and symlink storage cannot attest', () => fixture(({dataDir, objectRoot, manifest}) => {
  assert.throws(() => attestFileStorage({manifest, dataDir, apiEnvironment: {WORKSPACEX_OBJECT_STORE: 'oss', WORKSPACEX_OBJECT_ROOT: objectRoot}}));
  manifest.fileStorage = attestFileStorage({manifest, dataDir, apiEnvironment: {WORKSPACEX_OBJECT_STORE: 'fs', WORKSPACEX_OBJECT_ROOT: objectRoot}});
  writeFileSync(manifest.fileStorage.receiptPath, '{}'); assert.throws(() => verifyFileStorage(manifest));
  const alias = join(dataDir, 'alias'); symlinkSync(objectRoot, alias);
  assert.throws(() => verifyFileStorage({...manifest, fileStorage: {...manifest.fileStorage, objectRoot: alias}}));
}));

test('owned fs fault really blocks mkdir then restores exactly once', () => fixture(({objectRoot}) => {
  const boardId = randomUUID(), key = `whiteboards/tenants/${'a'.repeat(32)}/boards/${boardId}/files/${'b'.repeat(64)}`;
  const resolveObjectPath = (root, value) => join(root, value, '_blob');
  const fault = blockOwnedFileWrite({objectRoot, key, boardId, resolveObjectPath});
  assert.throws(() => mkdirSync(dirname(resolveObjectPath(objectRoot, key)), {recursive: true}));
  fault.restore(); mkdirSync(dirname(resolveObjectPath(objectRoot, key)), {recursive: true});
  writeFileSync(resolveObjectPath(objectRoot, key), 'restored'); assert.equal(readFileSync(resolveObjectPath(objectRoot, key), 'utf8'), 'restored');
  assert.throws(() => fault.restore());
}));

test('foreign keys and replaced markers cannot be removed by owned cleanup', () => fixture(({objectRoot}) => {
  const boardId = randomUUID(), key = `whiteboards/tenants/${'a'.repeat(32)}/boards/${boardId}/files/${'b'.repeat(64)}`;
  const resolveObjectPath = (root, value) => join(root, value, '_blob');
  assert.throws(() => blockOwnedFileWrite({objectRoot, key, boardId: randomUUID(), resolveObjectPath}));
  assert.throws(() => blockOwnedFileWrite({objectRoot, key: `${key}/extra`, boardId, resolveObjectPath}));
  const fault = blockOwnedFileWrite({objectRoot, key, boardId, resolveObjectPath});
  writeFileSync(fault.path, 'not-our-marker'); assert.throws(() => fault.restore());
  assert.equal(readFileSync(fault.path, 'utf8'), 'not-our-marker');
}));
