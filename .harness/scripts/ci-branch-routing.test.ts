import { readFileSync, readdirSync } from 'node:fs';
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
  it('limits all ordinary development PR triggers to develop', () => {
    for (const file of readdirSync(resolve(root, '.github/workflows')).filter(f => f.endsWith('.yml'))) {
      const w = workflow(file.replace(/\.yml$/, ''));
      if (!Object.hasOwn(w.on, 'pull_request')) continue;
      // Exact historical labeled operations are operational evidence, not code CI.
      if (['cn-exact-f0eb-preflight.yml', 'preserve-cn-f0eb-originals.yml'].includes(file)) continue;
      expect(w.on.pull_request?.branches, file).toEqual(['develop']);
    }
  });

  it('never runs automatic code CI on production synchronization branches or tags', () => {
    const deployment = new Set(['deploy-home.yml', 'deploy-devportal.yml', 'deploy-coord-gateway.yml']);
    for (const file of readdirSync(resolve(root, '.github/workflows')).filter(f => f.endsWith('.yml'))) {
      const w = workflow(file.replace(/\.yml$/, ''));
      if (!Object.hasOwn(w.on, 'push') || deployment.has(file)) continue;
      expect(w.on.push?.branches, file).toEqual(['develop']);
      expect(w.on.push?.tags, file).toBeUndefined();
      for (const branch of ['main', 'main-us', 'main-cn', 'worker/example'])
        expect(triggerAdmits(w.on, probe('push', branch)).admits, file + ':' + branch).toBe(false);
    }
  });

  it.each(['harness-verify','backend-gates'])('limits %s merge groups to develop', name => {
    expect(workflow(name).on.merge_group.branches).toEqual(['develop']);
  });

  it('keeps production deployment separate from development validation', () => {
    const gateway = workflow('deploy-coord-gateway');
    const admit = (expr: string, event: string, branch: string) => new Function('github', `return (${expr});`)({event_name:event,ref:`refs/heads/${branch}`});
    expect(gateway.jobs.validate.env).toBeUndefined();
    for (const event of ['push', 'pull_request']) expect(admit(gateway.jobs.validate.if,event,'develop')).toBe(true);
    expect(admit(gateway.jobs.validate.if,'push','main')).toBe(false);
    expect(admit(gateway.jobs.deploy.if,'push','main')).toBe(true);
    for (const branch of ['develop','main-us']) expect(admit(gateway.jobs.deploy.if,'push',branch)).toBe(false);
    expect(gateway.concurrency.group).toContain("github.ref == 'refs/heads/main'");
    expect(gateway.concurrency.group).toContain('coord-validation-');
    expect(gateway.concurrency['cancel-in-progress']).toBe(false);
    for (const [name, steps] of [
      ['deploy-home', ['Static gates','Deployment failure and rollback contracts','China package language and landing-page contracts']],
      ['deploy-devportal', ['Typecheck / lint / test','E2E (repeatable local gateway fixture)']],
    ] as const) {
      const w=workflow(name);
      expect(w.on.push.branches).toEqual(['main']);
      expect(w.jobs.deploy.if).toContain("github.ref == 'refs/heads/main'");
      for (const stepName of steps) expect(w.jobs.validate.steps.find((s: any)=>s.name===stepName).if).toBe("github.event_name == 'pull_request'");
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
    const release = workflow('image-release');
    expect(workflow('backend-gates').jobs.deploy).toBeUndefined();
    const admitted = (event: string, branch: string) => new Function('github', 'inputs', `return (${release.jobs.plan.if});`)(
      {event_name:event,ref:`refs/heads/${branch}`},{build_only:false});
    expect(admitted('push','develop')).toBe(true);
    for(const branch of ['main','main-cn','main-us','feature/untrusted']) expect(admitted('push',branch)).toBe(false);
    for(const event of ['pull_request','merge_group']) expect(admitted(event,'develop')).toBe(false);
    expect(release.jobs.deploy.concurrency['cancel-in-progress']).toBe(false);
  });
});
