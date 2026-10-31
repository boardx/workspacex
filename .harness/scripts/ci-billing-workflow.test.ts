import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
it('routes billing candidate and PR coverage through a fail-closed scope without changing financial producer',()=>{
 const w=parse(readFileSync('.github/workflows/billing-cashier-glue.yml','utf8'));
 expect(Object.keys(w.on).sort()).toEqual(['merge_group','pull_request','workflow_dispatch']);
 for(const event of ['merge_group','pull_request'])expect(w.on[event]).toEqual({branches:['develop']});
 expect(w.permissions).toEqual({contents:'read'});
 expect(w.jobs.scope.outputs.changed).toBe('${{ steps.scope.outputs.changed }}');
 expect(w.jobs.scope.steps[0].with['fetch-depth']).toBe(0);
 expect(w.jobs.scope.steps.at(-1)).toMatchObject({run:'node .harness/scripts/ci-billing-scope.mjs',env:{CI_SCOPE_BASE_SHA:'${{ github.event.pull_request.base.sha || github.event.merge_group.base_sha }}'}});
 const job=w.jobs['billing-cashier-glue'];
 expect(job.needs).toBe('scope');expect(job.if).toBe("needs.scope.outputs.changed == 'true'");
 expect(job.steps.filter((s:any)=>s.run).map((s:any)=>s.run)).toEqual(['pnpm install --frozen-lockfile','pnpm --filter api exec playwright install --with-deps chromium','pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run --config vitest.billing-cashier.config.ts']);
 expect(job.steps.at(-1).if).toBe('always()');
});

import {billingAffected} from './ci-billing-scope.mjs';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
it('selects financial dependencies and writes real GitHub output',()=>{
 for(const path of ['apps/api/src/application/billing/a.ts','apps/api/migrations/001-billing.sql','apps/web/app/billing/page.tsx','packages/contracts/src/billing.ts','package.json'])expect(billingAffected([path])).toBe(true);
 for(const path of ['docs/a.md','apps/api/migrations/other.sql','apps/web/lib/api-clientXts'])expect(billingAffected([path])).toBe(false);
 const dir=mkdtempSync(join(tmpdir(),'billing-scope-'));
 try{const output=join(dir,'output');execFileSync(process.execPath,['.harness/scripts/ci-billing-scope.mjs'],{env:{...process.env,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_OUTPUT:output}});expect(readFileSync(output,'utf8')).toBe('changed=true\n');}finally{rmSync(dir,{recursive:true,force:true});}
});
