import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {cwd: directory, encoding: 'utf8'}).trim();
const current = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const old = '4d407d2ff1df62abd6b6429395ccb3115b36ca4d';
const template = readFileSync(join(directory, 'scenario.mts.template'), 'utf8');
const temporary = mkdtempSync(join(tmpdir(), 'research-local-runtime-'));
const hash = value => createHash('sha256').update(value).digest('hex');

// Snapshot production code and workspace package sources. Dependencies reuse the
// existing installation; no checkout, credentials, database or external model.
function snapshot(label, sha) {
  const destination = join(temporary, label);
  mkdirSync(destination);
  const paths = ['apps/api/src', 'packages', 'apps/api/package.json', 'apps/api/tsconfig.json'];
  if (label === 'current') paths.push('apps/api/tests/research/full-source-geometry-fixture.ts', 'docs/evidence/research-organizing-5546/original-geometry.json');
  const archive = execFileSync('git', ['archive', sha, ...paths], {cwd: root, maxBuffer: 128 * 1024 * 1024});
  execFileSync('tar', ['-xf', '-', '-C', destination], {input: archive});
  const packages = readdirSync(join(destination, 'packages'), {withFileTypes: true}).filter(entry => entry.isDirectory()).map(entry => join(destination, 'packages', entry.name));
  const names = new Map(packages.filter(path => existsSync(join(path, 'package.json'))).map(path => [JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).name, path]));
  for (const path of [join(destination, 'apps/api'), ...packages]) {
    const installed = join(root, relative(destination, path), 'node_modules');
    if (!existsSync(installed)) continue;
    const target = join(path, 'node_modules');
    mkdirSync(target, {recursive: true});
    for (const entry of readdirSync(installed)) {
      if (entry === '@repo') {
        mkdirSync(join(target, entry));
        for (const child of readdirSync(join(installed, entry))) {
          symlinkSync(names.get(`@repo/${child}`) ?? realpathSync(join(installed, entry, child)), join(target, entry, child));
        }
      } else symlinkSync(realpathSync(join(installed, entry)), join(target, entry));
    }
  }
  return destination;
}

function execute(destination, label, cases, modes) {
  const source = template.replaceAll('__API_SOURCE__', join(destination, 'apps/api/src'))
    .replaceAll('__GEOMETRY_FIXTURE__', join(temporary, 'current/apps/api/tests/research/full-source-geometry-fixture.ts'))
    .replace('__CASES__', JSON.stringify(cases)).replace('__MODES__', JSON.stringify(modes));
  const path = join(destination, `${label}.mts`);
  writeFileSync(path, source, {mode: 0o600});
  const child = spawnSync('pnpm', ['exec', 'tsx', path], {cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024});
  const rows = (child.stdout ?? '').split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  // A loader failure cannot masquerade as the expected regression.
  assert.equal(child.signal, null);
  const expectedRed = label.startsWith('old');
  assert.equal(child.status, expectedRed ? 1 : 0, `${label} unexpected process verdict`);
  if (expectedRed) {
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'comparison');
    assert.equal(rows[0].fault, 'rejected');
    assert.equal(rows[0].regenerated, modes[0]);
    assert.equal(rows[0].actualError, 'RESEARCH_WORKFLOW_UNAVAILABLE');
    assert.equal(rows[0].sections, 0);
    assert.equal(rows[0].batch15Calls, 1);
  } else assert.equal(rows.filter(row => row.kind !== 'comparison').length, 8);
  return {label, exitCode: child.status, executedSourceSHA256: hash(source), results: rows};
}

try {
  const previous = snapshot('old', old);
  const latest = snapshot('current', current);
  const runs = [execute(previous, 'old-first', ['rejected'], [false]), execute(previous, 'old-regeneration', ['rejected'], [true]),
    execute(latest, 'current', ['rejected', 'invalid-reference', 'unclassified', 'authentication'], [false, true])];
  console.log(JSON.stringify({oldSourceSHA: old, currentSourceSHA: current, templateSHA256: hash(template), runs,
    limits: ['synthetic geometry and loopback HTTP', 'fixed semantic review verdicts', 'memory storage, not database durability', 'invalid-reference is an evidence quote, not prose citation', 'no online recovery or running SHA claim']}, null, 2));
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
