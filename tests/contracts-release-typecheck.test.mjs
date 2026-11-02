import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const contracts = resolve(root, 'packages/contracts');
const compiler = resolve(contracts, 'node_modules/typescript/bin/tsc');

test('image contracts check works without phases and still rejects production type errors', () => {
  const temporary = mkdtempSync(resolve(tmpdir(), 'wsx-contracts-release-'));
  const isolated = resolve(temporary, 'packages/contracts');
  try {
    cpSync(contracts, isolated, { recursive: true, filter: (path) => !path.includes('/node_modules') });
    symlinkSync(resolve(contracts, 'node_modules'), resolve(isolated, 'node_modules'), 'dir');
    const check = (config) => spawnSync(process.execPath, [compiler, '-p', config], {
      cwd: isolated, encoding: 'utf8', timeout: 600_000,
    });
    const full = check('tsconfig.json');
    assert.notEqual(full.status, 0);
    assert.match(full.stdout, /billing-team-operations-design.test.ts.*TS2307/);
    const release = check('tsconfig.release.json');
    assert.equal(release.status, 0, release.stdout + release.stderr);
    writeFileSync(resolve(isolated, 'src/release-type-error.ts'), 'export const invalid: string = 42;\n');
    const invalid = check('tsconfig.release.json');
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stdout, /release-type-error.ts.*TS2322/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('both images use the release check and repository CI retains the full check', () => {
  for (const service of ['api', 'web']) {
    const docker = readFileSync(resolve(root, `deploy/aliyun/images/${service}.Dockerfile`), 'utf8');
    assert.match(docker, /RUN --network=none pnpm --filter @repo\/contracts exec tsc -p tsconfig.release.json/);
  }
  const manifest = JSON.parse(readFileSync(resolve(contracts, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts.typecheck, 'tsc --noEmit');
});
