import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

for (const file of ['harness-verify', 'backend-gates']) {
  const workflow = parse(readFileSync(`.github/workflows/${file}.yml`, 'utf8'));
  describe(`${file} promotion boundary`, () => {
    it('executes policy from trusted base with a separate full candidate checkout', () => {
      const steps = workflow.jobs['promotion-evidence'].steps;
      expect(steps[0].with).toEqual({ path: 'candidate', 'fetch-depth': 0 });
      expect(steps[1].with.path).toBe('trusted');
      expect(steps[1].with.ref).toContain('pull_request.base.sha');
      expect(steps[2]['working-directory']).toBe('trusted');
      expect(steps[2].run).toContain('reuse=false');
    });
    it('required checks retain real evidence steps and reject missing source metadata', () => {
      const required = file === 'harness-verify'
        ? ['verify-control-plane', 'verify-affected', 'verify-full-compile'] : ['backend-required'];
      for (const name of required) {
        const job = workflow.jobs[name];
        expect(job.if ?? '').not.toContain("reuse != 'true'");
        const evidence = job.steps.find((s: { name?: string }) => s.name === 'Preserve verified develop promotion evidence');
        expect(evidence.run).toContain('test "$PROMOTION_RESULT" = success');
        expect(evidence.run).toContain('test -n "$PROMOTION_SOURCE"');
        expect(evidence.if).toContain("needs.promotion-evidence.outputs.reuse == 'true'");
      }
    });
  });
}

it('workflow event configuration has no job-only keys and every dependency exists', () => {
  const eventKeys: Record<string, string[]> = {
    pull_request: ['branches','branches-ignore','paths','paths-ignore','types'],
    merge_group: ['types','branches'], push: ['branches','branches-ignore','tags','tags-ignore','paths','paths-ignore'],
    workflow_dispatch: ['inputs'], schedule: [],
  };
  for (const file of ['harness-verify', 'backend-gates']) {
    const w = parse(readFileSync(`.github/workflows/${file}.yml`, 'utf8'));
    for (const [event, config] of Object.entries(w.on)) {
      expect(eventKeys[event]).toBeDefined();
      if (config && !Array.isArray(config)) for (const key of Object.keys(config)) expect(eventKeys[event]).toContain(key);
    }
    for (const job of Object.values(w.jobs) as any[]) {
      for (const dependency of typeof job.needs === 'string' ? [job.needs] : job.needs ?? []) expect(w.jobs[dependency]).toBeDefined();
      expect(Array.isArray(job.steps)).toBe(true);
    }
    const lookup=w.jobs['promotion-evidence'].steps.at(-1);
    expect(lookup.run).toContain('ci-promotion-lookup.mjs "$CANDIDATE_DIR"');
    expect(lookup.env.GITHUB_TOKEN).toBe('${{ github.token }}');
  }
});

it('push does not publish a skipped merge-gate required check', () => {
  const w=parse(readFileSync('.github/workflows/harness-verify.yml','utf8'));
  const job=w.jobs['merge-gate'];
  const expression=job.name.slice(3,-2);
  const name=(event_name:string)=>new Function('github',`return (${expression});`)({event_name});
  expect(name('push')).toBe('merge-gate-not-applicable');
  expect(name('pull_request')).toBe('merge-gate');
  expect(name('merge_group')).toBe('merge-gate');
  expect(job.if).toBe("github.event_name == 'pull_request' || github.event_name == 'merge_group'");
});

it('failed pure promotion admission runs and fails every required harness check', () => {
  const w=parse(readFileSync('.github/workflows/harness-verify.yml','utf8'));
  for (const name of ['verify-control-plane','verify-affected','verify-full-compile']) {
    const job=w.jobs[name];
    const condition=job.if.replaceAll('needs.promotion-evidence',"needs['promotion-evidence']");
    const needs={'promotion-evidence':{result:'failure',outputs:{reuse:'false'}}};
    const admitted=new Function('always','cancelled','github','needs',`return (${condition});`)(()=>true,()=>false,{event_name:'pull_request'},needs);
    expect(admitted).toBe(true);
    expect(job.steps[0]).toMatchObject({name:'Require promotion admission',env:{PROMOTION_RESULT:'${{ needs.promotion-evidence.result }}'}});
    const result=spawnSync('bash',['-c',job.steps[0].run],{env:{...process.env,PROMOTION_RESULT:'failure'}});
    expect(result.status).not.toBe(0);
    // Every heavy step uses implicit success() or an explicit result guard.
    for (const step of job.steps.slice(1)) {
      if (step.if?.includes('always()')) expect(step.if).toContain("needs.promotion-evidence.result == 'success'");
    }
  }
});
