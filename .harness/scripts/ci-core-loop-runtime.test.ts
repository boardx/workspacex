import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { assertRuntimeCommand, runtimeArgs } from './ci-fullstack-runtime.mjs';

const inputs = {
  root: '/runner/repo', home: '/runner/temp/home', tools: '/runner/temp/tools', uid: 1001, gid: 127, socketGid: 999,
  image: `mcr.microsoft.com/playwright@sha256:${'a'.repeat(64)}`, node: '/opt/node', pnpm: '/opt/pnpm',
  docker: '/usr/bin/docker', compose: '/opt/compose', unzip: '/usr/bin/unzip', coreLoop: true,
  env: { CI: 'true', GITHUB_SHA: 'a'.repeat(40), GH_TOKEN: 'private-admin-token', WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN: 'unused-import-token' },
};
describe('complete core-loop gate in the sealed browser runtime', () => {
  it('accepts the exact original isolated core-loop command and refuses altered coverage', () => {
    expect(() => assertRuntimeCommand('core-loop', ['--', 'pnpm', 'run', 'verify:core-loop'])).not.toThrow();
    for (const args of [['--', 'pnpm', 'run', 'verify:fullstack-smoke'], ['--', 'pnpm', 'run', 'verify:core-loop', '--grep', 'one']]) {
      expect(() => assertRuntimeCommand('core-loop', args)).toThrow();
    }
  });
  it('retains real Docker topology, browser readiness and APT blocking without import or runner credentials', () => {
    const command = runtimeArgs(inputs).join(' ');
    expect(command).toContain('exec pnpm run verify:core-loop');
    for (const token of ['--network host', '/var/run/docker.sock', 'PLAYWRIGHT_BROWSERS_PATH=/ms-playwright', 'ci-fullstack-runtime.mjs browser', '/usr/bin/apt-get:ro']) expect(command).toContain(token);
    for (const token of ['GH_TOKEN', 'private-admin-token', 'WORKSPACEX_SKILL_IMPORT_GITHUB_TOKEN', 'unused-import-token']) expect(command).not.toContain(token);
  });
  it('workflow preserves complete verification, failure propagation and evidence without a per-job browser install', () => {
    const w = parse(readFileSync(new URL('../../.github/workflows/backend-gates.yml', import.meta.url), 'utf8'));
    const job = w.jobs['e2e-core-loop'];
    expect(job['continue-on-error']).toBeUndefined();
    expect(job['timeout-minutes']).toBe(20);
    expect(job.steps.some((s: { run?: string }) => /playwright install/.test(s.run ?? ''))).toBe(false);
    const step = job.steps.find((s: { run?: string }) => s.run?.includes('ci-fullstack-runtime.mjs core-loop'));
    expect(step.run).toContain('node .harness/scripts/ci-fullstack-runtime.mjs core-loop -- pnpm run verify:core-loop 2>&1 | tee');
    expect(step.run).toContain('status=${PIPESTATUS[0]}');
    expect(step.run).toContain('exit "$status"');
    expect(job.steps.at(-1).if).toBe('always()');
    expect(job.steps.at(-1).with.path).toContain('apps/web/test-results/');
  });
});
