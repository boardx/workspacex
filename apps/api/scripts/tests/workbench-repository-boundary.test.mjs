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
 ['agent-run/pg-native-run-inputs.ts','m.author_kind=\'human\''],
 ['agent-run/pg-native-run-inputs.ts','a.thread_id=$2 AND a.message_id=$3 AND m.author_id=$4'],
 ['agent-run/pg-native-run-inputs.ts','limits.maxFiles+1'],
 ['agent-run/pg-native-run-inputs.ts',"if (decision.kind !== 'allow') throw"],
 ['agent-run/pg-parent-run-control.ts','FOR UPDATE OF r'],
 ['agent-run/pg-parent-run-control.ts','toolArgumentsDigest(input.toolArgs) !== expected'],
 ['agent-run/pg-run-recovery.ts','await withRunLease('],
 ['artifacts-steering/accept-message-artifact-run-launcher.ts','await acceptHumanMessage('],
 ['artifacts-steering/pg-artifact-continuation-reader.ts','v.version=c.based_on_version'],
 ['artifacts-steering/register-run-artifacts.ts','if (!attachment) throw'],
];
test('input bytes cannot precede parent authority',()=>{
 const p='src/infrastructure/agent-run/pg-native-run-inputs.ts';
 assert.ok(check(p,read(p),f=>read(f).replace('inputSet=await this.authorized(context','inputSet=await this.bypass(context')).length);
});
for(const [file,guard] of cases){const p='src/infrastructure/'+file;test('reject removed '+guard,()=>assert.ok(check(p,read(p).replace(guard,'REMOVED'),read).length));}
test('reject missing controller authorization',()=>{
 const p='src/infrastructure/agent-run/pg-interjection-store.ts';
 assert.ok(check(p,read(p),f=>read(f).replace('await this.run(principal,runId);','')).length);
});
const staging='src/infrastructure/agent-run/pg-native-output-staging.ts';
for(const [label,mutate] of [
 ['removed authority',s=>s.replace('this.authority.check','this.authority.skip')],
 ['fake denial guard',s=>s.replace('if(!decision.allowed)','if(false)')],
 ['forged tenant parameter',s=>s.replaceAll('[context.orgId,context.parentRunId','["other",context.parentRunId')],
 ['missing parent predicate',s=>s.replaceAll(' AND run_id=$2','')],
 ['wrong session binding',s=>s.replace('context.bindingId,context','context.modelBinding,context')],
 ['forged tool arguments',s=>s.replace('toolArgs:input','toolArgs:{}')],
 ['read before authority',s=>s.replace('const decision=await this.authority.check','await this.files(bound).read(input.workspacePath);const decision=await this.authority.check')],
 ['new unreviewed method',s=>s.replace('async listFiles(', 'async publicListFiles(')],
])test('staging rejects '+label,()=>assert.ok(check(staging,mutate(read(staging)),read).length));
test('staging rejects public exposure of internal listFiles',()=>{
 assert.ok(check(staging,read(staging),p=>p.endsWith('native-output-staging.controller.ts')?read(p)+'\nthis.staging.listFiles(orgId,runId);':read(p)).length);
});
test('staging rejects recovery without fence',()=>{
 assert.ok(check(staging,read(staging),p=>p.endsWith('pg-run-recovery.ts')?read(p).replace('await withRunLease(', 'await withoutFence('):read(p)).length);
});
