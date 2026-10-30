import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { assertRuntimeCommand } from './ci-fullstack-runtime.mjs';
const workflow = parse(readFileSync('.github/workflows/harness-verify.yml', 'utf8'));
describe('partition commands and isolated CI producers', () => {
  it('keeps local full smoke while CI selects two exact complementary commands', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    expect(scripts['verify:fullstack-smoke:raw']).not.toContain('PARTITION');
    for (const partition of ['product', 'board']) {
      expect(scripts[`verify:fullstack-${partition}:raw`]).toContain(`FULLSTACK_SMOKE_PARTITION=${partition}`);
      expect(() => assertRuntimeCommand(partition, ['--', 'pnpm', 'run', `verify:fullstack-${partition}`])).not.toThrow();
      expect(() => assertRuntimeCommand(partition, ['--', 'pnpm', 'run', 'verify:fullstack-smoke'])).toThrow();
    }
  });
  it('runs board in a separate hosted runner with its own actual verdict and evidence', () => {
    const board = workflow.jobs['board-smoke'];
    expect(board).toBeDefined();
    expect(board.needs).toEqual(['promotion-evidence', 'doc-smoke-scope']);
    expect(board.needs).not.toContain('fullstack-smoke');
    expect(board['runs-on']).toBe('ubuntu-latest');
    expect(workflow.jobs['e2e-full'].needs).toContain('board-smoke');
    expect(JSON.stringify(board)).toContain('ci-fullstack-runtime.mjs board -- pnpm run verify:fullstack-board');
    expect(JSON.stringify(workflow.jobs['fullstack-smoke'])).toContain('ci-fullstack-runtime.mjs product -- pnpm run verify:fullstack-product');
  });
});
