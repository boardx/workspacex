import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { sealArchive, verifyArchive, verificationIdentity } from './devportal-artifact.mjs';

const identity = { sourceSha: 'a'.repeat(40), runId: '123', runAttempt: '1' };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'devportal-artifact-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifact = join(root, 'artifact'); mkdirSync(artifact);
  writeFileSync(join(artifact, 'pages.tar.gz'), 'archive bytes');
  return { root, artifact };
}

test('same source, run and attempt verifies exact archive bytes', t => {
  const { artifact } = fixture(t);
  sealArchive(artifact, identity);
  assert.equal(verifyArchive(artifact, identity), true);
  assert.throws(() => sealArchive(artifact, identity));
});
test('failed-job retry uses the retained validate producer attempt, never the consumer attempt', t => {
  const { artifact } = fixture(t); sealArchive(artifact, identity);
  const env = { GITHUB_SHA: identity.sourceSha, GITHUB_RUN_ID: identity.runId,
    GITHUB_RUN_ATTEMPT: '2', DEVPORTAL_PRODUCER_ATTEMPT: '1' };
  assert.equal(verifyArchive(artifact, verificationIdentity(env)), true);
  assert.throws(() => verificationIdentity({ ...env, DEVPORTAL_PRODUCER_ATTEMPT: '' }));
});
for (const [key, value] of [['sourceSha', 'b'.repeat(40)], ['runId', '124'], ['runAttempt', '2']]) {
  test(`rejects ${key} drift`, t => {
    const { artifact } = fixture(t); sealArchive(artifact, identity);
    assert.throws(() => verifyArchive(artifact, { ...identity, [key]: value }));
  });
}
test('tampering, invalid metadata and missing files cannot reach deployment', t => {
  const { artifact } = fixture(t); sealArchive(artifact, identity);
  writeFileSync(join(artifact, 'pages.tar.gz'), 'different');
  assert.throws(() => verifyArchive(artifact, identity));
  writeFileSync(join(artifact, 'manifest.json'), '{}');
  assert.throws(() => verifyArchive(artifact, identity));
  rmSync(join(artifact, 'manifest.json'));
  assert.throws(() => verifyArchive(artifact, identity));
});
test('manifest and archive symlinks are rejected', t => {
  const { artifact, root } = fixture(t); sealArchive(artifact, identity);
  const copy = join(root, 'copy'); writeFileSync(copy, readFileSync(join(artifact, 'manifest.json')));
  rmSync(join(artifact, 'manifest.json')); symlinkSync(copy, join(artifact, 'manifest.json'));
  assert.throws(() => verifyArchive(artifact, identity));
  rmSync(join(artifact, 'manifest.json')); writeFileSync(join(artifact, 'manifest.json'), readFileSync(copy));
  rmSync(join(artifact, 'pages.tar.gz')); symlinkSync(copy, join(artifact, 'pages.tar.gz'));
  assert.throws(() => verifyArchive(artifact, identity));
});
test('real archive roundtrip retains hidden worker metadata and executable mode', t => {
  const { artifact, root } = fixture(t);
  const source = join(root, 'source'), target = join(root, 'target'); mkdirSync(source); mkdirSync(target);
  writeFileSync(join(source, '.worker-metadata'), 'hidden');
  writeFileSync(join(source, 'worker.js'), 'worker'); chmodSync(join(source, 'worker.js'), 0o755);
  execFileSync('tar', ['-czf', join(artifact, 'pages.tar.gz'), '-C', source, '.']);
  sealArchive(artifact, identity); verifyArchive(artifact, identity);
  execFileSync('tar', ['-xzf', join(artifact, 'pages.tar.gz'), '-C', target]);
  assert.equal(readFileSync(join(target, '.worker-metadata'), 'utf8'), 'hidden');
  assert.equal(statSync(join(target, 'worker.js')).mode & 0o777, 0o755);
});
test('actual workflow builds once and verifies the same-run artifact before cutover', () => {
  const { parse } = createRequire(import.meta.url)('yaml');
  const w = parse(readFileSync(new URL('../workflows/deploy-devportal.yml', import.meta.url), 'utf8'));
  const validate = w.jobs.validate.steps, deploy = w.jobs.deploy.steps;
  assert.equal(validate.filter(s => s.run?.includes('pnpm run pages:build')).length, 1);
  assert.equal(deploy.filter(s => /pnpm (?:run )?(?:build|pages:build)/.test(s.run ?? '')).length, 0);
  const upload = validate.find(s => s.uses?.startsWith('actions/upload-artifact@'));
  const download = deploy.find(s => s.uses?.startsWith('actions/download-artifact@'));
  assert.equal(w.jobs.validate.outputs.producer_attempt, '${{ steps.artifact-identity.outputs.attempt }}');
  assert.match(download.with.name, /needs\.validate\.outputs\.producer_attempt/);
  assert.match(upload.with.name, /github\.run_id/); assert.match(upload.with.name, /github\.run_attempt/);
  const verification = deploy.findIndex(s => s.run?.includes('devportal-artifact.mjs verify'));
  assert.equal(deploy[verification].env.DEVPORTAL_PRODUCER_ATTEMPT, '${{ needs.validate.outputs.producer_attempt }}');
  const extraction = deploy.findIndex(s => s.run?.includes('tar -xzf'));
  const cutover = deploy.findIndex(s => s.run?.includes('node scripts/pages-cutover.mjs'));
  assert.ok(verification >= 0 && extraction > verification && cutover > extraction);
});
