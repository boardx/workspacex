import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
const w=parse(readFileSync('.github/workflows/harness-verify.yml','utf8'));
it('runs actual inexpensive control-plane boundaries on every PR/fork/cumulative candidate without whole-harness tests',()=>{
 const j=w.jobs['verify-control-plane'];expect(j.if).toBeUndefined();expect(j.needs).toBeUndefined();expect(j['continue-on-error']).toBeUndefined();
 const commands=j.steps.map((s:any)=>s.run??'').join('\n');expect(commands).toContain('lint:root-router');expect(commands).toContain('lint:oss-secret-scan');expect(commands).toContain('ci-lightweight-graph.mjs');expect(commands).not.toMatch(/vitest run|verify:harness|Docker/);
});
it('keeps complete canonical harness self-tests in hourly/manual base producer',()=>{
 const full=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));
 expect(full.on.schedule).toEqual([{cron:'17 * * * *'}]);expect(JSON.stringify(full.jobs['base-control-plane'])).toContain('pnpm run verify:harness:raw');expect(full.jobs['base-control-plane'].needs).toContain('freeze-source');
});
