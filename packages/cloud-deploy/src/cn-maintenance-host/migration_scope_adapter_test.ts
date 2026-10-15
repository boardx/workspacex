import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {originalAuthorityFixture} from './source_plan_authority_test_fixture';
import {readOriginalPlanAuthority} from './source_plan_authority';
import {runtimeDigest} from './sealed_runtime';
import {optionalMigrationScopeAdmission,checkMigrationScopeAdmission} from './migration_scope_adapter';
import {fixture,id,tool,clock} from './migration_scope_adapter_test_fixture';
test('real OriginalPlanAuthority and exact policy admit same epoch, not a new DDL capability',()=>{
 const f=fixture(),guard=optionalMigrationScopeAdmission(f.authority,f.inputs,f.read,()=>clock)!;
 checkMigrationScopeAdmission(guard,'before-ddl',f.epoch);checkMigrationScopeAdmission(guard,'before-resume',f.epoch);
 assert.throws(()=>checkMigrationScopeAdmission(guard,'before-ddl',f.epoch),/REENTRY/);
});
test('serialized authority and serialized guard cannot mint capability',()=>{
 const f=fixture();assert.throws(()=>optionalMigrationScopeAdmission(JSON.parse(JSON.stringify(f.authority)),f.inputs,f.read,()=>clock),/AUTHORITY_REQUIRED/);
 const guard=optionalMigrationScopeAdmission(f.authority,f.inputs,f.read,()=>clock)!;
 assert.throws(()=>checkMigrationScopeAdmission(JSON.parse(JSON.stringify(guard)),'before-ddl',f.epoch),/CAPABILITY_REQUIRED/);
});
for(const key of ['target','identity','imageDigests','codeFiles','consumerInputsSha256','preparedManifestSha256','mode','scope'] as const)test('independently pinned wrong policy rejects '+key,()=>{
 const f=fixture(p=>{if(key==='target')p.target.dbInstanceId='pgm-other';else if(key==='identity')p.identity={...id,baselineRevision:'2'.repeat(40)};else if(key==='imageDigests')p.imageDigests.api='2'.repeat(64);else if(key==='codeFiles')p.codeFiles={};else if(key==='mode')p.mode='hotfix';else if(key==='scope')p.scope='runtime-only-reviewed-continuation';else p[key]='2'.repeat(64);});
 assert.throws(()=>optionalMigrationScopeAdmission(f.authority,f.inputs,f.read,()=>clock));
});
test('policy revocation and expiry rechecked before resume',()=>{
 const f=fixture();let now=clock;const guard=optionalMigrationScopeAdmission(f.authority,f.inputs,f.read,()=>now)!;
 checkMigrationScopeAdmission(guard,'before-ddl',f.epoch);now+=3600000;
 assert.throws(()=>checkMigrationScopeAdmission(guard,'before-resume',f.epoch),/EXPIRED/);now=clock;f.setRaw(Buffer.from('{}'));
 assert.throws(()=>checkMigrationScopeAdmission(guard,'before-resume',f.epoch),/POLICY_CHANGED/);
});
test('generation and epoch change cannot resume and resume cannot precede DDL admission',()=>{
 const f=fixture(),guard=optionalMigrationScopeAdmission(f.authority,f.inputs,f.read,()=>clock)!;
 assert.throws(()=>checkMigrationScopeAdmission(guard,'before-resume',f.epoch),/EPOCH_DRIFT/);
 checkMigrationScopeAdmission(guard,'before-ddl',f.epoch);
 assert.throws(()=>checkMigrationScopeAdmission(guard,'before-resume',{...f.epoch,holdGeneration:'2'.repeat(32)}),/EPOCH_DRIFT/);
});
test('historical original authority has no new optional guard; does not gain new scope',()=>{
 const f=fixture(),old=originalAuthorityFixture(id,tool);
 assert.equal(optionalMigrationScopeAdmission(old.authority,f.inputs,f.read,()=>clock),undefined);
});
