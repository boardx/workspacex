import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, realpathSync, lstatSync, mkdirSync, unlinkSync, existsSync} from 'node:fs';
import {resolve, join, dirname, sep} from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child.startsWith(parent + sep);

function privateOwnedPath(path) {
  assert.equal(path, resolve(path), 'Storage paths must be canonical absolute paths');
  assert(inside('/private/tmp', path), 'Storage paths must remain inside the approved private temporary root');
  for (let ancestor = path; ancestor !== '/private/tmp'; ancestor = dirname(ancestor)) {
    const stat = lstatSync(ancestor);
    assert(!stat.isSymbolicLink(), 'Storage path ancestors cannot be symlinks');
    assert.equal(stat.uid, process.getuid(), 'Storage path ancestors must belong to the runtime owner');
    assert.equal(stat.mode & 0o022, 0, 'Storage path ancestors cannot be writable by other users');
    if (ancestor !== path) assert(stat.isDirectory(), 'Storage path ancestors must be directories');
  }
  return realpathSync(path);
}

function processStorage(pid) {
  assert(Number.isInteger(pid) && pid > 0);
  // Read only two allowlisted fields; never persist or return the full process environment.
  let command;
  try { command = execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], {encoding: 'utf8', maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']}); }
  catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 'unknown';
    // Child-process errors carry stdout (the full environment). Never retain the original error or cause.
    throw new Error(`FILES_STORAGE_PROCESS_ENV_UNAVAILABLE:${status}`);
  }
  const field = name => {
    const matches = [...command.matchAll(new RegExp(`(?:^|\\s)${name}=([^\\s]+)(?=\\s|$)`, 'g'))];
    assert.equal(matches.length, 1, `Actual API process must expose one ${name}`);
    return matches[0][1];
  };
  try {
    if (field('WORKSPACEX_OBJECT_STORE') !== 'fs') throw new Error('wrong backend');
    return {backend: 'fs', objectRoot: privateOwnedPath(field('WORKSPACEX_OBJECT_ROOT'))};
  } catch { throw new Error('FILES_STORAGE_PROCESS_ENV_INVALID'); }
}

// Future runtime producers call this with the SAME environment object passed to the API child.
// The current live producer is intentionally not modified by this acceptance module.
export function attestFileStorage({manifest, apiEnvironment, dataDir}) {
  assert.equal(apiEnvironment.WORKSPACEX_OBJECT_STORE, 'fs');
  const data = privateOwnedPath(dataDir), objectRoot = privateOwnedPath(apiEnvironment.WORKSPACEX_OBJECT_ROOT);
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
  const data = privateOwnedPath(storage.dataDir), objectRoot = privateOwnedPath(storage.objectRoot), receiptPath = privateOwnedPath(storage.receiptPath);
  assert(data.startsWith('/private/tmp/')); assert(inside(data, objectRoot)); assert(inside(data, receiptPath));
  for (const path of [storage.dataDir, storage.objectRoot, storage.receiptPath]) assert(!lstatSync(path).isSymbolicLink());
  assert(lstatSync(objectRoot).isDirectory()); assert(lstatSync(receiptPath).isFile());
  assert.equal(lstatSync(data).uid, process.getuid()); assert.equal(lstatSync(objectRoot).uid, process.getuid()); assert.equal(lstatSync(receiptPath).uid, process.getuid());
  assert.equal(lstatSync(receiptPath).mode & 0o777, 0o600, 'Receipt permissions must be exactly private read/write');
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
  const root = privateOwnedPath(objectRoot), path = resolveObjectPath(root, key), parent = dirname(path);
  assert(inside(root, path)); assert(inside(root, parent));
  for (let ancestor = dirname(parent); ancestor !== root; ancestor = dirname(ancestor)) {
    assert(inside(root, ancestor));
    if (existsSync(ancestor)) {
      const stat = lstatSync(ancestor);
      assert(stat.isDirectory()); assert(!stat.isSymbolicLink()); assert.equal(realpathSync(ancestor), ancestor);
      assert.equal(stat.uid, process.getuid()); assert.equal(stat.mode & 0o022, 0);
    }
  }
  mkdirSync(dirname(parent), {recursive: true, mode: 0o700});
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
