import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORKBENCH_REPOSITORIES, checkWorkbenchRepository as check } from '../lib/workbench-repository-boundary.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
for(const path of WORKBENCH_REPOSITORIES){
 const source=read(path);
 test(path+' baseline',()=>assert.deepEqual(check(path,source,read),[]));
 test(path+' rejects removing tenant predicates',()=>assert.ok(check(path,source.replaceAll('org_id=$1','org_id=$9'),read).length));
 test(path+' rejects new table',()=>assert.ok(check(path,source+"\ns.query('SELECT * FROM secrets WHERE org_id=$1', [orgId]);",read).length));
}
const cases=[
 ['agent-run/pg-parent-run-control.ts','FOR UPDATE OF r'],
 ['agent-run/pg-parent-run-control.ts','toolArgumentsDigest(input.toolArgs) !== expected'],
 ['agent-run/pg-run-recovery.ts','await withRunLease('],
 ['artifacts-steering/accept-message-artifact-run-launcher.ts','await acceptHumanMessage('],
 ['artifacts-steering/pg-artifact-continuation-reader.ts','v.version=c.based_on_version'],
 ['artifacts-steering/register-run-artifacts.ts','if (!attachment) throw'],
];
for(const [file,guard] of cases){const p='src/infrastructure/'+file;test('reject removed '+guard,()=>assert.ok(check(p,read(p).replace(guard,'REMOVED'),read).length));}
test('reject missing controller authorization',()=>{
 const p='src/infrastructure/agent-run/pg-interjection-store.ts';
 assert.ok(check(p,read(p),f=>read(f).replace('await this.run(principal,runId);','')).length);
});
