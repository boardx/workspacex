// Image-assembly tool only: remove the unused optional Cairo-backed canvas backend.
// A required dependency path is an error, never something to suppress or delete.
import { readFileSync, readdirSync, lstatSync, readlinkSync, existsSync, unlinkSync, rmSync } from 'node:fs';
import { resolve, join, dirname, relative, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
export function pruneOptionalCanvasRuntime(project) {
  const root = resolve(project), modules = join(root, 'node_modules'), store = join(modules, '.pnpm');
  if (JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')).name !== '@repo/api'
    || !lstatSync(store).isDirectory() || lstatSync(store).isSymbolicLink()) throw Error('OWNED_API_INSTALL_REQUIRED');
  const lock = parse(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')), seen = new Set(), importers = new Set();
  function importer(id) {
    if (importers.has(id)) return; importers.add(id);
    const value = lock.importers[id]; if (!value) throw Error('MISSING_RUNTIME_IMPORTER');
    edges(value.dependencies, id);
  }
  function edges(deps, parent) {
    for (const [name, spec] of Object.entries(deps ?? {})) {
      const version = typeof spec === 'string' ? spec : spec.version;
      if (version.startsWith('link:')) {
        const target = relative(root, resolve(root, parent, version.slice(5))).split(sep).join('/');
        if (target === '..' || target.startsWith('../')) throw Error('EXTERNAL_RUNTIME_IMPORTER');
        importer(target); continue;
      }
      const key = lock.snapshots[`${name}@${version}`] ? `${name}@${version}` : version;
      if (/^canvas@/.test(key)) throw Error('CANVAS_IS_REQUIRED_RUNTIME_DEPENDENCY');
      if (seen.has(key)) continue; seen.add(key);
      const value = lock.snapshots[key]; if (!value) throw Error('MISSING_RUNTIME_SNAPSHOT: ' + key);
      edges(value.dependencies, parent);
    }
  }
  importer('apps/api');
  const candidates = readdirSync(store).filter(name => name.startsWith('canvas@'));
  if (candidates.some(name => name !== 'canvas@3.2.3')) throw Error('UNREVIEWED_CANVAS_VERSION');
  const targets = candidates.map(name => join(store, name));
  for (const path of targets) if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw Error('UNOWNED_CANVAS_STORE');
  const inside = path => targets.some(target => path === target || path.startsWith(target + sep));
  let links = 0;
  function unlinkReferences(dir) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        if (inside(resolve(dirname(path), readlinkSync(path)))) { unlinkSync(path); links++; }
      } else if (stat.isDirectory() && !inside(path)) unlinkReferences(path);
    }
  }
  unlinkReferences(modules);
  for (const id of importers) unlinkReferences(join(root, id, 'node_modules'));
  // Same Docker RUN as installation: these bytes never enter a published layer.
  for (const path of targets) rmSync(path, { recursive: true });
  const findings = [];
  function inspect(dir) {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name), stat = lstatSync(path);
      if (stat.isDirectory()) inspect(path);
      else if (stat.isFile() && /^(?:canvas\.node|lib(?:vips|pango|pangocairo|rsvg|cairo|glib-|gobject-|gio-).*\.so(?:\.|$))/.test(basename(path))) findings.push(relative(root, path));
    }
  }
  inspect(modules);
  if (findings.length) throw Error('UNEXPECTED_NATIVE_IMAGE_LIBRARIES: ' + JSON.stringify(findings));
  return { removedOptionalCanvasStores: targets.length, removedLinks: links, requiredSnapshotsChecked: seen.size, forbiddenNativeImageLibraries: 0 };

}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(pruneOptionalCanvasRuntime(process.argv[2])));
}
