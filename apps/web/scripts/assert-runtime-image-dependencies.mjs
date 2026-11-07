import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
export function assertRuntimeImageDependencies(directory) {
  const root = resolve(directory);
  if (!lstatSync(root).isDirectory() || !lstatSync(resolve(root, 'apps/web/server.js')).isFile()) throw Error('STANDALONE_ENTRY_REQUIRED');
  const findings = []; let files = 0;
  function visit(dir) {
    for (const name of readdirSync(dir)) {
      const path = resolve(dir, name), rel = relative(root, path).split(sep).join('/'), info = lstatSync(path);
      if (/node_modules\/(?:sharp|canvas)(?:\/|$)|node_modules\/\.pnpm\/(?:sharp@|canvas@|@img\+sharp-)|node_modules\/@img\/sharp-/.test(rel)
        || /^(?:canvas\.node|lib(?:vips|pango|pangocairo|rsvg|cairo|glib-|gobject-|gio-).*\.so(?:\.|$))/.test(basename(path))) findings.push(rel);
      if (info.isSymbolicLink()) {
        const target = relative(root, realpathSync(path));
        if (target === '..' || target.startsWith('..' + sep)) throw Error('EXTERNAL_RUNTIME_LINK');
      } else if (info.isDirectory()) visit(path);
      else files++;
    }
  }
  visit(root);
  if (findings.length) throw Error('FORBIDDEN_RUNTIME_IMAGE_DEPENDENCIES: ' + JSON.stringify(findings));
  return { files, forbiddenRuntimeImageDependencies: 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(assertRuntimeImageDependencies(process.argv[2])));
}
