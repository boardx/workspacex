import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
const env = { ...process.env, CI: 'true', WORKSPACEX_API_PORT: '18001', WORKSPACEX_WEB_PORT: '18002', WORKSPACEX_MODEL_PROVIDER_PORT: '18003', WORKSPACEX_DEEP_AGENT_PROVIDER_PORT: '18004', WORKSPACEX_LOOPBACK_SANDBOX_PORT: '18005', WORKSPACEX_ASR_PROVIDER_PORT: '18006', WORKSPACEX_MAIL_PROVIDER_PORT: '18007', PGPORT: '18008', COMPOSE_PROJECT_NAME: 'wsx-discovery-only', WORKSPACEX_DB: 'wsx_discovery_only' };
function discover(partition: string, project: string) {
  const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.fullstack-smoke.config.ts', `--project=${project}`, '--list', '--reporter=json'], { cwd: resolve('apps/web'), env: { ...env, FULLSTACK_SMOKE_PARTITION: partition }, encoding: 'utf8', timeout: 40000, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const report = JSON.parse(result.stdout), ids: string[] = [];
  function walk(suite: any, parents: string[] = []) {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) ids.push(JSON.stringify([test.projectName, spec.file, spec.line, [...parents, suite.title, spec.title]]));
    for (const child of suite.suites ?? []) walk(child, [...parents, suite.title]);
  }
  for (const suite of report.suites) walk(suite);
  if (!ids.length) throw new Error('EMPTY_DISCOVERY');
  return ids;
}
describe('actual installed Playwright discovery preserves the complete smoke suite', () => {
  it('product and board form a disjoint exact union of the original test identities', () => {
    const full = discover('', 'seeded-github-import');
    const product = discover('product', 'seeded-github-import');
    const board = discover('board', 'board-unified-mobile');
    expect(new Set([...product, ...board]).size).toBe(product.length + board.length);
    expect([...product, ...board].sort()).toEqual(full.sort());
    expect(product.length).toBeGreaterThan(0);
    expect(board.length).toBeGreaterThan(0);
  }, 120000);
});
