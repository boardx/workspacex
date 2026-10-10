import test from 'node:test';
import assert from 'node:assert/strict';
import {readApprovedCompletionRelease,readNativeCompletion} from './native_completion';
import {authorityWithRelease,newReleaseIdentity} from './native_completion_test_fixture';
import {originalAuthorityFixture} from './source_plan_authority_test_fixture';
function witness(identity=newReleaseIdentity,release='2026.10.10-cn.1'){
 const now=Date.now(),hash='c'.repeat(64);
 return {schemaVersion:1,scope:'validated-production-migration-completion',...identity,release,originalPlanSha256:identity.migrationPlanSha256,migrationPlanSha256:undefined,completionPlanSha256:hash,sourceInventorySha256:hash,sourceBindingSha256:hash,snapshotSha256:hash,fullResponseSha256:hash,ledgerSha256:hash,appliedSqlCount:1,pendingCount:0,driftCount:0,unknownAppliedCount:0,capturedAt:new Date(now).toISOString(),providerFinishedAt:new Date(now).toISOString(),expiresAt:new Date(now+3500000).toISOString(),productionMutationAuthorized:false};
}
function receipt(identity=newReleaseIdentity,release='2026.10.10-cn.1'){const v=witness(identity,release);delete (v as any).migrationPlanSha256;return v;}
test('new pair requires independent expected release, rejects receipt self assertion and cross pairs',()=>{
 const value=receipt();assert.throws(()=>readNativeCompletion(value,newReleaseIdentity),/RELEASE_AUTHORITY/);
 assert.equal(readNativeCompletion(value,newReleaseIdentity,Date.now(),'2026.10.10-cn.1').release,value.release);
 assert.throws(()=>readNativeCompletion(value,newReleaseIdentity,Date.now(),'2026.10.3-cn.1'),/RELEASE_AUTHORITY/);
 for(const identity of [{...newReleaseIdentity,baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b'},{...newReleaseIdentity,sourceRevision:'f'.repeat(40)}])assert.throws(()=>readNativeCompletion(receipt(identity),identity,Date.now(),'2026.10.10-cn.1'),/RELEASE_PAIR/);
});
test('only existing WeakMap authority and original root pins authorize new release',()=>{
 const f=authorityWithRelease();assert.equal(readApprovedCompletionRelease(f.authority,f.read),f.release);
 assert.throws(()=>readApprovedCompletionRelease({...f.authority},f.read),/AUTHORITY_REQUIRED/);
 const bare=originalAuthorityFixture(newReleaseIdentity,'b'.repeat(40));assert.throws(()=>readApprovedCompletionRelease(bare.authority,path=>Buffer.from(JSON.stringify(bare.profile))),/ROOT_RELEASE/);
});
test('root manifest/config source, hash, nested release and reread remain mandatory',()=>{
 for(const kind of ['hash','source','top-level','release','drift']){
  const overrides=kind==='source'?{manifestSource:'f'.repeat(40)}:kind==='top-level'?{config:{release:'2026.10.10-cn.1'}}:kind==='release'?{config:{provision:{release:'foreign'}}}:{};
  const f=authorityWithRelease(newReleaseIdentity,'b'.repeat(40),'2026.10.10-cn.1',overrides),entry=f.profile.candidateComposeEmitter;
  if(kind==='hash')f.store.set(entry.configRef.path,Buffer.from('{}'));
  let calls=0;const read=(path:string)=>{const raw=f.read(path);return kind==='drift'&&path===entry.configRef.path&&++calls>1?Buffer.concat([raw,Buffer.from(' ')]):raw;};
  assert.throws(()=>readApprovedCompletionRelease(f.authority,read),/RELEASE_(PIN|BINDING|DRIFT)/);
 }
});
test('new identity does not relax completion freshness or pending ledger fields',()=>{
 const value=receipt();assert.throws(()=>readNativeCompletion({...value,expiresAt:'2000-01-01T00:00:00.000Z'},newReleaseIdentity,Date.now(),'2026.10.10-cn.1'),/FRESHNESS/);
 assert.throws(()=>readNativeCompletion({...value,pendingCount:1},newReleaseIdentity,Date.now(),'2026.10.10-cn.1'));
});
