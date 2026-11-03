import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
const {parse}=require('yaml');
const original=parse(execFileSync('git',['show','c49fee15b89f2621d8ceaa582ef6a9c0f6c931cc:.github/workflows/backend-gates.yml'],{encoding:'utf8'}));
const current=parse(readFileSync('.github/workflows/backend-gates.yml','utf8'));
for (const job of ['gates-runtime','gates-test']) {
 const checkout=current.jobs[job].steps.find(step=>step.uses?.startsWith('actions/checkout@'));
 assert.deepEqual(checkout.with,{'fetch-depth':1,'fetch-tags':false});
 assert.equal(checkout.with.ref,undefined);
 checkout.with={'fetch-depth':0};
}
assert.deepEqual(current,original);
console.log('PASS: only runtime and API test shard checkout depth/tags changed; exact ref selection, other jobs, required dependencies, timeout, environment, tests and cleanup unchanged.');
