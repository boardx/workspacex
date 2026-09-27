import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {requiredBoardAcceptanceLanes, boardAcceptanceMatrix} from './board-acceptance-matrix.mjs';
import {verifyBoardAcceptanceEvidence} from './verify-board-acceptance-evidence.mjs';
const sha = 'a'.repeat(40);
test('all acceptance lanes explicitly await real producers; no validator tests run as acceptance', () => {
  assert.equal(boardAcceptanceMatrix.length, 12);
  assert.ok(boardAcceptanceMatrix.every(entry => entry.command === null && entry.status === 'not-run'));
});
test('arbitrary hashed logs and forged success metadata cannot grant approval', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'board-acceptance-unit-'));
  try {
    const artifactPath = join(directory, 'fake.log'), bytes = 'not a browser or runtime result';
    await writeFile(artifactPath, bytes);
    const manifest = requiredBoardAcceptanceLanes.map(lane => ({lane, sha, buildSha: sha, dirty: false,
      status: 'passed', exitCode: 0, counterproof: true, command: 'true', environment: 'fake',
      startedAt: '2026-09-27T00:00:00Z', endedAt: '2026-09-27T00:01:00Z', artifactPath,
      artifactSha256: createHash('sha256').update(bytes).digest('hex')}));
    const result = await verifyBoardAcceptanceEvidence(manifest, sha);
    assert.equal(result.approved, false); assert.equal(result.score, null);
    assert.equal(result.failures.length, 12);
    manifest[0].endedAt = 'invalid'; manifest[1].buildSha = 'b'.repeat(40); manifest[2].dirty = true;
    manifest.push({...manifest[3]});
    const invalid = await verifyBoardAcceptanceEvidence(manifest, sha);
    for (const error of ['INVALID_TIME:journeys', 'IDENTITY_MISMATCH:performance-1k', 'IDENTITY_MISMATCH:performance-5k', 'DUPLICATE:performance-10k']) assert.ok(invalid.failures.includes(error), error);
    await writeFile(artifactPath, 'modified');
    assert.ok((await verifyBoardAcceptanceEvidence(manifest, sha)).failures.includes('ARTIFACT_HASH_MISMATCH:journeys'));
  } finally { await rm(directory, {recursive: true, force: true}); }
});
test('runner refuses a supplied SHA that is not HEAD before producing evidence', () => {
  const result = spawnSync(process.execPath, [new URL('./run-board-acceptance.mjs', import.meta.url).pathname], {
    env: {...process.env, BOARD_ACCEPTANCE_SHA: sha}, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /HEAD_SHA_MISMATCH/);
});
