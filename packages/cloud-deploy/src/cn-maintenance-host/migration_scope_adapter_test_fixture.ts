import {createHash} from 'node:crypto';
import {originalAuthorityFixture} from './source_plan_authority_test_fixture';
import {readOriginalPlanAuthority} from './source_plan_authority';
import {runtimeDigest} from './sealed_runtime';
const digest=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
export const id={sourceRevision:'5285bef9a6c91bbb9857ede42779aafa64b98f32',baselineRevision:'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0',migrationPlanSha256:'a'.repeat(64),attemptId:'migration-scope'};
const tool='b'.repeat(40),clock=Date.parse('2026-10-12T12:00:00Z');
export function fixture(change:(p:any)=>void=()=>{},selectedIdentity=id,selectedTool=tool){
 const id=selectedIdentity,tool=selectedTool;
 const f=originalAuthorityFixture(id,tool),path=`/etc/workspacex-cn/maintenance-host/${id.sourceRevision}/${id.attemptId}/migration-policy.json`;
 const images=Object.fromEntries(['api','web','agent','sandbox','postgres'].map(k=>[k,{image:'registry.test/'+k+'@sha256:'+'c'.repeat(64)}]));
 const manifest=Buffer.from(JSON.stringify({images}));
 const codeFiles={'packages/cloud-deploy/src/cn-maintenance-host/migration_scope_adapter.ts':'d'.repeat(64)};
 const target={accountId:'1177216024653153',regionId:'cn-shanghai',dbInstanceId:'pgm-exact',ecsInstanceId:'i-exact'};
 const policy:any={schemaVersion:1,scope:'cn-reviewed-additive-migration-v1',mode:'additive',identity:id,toolRevision:tool,
  preparedManifestSha256:digest(manifest),consumerInputsSha256:'e'.repeat(64),target:{...target},codeFiles:{...codeFiles},
  imageDigests:Object.fromEntries(Object.keys(images).map(k=>[k,'c'.repeat(64)])),issuedAt:'2026-10-12T11:59:00Z',expiresAt:'2026-10-12T12:20:00Z',
  conditions:{qualifiedCurrentEpoch:true,sameHoldGeneration:true,canonicalCompletionBeforeResume:true,noOldDumpAfterResume:true}};
 change(policy);let raw:Buffer=Buffer.from(JSON.stringify(policy));
 const source={...f.authority.sourcePlan,host:{instanceId:'i-exact'},releaseContinuation:{scope:'cn-reviewed-additive-migration-v1',policy:{path,sha256:digest(raw)}}};
 const sourceRaw=Buffer.from(JSON.stringify(source)+'\n');
 const host={...f.host,writerPlanSha256:digest(sourceRaw),writerPlanCanonicalSha256:runtimeDigest(source)};
 f.profile.originalWriterPlan.sha256=host.writerPlanSha256;
 const read=(p:string)=>p===path?raw:p===host.writerPlanPath?sourceRaw:Buffer.from(JSON.stringify(f.profile));
 const authority=readOriginalPlanAuthority(host,tool,f.profile,read);
 const inputs={preparedManifest:manifest,consumerInputsSha256:'e'.repeat(64),target,codeFiles};
 const epoch:any={schemaVersion:1,kind:'held-current-epoch-evidence',identity:id,toolRevision:tool,holdGeneration:'f'.repeat(32),epoch:{path:'/etc/workspacex-cn/epoch.json',sha256:'1'.repeat(64)}};
 return {authority,inputs,read,epoch,setRaw:(b:Buffer)=>{raw=b;},f};
}

export {clock,tool};
