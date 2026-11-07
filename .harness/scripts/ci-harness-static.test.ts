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

it('moves complete self-tests to hourly/manual while merge control-plane owns the resource guard',()=>{
 const merge=parse(readFileSync('.github/workflows/harness-verify.yml','utf8')).jobs['verify-control-plane'];
 expect(JSON.stringify(merge)).not.toContain('vitest run');expect(JSON.stringify(merge)).toContain('ci-lightweight-graph.mjs');
 const full=parse(readFileSync('.github/workflows/harness-acceptance.yml','utf8'));expect(full.on.merge_group).toBeUndefined();expect(JSON.stringify(full.jobs['base-control-plane'])).toContain('pnpm run verify:harness:raw');
});
