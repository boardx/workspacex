import test from 'node:test';import assert from 'node:assert/strict';
import {originalAuthorityFixture} from './source_plan_authority_test_fixture';
import {assertSourcePlanAuthority,readOriginalPlanAuthority} from './source_plan_authority';
const identity={sourceRevision:'a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'current-parent'},tool='b'.repeat(40);
test('actual pinned original bytes admit a1cb and keep raw/sourcecanonical separate',()=>{const f=originalAuthorityFixture(identity,tool);assertSourcePlanAuthority(f.authority,identity,tool);assert.notEqual(f.authority.sourcePlanSha256,f.authority.sourcePlanCanonicalSha256);assert.ok(Object.isFrozen(f.authority.sourcePlan));});
for(const mode of ['source','baseline','attempt','plan','tool','missing','fake','raw','profile'] as const)test('original authority rejects '+mode,()=>{
 const f=originalAuthorityFixture(identity,tool);let expected={...identity},revision=tool,authority:any=f.authority;
 if(mode==='source')expected.sourceRevision='c'.repeat(40);if(mode==='baseline')expected.baselineRevision='c'.repeat(40);if(mode==='attempt')expected.attemptId='child-uuid';if(mode==='plan')expected.migrationPlanSha256='c'.repeat(64);if(mode==='tool')revision='c'.repeat(40);if(mode==='missing')authority=undefined;if(mode==='fake')authority=JSON.parse(JSON.stringify(authority));if(mode==='raw')f.setRaw(Buffer.from('{}'));if(mode==='profile')f.profile.originalWriterPlan.sha256='c'.repeat(64);
 assert.throws(()=>assertSourcePlanAuthority(authority,expected,revision));
});
test('source plan ref cannot be selected by request or runtime seal',()=>{const f=originalAuthorityFixture(identity,tool);assert.throws(()=>readOriginalPlanAuthority({...f.host,writerPlanPath:'/etc/workspacex-cn/foreign.json'},tool,f.profile,()=>Buffer.from('{}')),/PROFILE_REF/);});
for(const field of ['mode','productionActionsAuthorized','runtimeSessionBootstrapAuthorized','runtimePlan','controlSessions'] as const)test('original plan schema rejects '+field+' before issuance',()=>{
 const f=originalAuthorityFixture(identity,tool),source:any={...f.authority.sourcePlan};
 source[field]=field==='mode'?'sealed-maintenance-writer-runtime':field.includes('Authorized')?false:{};
 assert.throws(()=>readOriginalPlanAuthority(f.host,tool,f.profile,()=>Buffer.from(JSON.stringify(source))),/ORIGINAL_PLAN_SCHEMA/);
});
test('original canonical cannot be replaced by raw or runtime digest',()=>{const f=originalAuthorityFixture(identity,tool);const reader=(path:string)=>path==='/etc/workspacex-cn/trusted-tool-binding.json'?Buffer.from(JSON.stringify(f.profile)):Buffer.from(JSON.stringify(f.authority.sourcePlan)+'\n');for(const canonical of [f.authority.sourcePlanSha256,'c'.repeat(64)])assert.throws(()=>readOriginalPlanAuthority({...f.host,writerPlanCanonicalSha256:canonical},tool,f.profile,reader),/CANONICAL_BINDING/);});
