import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
it('limits optional Skill browser workflow to source/dependency changes and preserves manual entry',()=>{
 const w=parse(readFileSync('.github/workflows/skill-files-e2e.yml','utf8'));
 const paths=['apps/**','packages/**','scripts/**','.harness/**','skills/**','.agents/**','patches/**','.github/workflows/skill-files-e2e.yml','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.nvmrc','.npmrc'];
 for(const event of ['pull_request','push'])expect(w.on[event].paths).toEqual(paths);
 expect(Object.hasOwn(w.on,'workflow_dispatch')).toBe(true);
 expect(w.jobs['skill-files-e2e'].steps.some((s:any)=>s.run?.includes('studio-skill-files-e2e.mjs'))).toBe(true);
});
