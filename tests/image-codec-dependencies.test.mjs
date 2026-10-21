import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { parse } from 'yaml';
const root = new URL('../', import.meta.url);
const lock = parse(readFileSync(new URL('pnpm-lock.yaml', root), 'utf8'));
function closure(importer, seen = new Set(), projects = new Set()) {
  if (projects.has(importer)) return seen;
  projects.add(importer);
  const visit = deps => { for (const [name, spec] of Object.entries(deps ?? {})) {
    const version = typeof spec === 'string' ? spec : spec.version;
    if (version.startsWith('link:')) { closure(posix.normalize(posix.join(importer, version.slice(5))), seen, projects); continue; }
    const key = `${name}@${version}`; if (seen.has(key)) continue; seen.add(key);
    const snapshot = lock.snapshots[key]; assert(snapshot, `missing locked snapshot: ${key}`);
    visit(snapshot.dependencies); visit(snapshot.optionalDependencies);
  } };
  const project = lock.importers[importer]; assert(project, importer);
  visit(project.dependencies); visit(project.optionalDependencies); return seen;
}
test('Web/API production closures cannot reintroduce sharp or bundled libvips', () => {
  for (const importer of ['apps/api', 'apps/web']) {
    const packages = [...closure(importer)]; assert(packages.length > 100);
    assert.deepEqual(packages.filter(key => /^(?:sharp@|@img\/sharp)/.test(key)), []);
  }
});
test('the native replacement and all platform bindings are exact-version locked', () => {
  assert.equal(lock.importers['apps/api'].dependencies['@napi-rs/image'].specifier, '1.15.0');
  const bindings = lock.snapshots['@napi-rs/image@1.15.0'].optionalDependencies;
  assert(Object.keys(bindings).length >= 10);
  for (const [name, version] of Object.entries(bindings)) {
    assert.equal(version, '1.15.0'); assert(lock.packages[`${name}@${version}`].resolution.integrity);
  }
});
test('Next uses the original-image path without its sharp optimizer', async () => {
  const config = (await import('../apps/web/next.config.mjs')).default;
  assert.equal(config.images.unoptimized, true);
});

test('API text extraction and runtime installation cannot retain the native canvas peer', () => {
  assert.deepEqual([...closure('apps/api')].filter(key => /^(?:canvas|jsdom)@/.test(key)), []);
  const api = JSON.parse(readFileSync(new URL('apps/api/package.json', root), 'utf8'));
  assert(api.dependencies.tsx); assert.equal(api.dependencies.domino, '2.1.8');
  assert(!lock.snapshots['domino@2.1.8'].dependencies);
  const docker = readFileSync(new URL('deploy/aliyun/images/api.Dockerfile', root), 'utf8');
  const runtime = docker.split('FROM sources AS runtime\n')[1]; assert(runtime);
  assert.match(runtime, /pnpm --filter-prod @repo\/api\.\.\. install --prod --frozen-lockfile/);
  assert.match(runtime, /COPY --from=build \/api-typecheck\.ok/);
  assert.doesNotMatch(runtime, /COPY --from=build .*node_modules/);
});

test('standalone guard rejects physically retained native imaging dependencies', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { assertRuntimeImageDependencies } = await import('../apps/web/scripts/assert-runtime-image-dependencies.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'wsx-runtime-image-'));
  try {
    assert.throws(() => assertRuntimeImageDependencies(folder), /ENOENT|STANDALONE_ENTRY_REQUIRED/);
    mkdirSync(join(folder, 'apps/web'), { recursive: true }); writeFileSync(join(folder, 'apps/web/server.js'), '// fixture');
    assert.equal(assertRuntimeImageDependencies(folder).forbiddenRuntimeImageDependencies, 0);
    const bad = join(folder, 'node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.2.4'); mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'libvips-cpp.so.8'), 'fixture');
    assert.throws(() => assertRuntimeImageDependencies(folder), /FORBIDDEN_RUNTIME_IMAGE_DEPENDENCIES/);
    rmSync(join(folder, 'node_modules'), { recursive: true });
    mkdirSync(join(folder, 'node_modules/canvas'), { recursive: true }); writeFileSync(join(folder, 'node_modules/canvas/canvas.node'), 'fixture');
    assert.throws(() => assertRuntimeImageDependencies(folder), /FORBIDDEN_RUNTIME_IMAGE_DEPENDENCIES/);
  } finally { rmSync(folder, { recursive: true }); }
});
