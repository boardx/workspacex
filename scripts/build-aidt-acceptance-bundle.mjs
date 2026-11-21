/** Produce an allowlisted, credential-free control-plane bundle for the Dev host. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const files = [
  '.nvmrc',
  'apps/web/e2e/support/devapp-aidt-auth-readonly.mjs',
  'apps/web/e2e/support/devapp-aidt-acceptance-guard.mjs',
  'apps/web/e2e/support/devapp-aidt-acceptance.mjs',
  'apps/web/e2e/support/devapp-aidt-journey.mjs',
  'scripts/image-release-host-permissions.py',
];
const sha = process.env.GITHUB_SHA;
if (!/^[a-f0-9]{40}$/.test(sha ?? '') || process.argv.length !== 3) throw new Error('BUNDLE_ARGUMENTS_INVALID');
const root = resolve(process.argv[2]); mkdirSync(root, { recursive: true, mode: 0o700 });
const importer = readFileSync('pnpm-lock.yaml', 'utf8').split('\n  apps/web:\n')[1]?.split('\n  apps/')[0];
const playwright = importer?.match(/\n      '@playwright\/test':\n        specifier: [^\n]+\n        version: (\d+\.\d+\.\d+)\n/)?.[1];
if (!playwright) throw new Error('PLAYWRIGHT_LOCK_VERSION_MISSING');
const source = readFileSync('packages/contracts/src/aidt-run-context.ts', 'utf8');
const identities = source.match(/export const AIDT_STAGE_IDENTITIES = \[([\s\S]*?)\] as const;/)?.[1];
const names = [...(identities ?? '').matchAll(/skill: "([a-z][a-z0-9-]+)"/g)].map(match => match[1]);
const summary = source.match(/export const AIDT_SUMMARY_STABLE_NAME = "([a-z][a-z0-9-]+)";/)?.[1];
if (names.length !== 6 || new Set(names).size !== 6 || !summary) throw new Error('CANONICAL_SKILL_NAMES_INVALID');
for (const file of files) {
  const info = lstatSync(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 1048576) throw new Error('BUNDLE_FILE_INVALID');
  mkdirSync(dirname(resolve(root, file)), { recursive: true, mode: 0o700 }); copyFileSync(file, resolve(root, file));
}
writeFileSync(resolve(root, 'acceptance-source.json'), JSON.stringify({ controlSource: sha, teachingSkillNames: [...names, summary], playwrightVersion: playwright }));
writeFileSync(resolve(root, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: { '@playwright/test': playwright } }));
const listed = [...files, 'acceptance-source.json', 'package.json'];
writeFileSync(resolve(root, 'SHA256SUMS'), listed.map(file => `${createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex')}  ${file}`).join('\n') + '\n');
console.log(JSON.stringify({ kind: 'aidt-acceptance-bundle', controlSource: sha, fileCount: listed.length, playwrightVersion: playwright }));
