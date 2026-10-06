#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { multipart } from './board-file-security-multipart.mjs';

const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3317'), apiOrigin = arg('api', 'http://127.0.0.1:3320');
const out = resolve(arg('out', '/private/tmp/wsx-board-file-security-evidence'));
const storageState = arg('storage-state');
assert(storageState, 'Pass an explicitly exported authenticated session with --storage-state.');
for (const url of [base, apiOrigin]) assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Local services only.');
assert(!existsSync(out), 'Use a fresh evidence directory.');
const script = fileURLToPath(import.meta.url), root = resolve(dirname(script), '../..');
function sourceHash() {
  const files = [script, fileURLToPath(new URL('./board-file-security-multipart.mjs', import.meta.url))];
  const visit = path => { for (const entry of readdirSync(path, { withFileTypes: true })) { const child = join(path, entry.name); if (entry.isDirectory()) visit(child); else if (entry.isFile()) files.push(child); } };
  for (const path of ['apps/api/src', 'apps/api/migrations', 'packages/whiteboard-core/src', 'packages/contracts/src']) visit(join(root, path));
  const hash = createHash('sha256');
  for (const path of files.sort()) hash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0');
  return hash.digest('hex');
}
const sourceHashBefore = sourceHash();
const identities = new Map();
function sessionToken(path) {
  const state = JSON.parse(readFileSync(path, 'utf8'));
  const origin = state.origins?.find(item => item.origin === new URL(base).origin);
  const token = origin?.localStorage?.find(item => item.name === 'wsx.sessionToken')?.value;
  assert(token, 'The supplied storage state has no authenticated session for --base.');
  const session = JSON.parse(origin.localStorage.find(item => item.name === 'wsx.session')?.value ?? 'null');
  const commit = origin.localStorage.find(item => item.name === 'wsx.sessionCommit')?.value;
  assert(session?.version === 2 && session.revision === commit && Date.parse(session.expiresAt) > Date.now() && typeof session.userId === 'string' && session.userId.length > 0, 'A current committed v2 session is required.');
  identities.set(token, { userId: session.userId, orgId: session.currentOrgId });
  return token;
}
const token = sessionToken(storageState), viewerState = arg('viewer-storage-state'), viewerToken = viewerState ? sessionToken(viewerState) : null;
const secrets = [token, viewerToken].filter(Boolean);
const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[token]'), String(value));
mkdirSync(out, { recursive: true });
const results = [], gaps = [
  { name: 'exactly 25 MiB successful upload', reason: 'This run checks the limit plus one rejection, not success at the exact limit.' },
  { name: 'persistence across API restart', reason: 'This run reads persisted bytes within the current runtime lifetime; it does not restart the API.' },
  { name: 'cross-organization real identity isolation', reason: 'Requires an independently authorized session in another organization; no identity is fabricated.' },
  { name: 'organization freeze through HTTP', reason: 'The separate app_rw database acceptance is not an HTTP freeze proof.' },
], ownedBoards = [];
const bytes = Buffer.from('WorkspaceX real ordinary file counterproof\n' + randomUUID());
const hash = createHash('sha256').update(bytes).digest('hex');
async function request(method, path, options = {}, credential = token) {
  const headers = credential ? { authorization: `Bearer ${credential}` } : {};
  if (options.json !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${apiOrigin}${path}`, { method, headers, body: options.json !== undefined ? JSON.stringify(options.json) : options.body, redirect: 'error', signal: AbortSignal.timeout(60000) });
}
async function json(response, expected = 200) {
  assert.equal(response.status, expected, `Unexpected HTTP status: ${response.status}`);
  return response.json();
}
async function createBoard(credential, label) {
  const response = await request('POST', '/whiteboards', { json: { requestId: randomUUID(), name: `File security ${label} ${randomUUID()}` } }, credential);
  assert.equal(response.status, 201); const board = await response.json();
  assert(board.id); ownedBoards.push({ id: board.id, token: credential });
  assert.equal(board.ownerId, identities.get(credential)?.userId, 'Fixture must be owned by the authenticated user.');
  assert.equal(board.role, 'owner');
  return board;
}
async function check(name, run) {
  try { const detail = await run(); results.push({ name, ok: true, detail }); console.log('PASS', name); }
  catch (error) { results.push({ name, ok: false, detail: redact(error.stack ?? error) }); console.log('FAIL', name); }
}
const cleanupBoard = arg('cleanup-board');
let boardA, boardB, metadata;
try {
  if (cleanupBoard) {
    for (const id of cleanupBoard.split(',')) {
      assert.match(id, /^[a-f0-9-]{36}$/);
      const response = await request('GET', `/whiteboards/${id}`);
      if (response.status === 404) { results.push({ name: `cleanup already absent board ${id}`, ok: true }); continue; }
      const board = await json(response); assert.match(board.name, /^File security /, 'Cleanup applies only to this script\'s labelled temporary boards.');
      assert.equal(board.ownerId, identities.get(token)?.userId, 'Cleanup requires the authenticated fixture owner.');
      assert.equal(board.role, 'owner');
      ownedBoards.push({ id: board.id, token });
    }
  } else {
  boardA = await createBoard(token, 'A'); boardB = await createBoard(token, 'B');
  await check('legacy multipart without fileName persists and downloads exactly the submitted bytes', async () => {
    metadata = await json(await request('POST', `/whiteboards/${boardA.id}/files`, { body: multipart(bytes) }), 201);
    assert.equal(metadata.assetId, `board-file-${hash}`); assert.equal(metadata.contentDigest, `sha256:${hash}`);
    assert.equal(metadata.byteSize, bytes.length); assert.equal(metadata.persistence, 'durable'); assert.equal(metadata.fileName, 'proof.txt');
    const response = await request('GET', `/whiteboards/${boardA.id}/files/${metadata.assetId}/content`);
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff'); assert.match(response.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    return { boardId: boardA.id, assetId: metadata.assetId, byteSize: metadata.byteSize, sha256: hash };
  });
  await check('same owner cannot resolve board A file through board B', async () => {
    assert(metadata); const response = await request('GET', `/whiteboards/${boardB.id}/files/${metadata.assetId}/content`); assert.equal(response.status, 404);
    return { status: response.status, bothBoardsAccessible: true };
  });
  await check('special filenames produce valid RFC 5987 attachment headers through real HTTP', async () => {
    const names = ["it's.txt", 'final(1).txt', 'star*.txt', '普通便利贴.txt', '100%.txt', '"quoted".txt', 'literal%22.txt'];
    for (const name of names) {
      const payload = Buffer.concat([bytes, Buffer.from(name)]);
      const file = await json(await request('POST', `/whiteboards/${boardB.id}/files`, { body: multipart(payload, name, 'text/html', true) }), 201);
      assert.equal(file.fileName, name);
      const response = await request('GET', `/whiteboards/${boardB.id}/files/${file.assetId}/content`);
      assert.equal(response.status, 200);
      const disposition = response.headers.get('content-disposition') ?? '';
      assert.match(disposition, /^attachment; filename\*=UTF-8''(?:[A-Za-z0-9!#$&+.^_`|~-]|%[0-9A-F]{2})+$/);
      assert.equal(decodeURIComponent(disposition.split("UTF-8''")[1]), name);
      assert.equal(response.headers.get('content-type'), 'application/octet-stream');
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
      assert.equal(Number(response.headers.get('content-length')), payload.length);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
    }
    return { filenames: names, realHttp: true, declaredMime: 'text/html', deliveredMime: 'application/octet-stream' };
  });
  await check('missing and empty multipart files fail without success metadata', async () => {
    const missing = await request('POST', `/whiteboards/${boardA.id}/files`, { body: new FormData() }); assert.equal(missing.status, 400);
    const empty = await request('POST', `/whiteboards/${boardA.id}/files`, { body: multipart(Buffer.alloc(0), 'empty.txt') }); assert.equal(empty.status, 400);
    const emptyId = `board-file-${createHash('sha256').update(Buffer.alloc(0)).digest('hex')}`;
    const read = await request('GET', `/whiteboards/${boardA.id}/files/${emptyId}/content`); assert.equal(read.status, 404);
    return { missing: missing.status, empty: empty.status, emptyAssetRead: read.status };
  });
  await check('25 MB plus one byte fails at the multipart size boundary', async () => {
    const oversized = Buffer.alloc(25 * 1024 * 1024 + 1, 65), oversizeId = `board-file-${createHash('sha256').update(oversized).digest('hex')}`;
    const response = await request('POST', `/whiteboards/${boardA.id}/files`, { body: multipart(oversized, 'oversize.bin', 'application/octet-stream') });
    assert.equal(response.status, 413);
    const read = await request('GET', `/whiteboards/${boardA.id}/files/${oversizeId}/content`); assert.equal(read.status, 404);
    return { status: response.status, attemptedBytes: oversized.length, rejectedAssetRead: read.status };
  });
  await check('canonical file reference makes portable export and whole-board copy fail explicitly', async () => {
    assert(metadata); const head = await json(await request('GET', `/v1/whiteboards/${boardA.id}/head`));
    const content = { version: 1, type: 'tile', tileType: 'file', title: metadata.fileName, description: 'text/plain', icon: 'file', coverAssetId: null,
      fields: Object.entries(metadata).map(([key, value]) => ({ key, label: '', value: String(value) })), tags: [], link: null, status: 'ready', actions: ['download'] };
    const command = { type: 'create', object: { id: `file_security_${randomUUID()}`, schemaVersion: 1, kind: 'extension', text: metadata.fileName, geometry: { x: 100, y: 100, width: 240, height: 140, rotation: 0 }, parentId: null, orderKey: 'a', style: {}, extensionData: { contentObject: content } } };
    await json(await request('POST', `/whiteboards/${boardA.id}/commands`, { json: { requestId: randomUUID(), epoch: head.epoch, commands: [command] } }), 201);
    const portable = await request('POST', `/whiteboards/${boardA.id}/portable/export`); assert.equal(portable.status, 400);
    assert.equal((await portable.json()).reasonCode, 'UNSUPPORTED_FORMAT');
    const copy = await request('POST', `/whiteboards/${boardA.id}/duplicates`, { json: { requestId: randomUUID(), targetName: `Rejected file copy ${randomUUID()}` } });
    assert.equal(copy.status, 409); assert.equal((await copy.json()).reasonCode, 'COPY_INTEGRITY_FAILED');
    return { portable: portable.status, duplicate: copy.status };
  });
  gaps.push({ name: 'real backup file rejection', reason: 'Board backup is an operator service/script; no backup HTTP controller exists. The focused BoardBackupService test covers rejection before archive publication.' });
  await check('archive refuses new file writes while existing downloads remain readable', async () => {
    const board = await json(await request('GET', `/whiteboards/${boardA.id}`));
    await json(await request('PATCH', `/whiteboards/${boardA.id}`, { json: { archived: true, expectedLifecycleRevision: board.lifecycleRevision } }));
    const denied = await request('POST', `/whiteboards/${boardA.id}/files`, { body: multipart(bytes, 'archived.txt') }); assert.equal(denied.status, 403);
    const read = await request('GET', `/whiteboards/${boardA.id}/files/${metadata.assetId}/content`); assert.equal(read.status, 200); assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
    return { upload: denied.status, download: read.status };
  });
  if (viewerToken) await check('a separate viewer can read but cannot upload to a shared board', async () => {
    const viewerBoard = await createBoard(viewerToken, 'viewer identity'); assert.notEqual(viewerBoard.ownerId, boardB.ownerId, 'Supply a different authenticated user for viewer acceptance.');
    await json(await request('PUT', `/whiteboards/${boardB.id}/members`, { json: { userId: viewerBoard.ownerId, role: 'viewer' } }));
    const peerMetadata = await json(await request('POST', `/whiteboards/${boardB.id}/files`, { body: multipart(bytes, 'viewer-readable.txt') }), 201);
    const board = await json(await request('GET', `/whiteboards/${boardB.id}`, {}, viewerToken)); assert.equal(board.role, 'viewer');
    const read = await request('GET', `/whiteboards/${boardB.id}/files/${peerMetadata.assetId}/content`, {}, viewerToken); assert.equal(read.status, 200); assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
    const denied = await request('POST', `/whiteboards/${boardB.id}/files`, { body: multipart(bytes, 'viewer-write.txt') }, viewerToken); assert.equal(denied.status, 403);
    return { declaredRole: board.role, read: read.status, upload: denied.status };
  });
  else gaps.push({ name: 'real viewer upload denial', reason: 'Requires --viewer-storage-state for another authenticated member of the same organization. Owner membership cannot be downgraded through the public API.' });
  }
} catch (error) { results.push({ name: 'setup', ok: false, detail: redact(error.stack ?? error) }); }
finally {
  for (const board of ownedBoards.reverse()) await check(`cleanup temporary board ${board.id}`, async () => {
    let current = await json(await request('GET', `/whiteboards/${board.id}`, {}, board.token));
    assert.match(current.name, /^File security /);
    assert.equal(current.ownerId, identities.get(board.token)?.userId, 'Cleanup must verify actual owner.');
    assert.equal(current.role, 'owner');
    if (!current.archived) current = await json(await request('PATCH', `/whiteboards/${board.id}`, { json: { archived: true, expectedLifecycleRevision: current.lifecycleRevision } }, board.token));
    const response = await request('DELETE', `/whiteboards/${board.id}`, { json: { requestId: randomUUID(), confirmation: 'PERMANENTLY_DELETE', expectedLifecycleRevision: current.lifecycleRevision } }, board.token);
    assert.equal(response.status, 200);
    const absent = await request('GET', `/whiteboards/${board.id}`, {}, board.token);
    assert.equal(absent.status, 404, 'Fresh API read must confirm fixture absence.');
    return { deleted: true, ownerVerified: true, freshReadStatus: absent.status };
  });
  const sourceHashAfter = sourceHash();
  results.push({ name: 'related source stays stable for the complete acceptance run', ok: sourceHashBefore === sourceHashAfter, detail: { sourceHashBefore, sourceHashAfter } });
  const ok = results.length > 0 && results.every(result => result.ok);
  const report = { ok, realApi: true, base, apiOrigin, sourceHashBefore, sourceHashAfter, sourceStable: sourceHashBefore === sourceHashAfter, results, gaps };
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(out, 'report.md'), `# Board File Security Acceptance\n\nResult: ${ok ? 'PASS (tested paths)' : 'FAIL'}\n\n${results.map(result => `- ${result.ok ? 'PASS' : 'FAIL'} ${result.name}`).join('\n')}\n\n${gaps.map(gap => `- GAP ${gap.name}: ${gap.reason}`).join('\n')}\n`);
  console.log(JSON.stringify({ ok, checks: results.length, gaps: gaps.map(gap => gap.name), evidence: out }));
  process.exitCode = ok ? 0 : 1;
}
