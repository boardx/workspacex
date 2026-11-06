import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {staticScripts,runStatic} from './ci-harness-static.mjs';
import {evaluateIf} from './lib/ci-job-conditions.mjs';
const terminal='pnpm exec vitest run --config .harness/vitest.config.ts --dir .harness';
it('preserves every canonical static command and excludes only the separate test producer',()=>{
 const raw=JSON.parse(readFileSync('package.json','utf8')).scripts['verify:harness:raw'];
 expect(staticScripts(raw).map(s=>`pnpm run ${s}`).join(' && ')+' && '+raw.split(' && ').at(-1)).toBe(raw);
 const calls:string[]=[];runStatic(raw,(command,args)=>calls.push([command,...args].join(' ')));
 expect(calls).toEqual(raw.split(' && ').slice(0,-1));
 expect(staticScripts('pnpm run lint:a && '+terminal+' --bail=1')).toEqual(['lint:a']);
});
it('fails closed on missing test suffix, unknown shell grammar and unsuccessful commands',()=>{
 for(const raw of ['',terminal,'pnpm run lint:a && pnpm exec vitest run','echo skip && '+terminal,'pnpm run lint:a; true && '+terminal])expect(()=>staticScripts(raw)).toThrow();
 expect(()=>runStatic('pnpm run lint:a && '+terminal,()=>{throw Error('lint failed')})).toThrow('lint failed');
});

it('full and uncertain routes retain the complete canonical self-test selector; only proven UI can omit it',()=>{
 const raw=JSON.parse(readFileSync('package.json','utf8')).scripts['verify:harness:raw'];
 const normalize=(command:string)=>command.replace(' --config .harness/vitest.config.ts','').replace(' --bail=1','').trim();
 const canonical=normalize(raw.split(' && ').at(-1));
 const job=parse(readFileSync('.github/workflows/harness-verify.yml','utf8')).jobs['verify-control-plane'];
 const producers=job.steps.filter((step:any)=>typeof step.run==='string'&&normalize(step.run)===canonical);
 expect(producers).toHaveLength(1);
 expect(job.needs).toContain('doc-smoke-scope');
 expect(producers[0].if).toBe("needs.doc-smoke-scope.outputs.mode != 'targeted-ui'");
 for(const eventName of ['pull_request','merge_group'])for(const mode of [undefined,'','full','unknown','candidate-ui','targeted-ui']){
  const probe={eventName,ref:'refs/heads/develop',baseBranch:'develop',regressionMode:mode};
  expect(evaluateIf(producers[0].if,probe,{needsResults:new Map([['doc-smoke-scope','success']])})).toBe(mode!=='targeted-ui');
 }
 // GitHub's implicit dependency-success requirement must not be overridden.
 // evaluateIf is a successful-run reachability probe, not a failure simulator.
 expect(job.if).not.toMatch(/\b(?:always|failure|cancelled|success)\s*\(/);
 expect(job['continue-on-error']).toBeUndefined();
});
