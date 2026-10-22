import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { evaluateIf, triggerAdmits } from './lib/ci-job-conditions.mjs';
import { changedPaths } from './ci-change-scope.mjs';

const root = resolve(import.meta.dirname, '../..');
const workflow = (name: string) => parse(readFileSync(resolve(root, `.github/workflows/${name}.yml`), 'utf8'));
const probe = (eventName: string, branch: string) => ({
  id: `${eventName}-${branch}`, eventName, ref: `refs/heads/${branch}`,
  baseBranch: branch, label: branch,
});

describe('develop integration routing preserves trusted deployment boundaries', () => {
  it.each(['harness-verify', 'backend-gates', 'board-acceptance', 'skill-files-e2e'])(
    '%s verifies pushes to develop and retains legacy main validation', name => {
      for (const branch of ['develop', 'main']) {
        expect(workflow(name).on.push.branches).toContain(branch);
      }
    },
  );

  it('requires DCO for develop and both production synchronization PRs', () => {
    for (const branch of ['develop', 'main', 'main-cn', 'main-us']) {
      expect(triggerAdmits(workflow('dco').on, probe('pull_request', branch)).admits).toBe(true);
    }
  });

  it('uses the exact develop push diff and refuses missing or unreadable bases', () => {
    const input = { event: 'push', ref: 'refs/heads/develop', base: 'a'.repeat(40) };
    const git = (args: string[]) => args[0] === 'diff' ? 'apps/web/lib/whiteboard-outbox.ts\0' : '';
    expect(changedPaths({ ...input, git })).toEqual(['apps/web/lib/whiteboard-outbox.ts']);
    expect(() => changedPaths({ ...input, base: '', git })).toThrow('base SHA');
    expect(() => changedPaths({ ...input, git: () => { throw new Error('missing object'); } })).toThrow('missing object');
  });

  it('only develop can automatically enter the Devapp writer', () => {
    const deploy = workflow('backend-gates').jobs.deploy;
    const needsResults = new Map(deploy.needs.map((name: string) => [name, 'success']));
    // The scope output is unknown in this evaluator. The positive equality to true
    // prevents unknown from authorizing a skip; automatic admission stays explicit.
    const condition = deploy.if.replace(/needs\.gates-fast\.outputs\.skip_devapp == 'true'/g, 'false');
    expect(evaluateIf(condition, probe('push', 'develop'), { needsResults })).toBe(true);
    for (const branch of ['main', 'main-cn', 'main-us', 'feature/untrusted']) {
      expect(evaluateIf(condition, probe('push', branch), { needsResults })).toBe(false);
    }
    for (const event of ['pull_request', 'merge_group']) {
      expect(evaluateIf(condition, probe(event, 'develop'), { needsResults })).toBe(false);
    }
    expect(deploy.concurrency['cancel-in-progress']).toBe(false);
  });
});
