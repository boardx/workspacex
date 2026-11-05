/** No builder import/execution, Playwright discovery, server, database or browser. */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { chatProductionInvocations, chatProductionTransparent } from './lib/chat-production-gate.mjs';
import { resolveInvokedConfigs, classifySpecs } from './lint-spec-gate-coverage.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const builder = 'apps/web/e2e/support/chat-refresh-production-build.ts';
const helper = 'apps/web/e2e/support/chat-refresh-owned-process.cjs';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(command: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'chat-production-gate-')); roots.push(root);
  for (const file of [builder, helper]) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), readFileSync(path.join(repo, file)));
  }
  writeFileSync(path.join(root, 'apps/web/package.json'), '{"name":"web"}');
  writeFileSync(path.join(root, 'apps/web/playwright.chat-read.config.ts'), 'export default {};');
  mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  writeFileSync(path.join(root, '.github/workflows/chat.yml'), `on: pull_request\njobs:\n  chat-test-shards:\n    strategy:\n      matrix:\n        shard: [1, 2]\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          ${command}\n`);
  return root;
}
const args = '--config playwright.chat-read.config.ts --project=chat-read --max-failures=1 --shard=${{ matrix.shard }}/${{ needs.chat-test-plan.outputs.count }} --reporter=json';
const command = `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm exec tsx ${builder} ${args}`;
function verdict(root: string) {
  const victim = 'apps/web/e2e/agent-chat-core-paths.spec.ts';
  const covered = resolveInvokedConfigs(root).filter(c => c.configPath === 'apps/web/playwright.chat-read.config.ts');
  return classifySpecs({ population: [victim], coveredBy: new Map([[victim, covered]]), exemptions: [] }).rows[0].verdict;
}

describe('owned production chat gate', () => {
  it('discovers the real standard workflow with exactly the original config/project and complete matrix argv', () => {
    const workflow = readFileSync(path.join(repo, '.github/workflows/harness-acceptance.yml'), 'utf8');
    const start = workflow.indexOf('\n  chat-test-shards:') + 1;
    const block = workflow.slice(start).split(/\n  [a-z][\w-]*:/)[0];
    const actual = block.split('\n').find(line => line.includes(`pnpm exec tsx ${builder}`))!.trim();
    expect(actual).toContain(args);
    expect(actual).not.toContain('--grep');
    const root = fixture(actual);
    expect(chatProductionTransparent(root)).toBe(true);
    expect(chatProductionInvocations(actual, root)).toEqual([`pnpm --filter web exec playwright test ${args}`]);
    expect(verdict(root)).toBe('covered');
    const viaBuilder = resolveInvokedConfigs(root);
    writeFileSync(path.join(root, '.github/workflows/chat.yml'), `on: pull_request\njobs:\n  chat-test-shards:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm --filter web exec playwright test ${args}\n`);
    expect(viaBuilder).toEqual(resolveInvokedConfigs(root));
    expect(viaBuilder).toEqual([expect.objectContaining({ pkgDir: 'apps/web', configPath: 'apps/web/playwright.chat-read.config.ts', projects: ['chat-read'], unconditional: true })]);
    expect(verdict(root)).toBe('covered');
  });

  it.each([
    command.replace(builder, 'apps/web/e2e/support/not-the-builder.ts'),
    `${command} --grep 'only two cases'`,
    `${command} --grep-invert=other`,
    `${command} e2e/agent-chat-core-paths.spec.ts`,
    `${command} --unknown-selector=one`,
  ])('does not credit a wrong entry or restricted selection: %s', changed => {
    expect(verdict(fixture(changed))).toBe('unrun');
  });

  it.each([
    [builder, 'process.argv.slice(2)', "['--grep', 'only two cases']"],
    [builder, "'test',...playwrightArgs", "'test','--grep','hidden',...playwrightArgs"],
    [builder, "{cwd:web,env:{...process.env},directory,scope,purpose:'scenarios'", "{cwd:'/tmp',env:{...process.env},directory,scope,purpose:'scenarios'"],
    [builder, "require('./chat-refresh-owned-process.cjs')", "require('./another-helper.cjs')"],
    [helper, 'return [...argv]', "return [...argv,'--grep','hidden']"],
    [helper, 'spawn(command,args,', "spawn(command,[...args,'--grep','hidden'],"],
  ])('rejects a broken transparent execution edge in %s', (file, before, after) => {
    const root = fixture(command), target = path.join(root, file);
    const original = readFileSync(target, 'utf8'); expect(original).toContain(before);
    writeFileSync(target, original.replace(before, after));
    expect(chatProductionTransparent(root)).toBe(false);
    expect(verdict(root)).toBe('unrun');
  });
});
