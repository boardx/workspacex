import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function probe(packRoot) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'apps/api/scripts/verify-official-role-packs.ts'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production', SKILL_STARTER_PACK_ROOT: packRoot },
  });
}

test('production official-role probe verifies real shipped packs and rejects missing or tampered inputs', () => {
  const folder = mkdtempSync(join(tmpdir(), 'wx-role-packs-'));
  try {
    const absent = probe(folder);
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /OFFICIAL_ROLE_PACKS_INVALID/);
    cpSync(join(root, 'skills/starter-packs'), folder, { recursive: true });
    const valid = probe(folder);
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(valid.stdout).roles, 7);
    const manifest = join(folder, 'work-research/1.0.0.json');
    const pack = JSON.parse(readFileSync(manifest, 'utf8'));
    pack.skills[0].files[0].contentBase64 = Buffer.from('tampered private content').toString('base64');
    writeFileSync(manifest, JSON.stringify(pack));
    const tampered = probe(folder);
    assert.notEqual(tampered.status, 0);
    assert.match(tampered.stderr, /OFFICIAL_ROLE_PACKS_INVALID/);
    assert.doesNotMatch(tampered.stderr, /tampered private content/);
    assert.notEqual(probe('').status, 0, 'production must never guess a pack root');
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test('distributed API explicitly ships, configures and probes the import source', () => {
  const docker = readFileSync(join(root, 'deploy/aliyun/images/api.Dockerfile'), 'utf8');
  assert.match(docker, /COPY --chown=node:node skills\/starter-packs \.\/skills\/starter-packs/);
  assert.match(docker, /ENV SKILL_STARTER_PACK_ROOT=\/opt\/workspacex\/skills\/starter-packs/);
  assert.match(docker, /node --import tsx scripts\/verify-official-role-packs\.ts/);
});
