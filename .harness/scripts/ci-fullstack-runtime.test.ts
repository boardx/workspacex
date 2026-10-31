import { describe, expect, it } from 'vitest';
import { readFileSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertRuntimeCommand, pnpmPackageRoot, sealedImage, runtimeArgs } from './ci-fullstack-runtime.mjs';

const catalog = JSON.parse(readFileSync(new URL('../playwright-runtime-images.json', import.meta.url), 'utf8'));
const inputs = { root: '/runner/work/repo', home: '/runner/temp/home', tools: '/runner/temp/tools',
  uid: 1001, gid: 127, socketGid: 999, image: `mcr.microsoft.com/playwright@sha256:${'a'.repeat(64)}`,
  node: '/opt/node/bin/node', pnpm: '/opt/pnpm', docker: '/usr/bin/docker', compose: '/opt/docker-compose', unzip: '/usr/bin/unzip',
  env: { CI: 'true', GITHUB_SHA: 'abc', GH_TOKEN: 'must-not-enter', GITHUB_TOKEN: 'must-not-enter' } };

describe('preinstalled fullstack CI runtime', () => {
  it('derives exact image from installed version and rejects floating/unsupported versions', () => {
    expect(sealedImage('1.62.0', catalog)).toMatch(/^mcr.microsoft.com\/playwright@sha256:[a-f0-9]{64}$/);
    expect(() => sealedImage('1.64.0', catalog)).toThrow('NOT_REVIEWED');
    for (const version of ['latest', '^1.62.0', '1.63.0-alpha', '1.62.0; echo bad']) expect(() => sealedImage(version, catalog)).toThrow();
  });
  it('resolves action-setup regular .bin wrapper to actual package, not node_modules', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsx-pnpm-action-'));
    try { mkdirSync(join(root, 'node_modules/.bin'), { recursive: true });
      mkdirSync(join(root, 'node_modules/pnpm/bin'), { recursive: true });
      writeFileSync(join(root, 'node_modules/pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '9.15.0', exports: { '.': './dist/pnpm.cjs' } }));
      writeFileSync(join(root, 'node_modules/.bin/pnpm'), '#!/bin/sh\n');
      writeFileSync(join(root, 'node_modules/pnpm/bin/pnpm.cjs'), '');
      expect(pnpmPackageRoot(join(root, 'node_modules/.bin/pnpm'))).toBe(realpathSync(join(root, 'node_modules/pnpm')));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('requires sealed digest and real numeric runner identity', () => {
    expect(() => runtimeArgs({ ...inputs, image: 'mcr.microsoft.com/playwright:v1.62.0-noble' })).toThrow('UNSEALED');
    expect(() => runtimeArgs({ ...inputs, uid: -1 })).toThrow('IDENTITY');
  });
  it('preserves loopback host network, native Docker topology, UID, browser and APT blocking', () => {
    const args = runtimeArgs(inputs).join(' ');
    for (const token of ['--network host', '--ipc host', '--user 1001:127', '--group-add 999', '/var/run/docker.sock',
      '/opt/docker-compose:/runner/temp/home/.docker/cli-plugins/docker-compose:ro',
      '/runner/work/repo:/runner/work/repo', '/ms-playwright', '/usr/bin/unzip:/wsx-ci-tools/bin/unzip:ro', '/usr/bin/apt-get:ro',
      'docker compose version', 'ci-fullstack-runtime.mjs browser', 'exec pnpm run verify:fullstack-smoke']) expect(args).toContain(token);
    expect(args).not.toContain('must-not-enter');
    expect(args).not.toContain('GITHUB_TOKEN');
    expect(args).toContain('DOCKER_CONFIG=/runner/temp/home/.docker');
    expect(args).not.toContain('DOCKER_CONFIG=/wsx-ci-tools');
  });
  it('passes only the optional public import credential by name, never its value or other tokens', () => {
    const key = 'WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN';
    const env = { ...inputs.env, [key]: 'FAKE', ADMIN_TOKEN: 'ADMIN' };
    const args = runtimeArgs({ ...inputs, env });
    expect(args).toContain(key);
    expect(args.join(' ')).not.toContain('FAKE');
    expect(args.join(' ')).not.toContain('ADMIN');
    expect(args.join(' ')).not.toContain('must-not-enter');
    expect(runtimeArgs(inputs)).not.toContain(key);
    expect(runtimeArgs({ ...inputs, env: { ...env, [key]: '' } })).not.toContain(key);
    expect(runtimeArgs({ ...inputs, env, geometry: true })).not.toContain(key);
  });
  it('requires the workflow explicit canonical command and refuses partial or altered coverage', () => {
    expect(() => assertRuntimeCommand('run', ['--', 'pnpm', 'run', 'verify:fullstack-smoke'])).not.toThrow();
    expect(() => assertRuntimeCommand('geometry', ['--', 'pnpm', '--filter', 'web', 'run', 'e2e:trace-geometry', '--max-failures=1'])).not.toThrow();
    expect(() => assertRuntimeCommand('geometry', ['--', 'pnpm', 'run', 'verify:fullstack-smoke'])).toThrow();
    expect(() => assertRuntimeCommand('run', ['--', 'pnpm', 'run', 'verify:fullstack-smoke', '--grep', 'one'])).toThrow();
  });
  it('runs existing independent geometry with the same prepared browser environment', () => {
    const args = runtimeArgs({ ...inputs, geometry: true }).join(' ');
    expect(args).toContain('exec pnpm --filter web run e2e:trace-geometry');
    expect(args).not.toContain('exec pnpm run verify:fullstack-smoke');
  });
  it('runs complete sticky coverage in the sealed browser environment without import credentials', () => {
    const command = ['--', 'pnpm', '--filter', 'web', 'exec', 'playwright', 'test', '--config', 'playwright.chat-sticky-browser.config.ts', '--max-failures=1'];
    expect(() => assertRuntimeCommand('sticky', command)).not.toThrow();
    expect(() => assertRuntimeCommand('sticky', [...command, '--grep', 'one'])).toThrow();
    expect(() => assertRuntimeCommand('sticky', ['--', 'pnpm', 'run', 'verify:fullstack-smoke'])).toThrow();
    const args = runtimeArgs({ ...inputs, sticky: true, env: { ...inputs.env, WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: 'FAKE' } }).join(' ');
    expect(args).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(args).toContain('ci-fullstack-runtime.mjs browser');
    expect(args).toContain('exec ' + command.slice(1).join(' '));
    expect(args).not.toContain('WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN');
    expect(args).not.toContain('must-not-enter');
  });
  it('runs directory acceptance in the sealed browser runtime without import credentials', () => {
    const key = 'WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN';
    const args = runtimeArgs({ ...inputs, directory: true, env: { ...inputs.env, [key]: 'FAKE' } });
    expect(args.join(' ')).toContain('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright');
    expect(args.join(' ')).toContain('exec pnpm run verify:digital-directory-cards');
    expect(args).not.toContain(key);
    expect(() => assertRuntimeCommand('directory', ['--', 'pnpm', 'run', 'verify:digital-directory-cards'])).not.toThrow();
    expect(() => assertRuntimeCommand('directory', ['--', 'pnpm', 'run', 'verify:fullstack-smoke'])).toThrow();
    expect(() => assertRuntimeCommand('directory', ['--', 'pnpm', 'run', 'verify:digital-directory-cards', '--grep', 'one'])).toThrow();
    const workflow = readFileSync(new URL('../../.github/workflows/harness-verify.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('ci-fullstack-runtime.mjs directory -- pnpm run verify:digital-directory-cards');
  });
  it('retains full commands and evidence within a bounded complete-run budget', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/harness-verify.yml', import.meta.url), 'utf8');
    const lane = workflow.slice(workflow.indexOf('  fullstack-smoke:'), workflow.indexOf('\n  full-regression-core:'));
    // The 222-case execution plus setup/evidence exhausted 40m (#5832).
    // Validate a bounded operational budget rather than duplicating its exact value.
    const budget = Number(lane.match(/^    timeout-minutes:\s*(\d+)\s*$/m)?.[1]);
    expect(budget).toBeGreaterThanOrEqual(30);
    expect(budget).toBeLessThanOrEqual(50);
    expect(lane).toContain('persist-credentials: false');
    expect(lane).toContain('GH_TOKEN: ${{ github.token }}');
    expect(lane).toContain('WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: ${{ secrets.WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN }}');
    expect(lane).not.toContain('WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: ${{ github.token }}');
    expect(lane).toContain('node .harness/scripts/ci-fullstack-runtime.mjs product');
    expect(lane).toContain('node .harness/scripts/ci-fullstack-runtime.mjs geometry');
    expect(lane).not.toContain('playwright install');
    expect(lane).toContain('status=${PIPESTATUS[0]}');
    expect(lane).toContain('Upload runtime evidence (success or failure)');
    expect(lane).toContain('Preserve reused verification verdict');
  });
});

it('accepts actual sticky and geometry workflow commands with first-failure limits',()=>{
 for(const file of ['harness-verify','harness-acceptance']){
  const source=readFileSync(`.github/workflows/${file}.yml`,'utf8');
  const commands=[...source.matchAll(/ci-fullstack-runtime\.mjs (sticky|geometry) (-- [^\n]+)/g)];
  expect(commands).toHaveLength(2);
  for(const [,mode,args] of commands)expect(()=>assertRuntimeCommand(mode,args.split(' 2>&1')[0].trim().split(/\s+/))).not.toThrow();
 }
});
