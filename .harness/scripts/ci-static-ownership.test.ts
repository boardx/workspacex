import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
const h=parse(readFileSync('.github/workflows/harness-verify.yml','utf8')),full=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));
it('requires full build before full typecheck/lint on PR/fork/queue without static duplication in affected units',()=>{
 const commands=h.jobs['verify-full-compile'].steps.map((s:any)=>s.run).filter(Boolean);expect(commands).toEqual(['pnpm install --frozen-lockfile','pnpm turbo run build','pnpm turbo run typecheck lint']);expect(h.jobs['verify-full-compile'].if).toBeUndefined();
 const units=JSON.stringify(h.jobs['verify-affected']);expect(units).toContain('ci-lightweight.mjs units');expect(units).not.toMatch(/run-affected-tests|turbo run typecheck lint/);
});
it('hourly/manual full compilation executes locally on its frozen source, never waits for candidate workflow proof',()=>{
 const base=full.jobs['base-compile'];expect(base.needs).toContain('freeze-source');
 const compile=base.steps.filter((s:any)=>s.run?.startsWith('pnpm turbo run'));expect(compile.map((s:any)=>s.run)).toEqual(['pnpm turbo run build','pnpm turbo run typecheck lint']);for(const step of compile)expect(step.if).toBeUndefined();expect(JSON.stringify(base)).not.toContain('ci-queue-ready');
});
