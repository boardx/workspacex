import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, realpathSync, lstatSync, mkdirSync, unlinkSync, existsSync} from 'node:fs';
import {resolve, join, dirname, sep} from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child.startsWith(parent + sep);

function processStorage(pid) {
  assert(Number.isInteger(pid) && pid > 0);
  // Read only two allowlisted fields; never persist or return the full process environment.
  const command = execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], {encoding: 'utf8', maxBuffer: 1024 * 1024});
  const field = name => {
    const matches = [...command.matchAll(new RegExp(`(?:^|\\s)${name}=([^\\s]+)(?=\\s|$)`, 'g'))];
    assert.equal(matches.length, 1, `Actual API process must expose one ${name}`);
    return matches[0][1];
  };
  return {backend: field('WORKSPACEX_OBJECT_STORE'), objectRoot: realpathSync(field('WORKSPACEX_OBJECT_ROOT'))};
}

// Future runtime producers call this with the SAME environment object passed to the API child.
// The current live producer is intentionally not modified by this acceptance module.
export function attestFileStorage({manifest, apiEnvironment, dataDir}) {
  assert.equal(apiEnvironment.WORKSPACEX_OBJECT_STORE, 'fs');
  const data = realpathSync(dataDir), objectRoot = realpathSync(apiEnvironment.WORKSPACEX_OBJECT_ROOT);
  assert(data.startsWith('/private/tmp/')); assert(inside(data, objectRoot));
  assert(lstatSync(objectRoot).isDirectory() && !lstatSync(objectRoot).isSymbolicLink());
  const api = manifest.processes.find(item => item.kind === 'api'); assert(api?.pid > 0);
  assert.deepEqual(processStorage(api.pid), {backend: 'fs', objectRoot}, 'Actual API process storage must match its configured receipt');
  const receipt = {backend: 'fs', objectRoot, dataDir: data, apiRoot: realpathSync(manifest.apiRoot), apiPid: api.pid, head: manifest.head, startedAt: manifest.startedAt, deploymentMarker: manifest.deploymentMarker};
  const receiptPath = join(data, `file-storage-${randomUUID()}.json`), bytes = Buffer.from(JSON.stringify(receipt));
  writeFileSync(receiptPath, bytes, {flag: 'wx', mode: 0o600});
  return {...receipt, receiptPath, receiptSha256: digest(bytes)};
}

export function verifyFileStorage(manifest) {
  const storage = manifest.fileStorage; assert(storage, 'Attested storage descriptor required; no environment fallback');
  const data = realpathSync(storage.dataDir), objectRoot = realpathSync(storage.objectRoot), receiptPath = realpathSync(storage.receiptPath);
  assert(data.startsWith('/private/tmp/')); assert(inside(data, objectRoot)); assert(inside(data, receiptPath));
  for (const path of [storage.dataDir, storage.objectRoot, storage.receiptPath]) assert(!lstatSync(path).isSymbolicLink());
  assert(lstatSync(objectRoot).isDirectory()); assert(lstatSync(receiptPath).isFile());
  assert.equal(lstatSync(data).uid, process.getuid()); assert.equal(lstatSync(objectRoot).uid, process.getuid()); assert.equal(lstatSync(receiptPath).uid, process.getuid());
  assert.equal(lstatSync(receiptPath).mode & 0o077, 0, 'Receipt must not be group/world-readable');
  const bytes = readFileSync(receiptPath); assert.equal(digest(bytes), storage.receiptSha256);
  const expected = {backend: 'fs', objectRoot, dataDir: data, apiRoot: realpathSync(manifest.apiRoot), apiPid: manifest.processes.find(item => item.kind === 'api')?.pid, head: manifest.head, startedAt: manifest.startedAt, deploymentMarker: manifest.deploymentMarker};
  assert.deepEqual(processStorage(expected.apiPid), {backend: 'fs', objectRoot}, 'Actual API process storage changed');
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), expected);
  const {receiptPath: ignoredPath, receiptSha256: ignoredHash, ...descriptor} = storage;
  void ignoredPath; void ignoredHash; assert.deepEqual(descriptor, expected);
  return {objectRoot, dataDir: data, receiptSha256: storage.receiptSha256};
}

/** A unique owned-file parent blocks actual FsObjectStore.mkdir; cleanup cannot unlink anyone else's path. */
export function blockOwnedFileWrite({objectRoot, key, boardId, resolveObjectPath}) {
  assert.match(boardId, /^[a-f0-9-]{36}$/); assert.match(key, new RegExp(`^whiteboards/tenants/[a-f0-9]{32}/boards/${boardId}/files/[a-f0-9]{64}$`));
  const root = realpathSync(objectRoot), path = resolveObjectPath(root, key), parent = dirname(path);
  assert(inside(root, path)); assert(inside(root, parent));
  for (let ancestor = dirname(parent); ancestor !== root; ancestor = dirname(ancestor)) {
    assert(inside(root, ancestor));
    if (existsSync(ancestor)) { assert(lstatSync(ancestor).isDirectory()); assert(!lstatSync(ancestor).isSymbolicLink()); assert.equal(realpathSync(ancestor), ancestor); }
  }
  mkdirSync(dirname(parent), {recursive: true});
  const marker = Buffer.from(`owned-file-fault:${randomUUID()}`);
  writeFileSync(parent, marker, {flag: 'wx', mode: 0o600});
  const owned = lstatSync(parent); assert(owned.isFile() && !owned.isSymbolicLink());
  let restored = false;
  return {
    path: resolve(parent),
    restore() {
      assert(!restored, 'Owned fault must be restored exactly once');
      const current = lstatSync(parent);
      assert(current.isFile() && !current.isSymbolicLink()); assert.equal(current.ino, owned.ino); assert.equal(current.dev, owned.dev);
      assert.deepEqual(readFileSync(parent), marker); unlinkSync(parent); restored = true;
    },
  };
}
