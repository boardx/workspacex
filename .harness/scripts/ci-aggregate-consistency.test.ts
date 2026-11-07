import {readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {expect,it} from 'vitest';
import {aggregateFailures,CURRENT_POLICY} from './lib/ci-check-policy.mjs';
it('binds current lightweight aggregate to every real mandatory producer without silent gaps',()=>{
 const w=parse(readFileSync('.github/workflows/harness-verify.yml','utf8'));
 const members=CURRENT_POLICY.aggregates['queue-ready'];expect(w.jobs['queue-ready'].needs).toEqual(members);
 expect(members).toEqual(CURRENT_POLICY.requiredChecks.filter(n=>n!=='queue-ready'));
 const results=Object.fromEntries(members.map(name=>[name,{result:'success'}]));expect(aggregateFailures('queue-ready',results)).toEqual([]);
 for(const name of members)for(const result of ['failure','cancelled','skipped',undefined])expect(aggregateFailures('queue-ready',{...results,[name]:{result}})).toEqual([name]);
});
it('preserves actual heavy backend design and native gates in hourly full aggregation',()=>{
 const w=parse(readFileSync('.github/workflows/backend-gates.yml','utf8'));
 for(const name of ['e2e-core-loop','prototype-audit','design-loop-e2e','native-document-chain','native-runtime-lane','gates-test'])expect(w.jobs['backend-full-result'].needs).toContain(name);
 expect(w.on.pull_request).toBeUndefined();expect(w.on.merge_group).toBeUndefined();
});
