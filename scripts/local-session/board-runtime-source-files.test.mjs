import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { listRuntimeSourceFiles } from './board-runtime-source-files.mjs';

test('selects the complete runtime set once and excludes unrelated tracked files', () => {
  const root = mkdtempSync(join(tmpdir(), 'board-source-selector-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    const expected = ['apps/api/a.ts', 'apps/web/a.tsx', 'packages/contracts/a.ts', 'scripts/local-session/board-runtime-source-files.mjs', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json', '.npmrc', '.nvmrc'];
    for (const path of [...expected, 'docs/other.md', 'scripts/other.mjs', 'phases/feature.json']) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), 'fixture\n');
    }
    execFileSync('git', ['add', '.'], { cwd: root });
    const actual = listRuntimeSourceFiles(root);
    assert.deepEqual(actual.toSorted(), expected.toSorted());
    assert.equal(new Set(actual).size, actual.length);
    assert(actual.includes('scripts/local-session/board-runtime-source-files.mjs'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('invalid and non-repository roots fail closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'board-source-invalid-'));
  try {
    assert.throws(() => listRuntimeSourceFiles(root));
    assert.throws(() => listRuntimeSourceFiles(join(root, 'missing')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('import exposes only the read-only selector and does not write in caller cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'board-source-import-'));
  try {
    const marker = join(root, 'marker');
    writeFileSync(marker, 'unchanged');
    const url = new URL('./board-runtime-source-files.mjs', import.meta.url).href;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `const m=await import(${JSON.stringify(url)});console.log(JSON.stringify(Object.keys(m)));`], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(result), ['listRuntimeSourceFiles']);
    assert.deepEqual(readdirSync(root), ['marker']);
    assert.equal(readFileSync(marker, 'utf8'), 'unchanged');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
