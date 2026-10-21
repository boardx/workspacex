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
