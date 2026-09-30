import { describe, expect, it } from 'vitest';
import { readFileSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pnpmPackageRoot, sealedImage, runtimeArgs } from './ci-fullstack-runtime.mjs';

const catalog = JSON.parse(readFileSync(new URL('../playwright-runtime-images.json', import.meta.url), 'utf8'));
const inputs = { root: '/runner/work/repo', home: '/runner/temp/home', tools: '/runner/temp/tools',
  uid: 1001, gid: 127, socketGid: 999, image: `mcr.microsoft.com/playwright@sha256:${'a'.repeat(64)}`,
  node: '/opt/node/bin/node', pnpm: '/opt/pnpm', docker: '/usr/bin/docker', compose: '/opt/docker-compose',
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
      '/runner/work/repo:/runner/work/repo', '/ms-playwright', '/usr/bin/apt-get:ro',
      'docker compose version', 'ci-fullstack-runtime.mjs browser', 'exec pnpm run verify:fullstack-smoke']) expect(args).toContain(token);
    expect(args).not.toContain('must-not-enter');
    expect(args).not.toContain('GITHUB_TOKEN');
    expect(args).toContain('DOCKER_CONFIG=/runner/temp/home/.docker');
    expect(args).not.toContain('DOCKER_CONFIG=/wsx-ci-tools');
  });
  it('runs existing independent geometry with the same prepared browser environment', () => {
    const args = runtimeArgs({ ...inputs, geometry: true }).join(' ');
    expect(args).toContain('exec pnpm --filter web run e2e:trace-geometry');
    expect(args).not.toContain('exec pnpm run verify:fullstack-smoke');
  });
  it('changes only smoke setup, retains full commands, evidence and 20 minute limit', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/harness-verify.yml', import.meta.url), 'utf8');
    const lane = workflow.slice(workflow.indexOf('  fullstack-smoke:'), workflow.indexOf('  # #2084:'));
    expect(lane).toContain('timeout-minutes: 20');
    expect(lane).toContain('persist-credentials: false');
    expect(lane).toContain('GH_TOKEN: ${{ github.token }}');
    expect(lane).toContain('node .harness/scripts/ci-fullstack-runtime.mjs run');
    expect(lane).toContain('node .harness/scripts/ci-fullstack-runtime.mjs geometry');
    expect(lane).not.toContain('playwright install');
    expect(lane).toContain('status=${PIPESTATUS[0]}');
    expect(lane).toContain('Upload runtime evidence (success or failure)');
    expect(lane).toContain('Preserve reused verification verdict');
  });
});
