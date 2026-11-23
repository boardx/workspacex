/** Fixed, credential-free own-run diagnostic bundle; no product build or service mutation. */
import { readFileSync, mkdirSync, copyFileSync, writeFileSync, lstatSync, constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const OWNED_FAILURE_BUNDLE_FILES = Object.freeze([
  'apps/web/e2e/support/devapp-aidt-owned-failure-runner.mjs',
  'apps/web/e2e/support/devapp-aidt-owned-failure-readonly.mjs',
  'apps/web/e2e/support/devapp-aidt-auth-readonly.mjs',
  'apps/web/e2e/support/devapp-aidt-qa-identity.mjs',
  'scripts/image-release-host-permissions.py',
]);
export function buildOwnedFailureBundle(directory, env = process.env) {
  if (typeof directory !== 'string' || resolve(directory) !== directory || /[\r\n]/.test(directory) || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('OWNED_FAILURE_BUNDLE_SCOPE_INVALID');
  mkdirSync(directory, { mode: 0o700 });
  const importer = readFileSync('pnpm-lock.yaml', 'utf8').split('\n  apps/web:\n')[1]?.split('\n  apps/')[0];
  const version = importer?.match(/\n      '@playwright\/test':\n        specifier: [^\n]+\n        version: (\d+\.\d+\.\d+)\n/)?.[1];
  if (!version) throw new Error('OWNED_FAILURE_PLAYWRIGHT_VERSION_MISSING');
  const copied = [];
  for (const source of OWNED_FAILURE_BUNDLE_FILES) {
    const info = lstatSync(source);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new Error('OWNED_FAILURE_BUNDLE_FILE_INVALID');
    const file = basename(source); copyFileSync(source, resolve(directory, file), constants.COPYFILE_EXCL); copied.push(file);
  }
  writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@playwright/test': version } }), { flag: 'wx', mode: 0o600 });
  writeFileSync(resolve(directory, 'control-source.json'), JSON.stringify({ controlSource: env.GITHUB_SHA }), { flag: 'wx', mode: 0o600 });
  const files = [...copied, 'package.json', 'control-source.json'];
  writeFileSync(resolve(directory, 'SHA256SUMS'), files.map(file => createHash('sha256').update(readFileSync(resolve(directory, file))).digest('hex') + '  ' + file).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
  return { kind: 'aidt-owned-failure-control-bundle', fileCount: files.length, controlSource: env.GITHUB_SHA };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('OWNED_FAILURE_BUNDLE_ARGUMENTS_INVALID');
  console.log(JSON.stringify(buildOwnedFailureBundle(process.argv[2])));
}
